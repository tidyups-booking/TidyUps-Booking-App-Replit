import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { createTwilioWss } from "./services/twilio-stream.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Wrap Express in a plain HTTP server so we can attach the Twilio Media Streams
// WebSocket alongside normal API routes.
const server = http.createServer(app);
const twilioWss = createTwilioWss();

// Route WebSocket upgrades to the Twilio stream handler
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/api/twilio/stream") {
    twilioWss.handleUpgrade(req, socket, head, (ws) => {
      twilioWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
