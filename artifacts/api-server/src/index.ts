import http from "http";
import { URL } from "url";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { createTwilioWss, startLiveCallListener } from "./services/twilio-stream.js";
import { consumeStreamToken } from "./services/stream-tokens.js";
import { runMigrations } from "@workspace/db";
import { startJobberAutoSync } from "./services/jobberCalendarSync.js";
import { startTwilioWebhookMonitor } from "./services/twilio-webhook-check.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run DB migrations before serving traffic so the schema is always current.
// Every migration is idempotent — safe on re-deploys and fresh installs alike.
try {
  await runMigrations();
} catch (err) {
  logger.error({ err }, "Database migration failed — aborting startup");
  process.exit(1);
}

// Wrap Express in a plain HTTP server so we can attach the Twilio Media Streams
// WebSocket alongside normal API routes.
const server = http.createServer(app);
const twilioWss = createTwilioWss();

// Subscribe to cross-instance live-call events (Postgres LISTEN/NOTIFY) so the
// call panel works even when the Twilio webhook and a dispatcher's SSE
// connection land on different autoscale instances.
startLiveCallListener();

// Route WebSocket upgrades to the Twilio stream handler.
// Auth: a valid token in the query string authenticates immediately (used by
// e2e/synthetic clients). Real Twilio STRIPS query strings from <Stream> URLs,
// so its connections arrive without a token — they are accepted provisionally
// and must present the token via the "start" message's customParameters
// (<Parameter name="token">), validated in twilio-stream.ts, or be closed.
server.on("upgrade", (req, socket, head) => {
  const reqUrl = req.url ?? "";
  if (reqUrl.startsWith("/api/twilio/stream")) {
    // Parse token from query string (req.url is a path+query string, not a full URL,
    // so we use a dummy base to let URL parse it correctly)
    const { searchParams } = new URL(reqUrl, "http://localhost");
    const token = searchParams.get("token") ?? undefined;

    void (async () => {
      const preauthed = token ? await consumeStreamToken(token) : false;
      twilioWss.handleUpgrade(req, socket, head, (ws) => {
        twilioWss.emit("connection", ws, req, { preauthed });
      });
    })().catch(() => socket.destroy());
  } else {
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
  // Background poller: automatically pulls new Jobber appointments every few
  // minutes while Jobber is connected (no manual sync needed).
  startJobberAutoSync();
  // Background monitor: warns loudly (logs + dashboard endpoint) if the
  // Twilio number's voice webhook stops pointing at the live site.
  startTwilioWebhookMonitor();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
