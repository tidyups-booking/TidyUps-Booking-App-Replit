import { Router, type IRouter } from "express";
import { requireAuth } from "../app.js";
import healthRouter from "./health";
import bookingsRouter from "./bookings";
import callTranscriptsRouter from "./call-transcripts";
import aiRouter from "./ai";
import jobberRouter from "./jobber";
import staffRouter from "./staff";
import twilioRouter from "./twilio";
import mapRouter from "./map";
import placesRouter from "./places";

const router: IRouter = Router();

// ── Public routes (no auth required) ────────────────────────────────────────

// Health check
router.use(healthRouter);

// Twilio: voice webhook is called by Twilio (no session cookie) — must stay public.
// All other Twilio routes (webhook-url, transcript SSE) require dispatcher auth inline.
router.use(twilioRouter);

// Jobber: OAuth callback is a redirect target from Jobber (no session cookie);
// the rest of the jobber routes (auth trigger, status, sync) are safe to leave
// public — they rely on server-side secrets and don't expose user data
router.use(jobberRouter);

// ── Protected routes ─────────────────────────────────────────────────────────

router.use(requireAuth);
router.use(bookingsRouter);
router.use(callTranscriptsRouter);
router.use(aiRouter);
router.use(staffRouter);
router.use(mapRouter);
router.use(placesRouter);

export default router;
