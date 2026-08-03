import http from "http";
import { URL } from "url";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { createTwilioWss } from "./services/twilio-stream.js";
import { consumeStreamToken } from "./services/stream-tokens.js";
import { runMigrations } from "@workspace/db";
import { startJobberAutoSync } from "./services/jobberCalendarSync.js";

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

// Route WebSocket upgrades to the Twilio stream handler.
// Require a valid one-time token issued by POST /api/twilio/voice so that
// only a real Twilio call (which received the TwiML) can open this socket.
server.on("upgrade", (req, socket, head) => {
  const reqUrl = req.url ?? "";
  if (reqUrl.startsWith("/api/twilio/stream")) {
    // Parse token from query string (req.url is a path+query string, not a full URL,
    // so we use a dummy base to let URL parse it correctly)
    const { searchParams } = new URL(reqUrl, "http://localhost");
    const token = searchParams.get("token") ?? undefined;

    if (!consumeStreamToken(token)) {
      logger.warn({ reqUrl: reqUrl.split("?")[0] }, "WebSocket upgrade rejected: invalid or missing stream token");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    twilioWss.handleUpgrade(req, socket, head, (ws) => {
      twilioWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
  // Background poller: automatically pulls new Jobber appointments every few
  // minutes while Jobber is connected (no manual sync needed).
  startJobberAutoSync();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
