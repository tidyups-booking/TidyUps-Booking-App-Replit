import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Clerk proxy must be mounted BEFORE body parsers — it streams raw bytes
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Build an explicit allowlist of origins rather than reflecting any origin.
// ALLOWED_ORIGINS env var accepts a comma-separated list of additional
// production / staging origins (e.g. "https://bookcleaning.app").
// REPLIT_DOMAINS is injected by the platform and covers the dev preview domain.
const allowedOrigins: string[] = [
  ...(process.env.REPLIT_DOMAINS
    ? process.env.REPLIT_DOMAINS.split(",").map((d) => `https://${d.trim()}`)
    : []),
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : []),
];

app.use(
  cors({
    credentials: true,
    origin: (requestOrigin, callback) => {
      // Allow server-to-server requests that have no Origin header.
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${requestOrigin}' not allowed`));
      }
    },
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Resolve publishable key from the request host so the same server can
// serve multiple Clerk custom domains / dev + prod without config changes.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Auth guard — applied to all /api routes except Jobber OAuth callback
// (which must be publicly reachable for Jobber's redirect to work)
export function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.use("/api", router);

export default app;
