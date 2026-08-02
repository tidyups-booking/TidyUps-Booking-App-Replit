import { Router, type IRouter } from "express";
import { requireAuth } from "../app.js";
import healthRouter from "./health";
import bookingsRouter from "./bookings";
import aiRouter from "./ai";
import jobberRouter from "./jobber";
import staffRouter from "./staff";
import twilioRouter from "./twilio";
import mapRouter from "./map";

const router: IRouter = Router();

// ── Public routes (no auth required) ────────────────────────────────────────

// Health check
router.use(healthRouter);

// Jobber OAuth callback — Jobber redirects here without auth cookies
router.get("/jobber/callback", (req, res, next) => next());

// Twilio voice webhook — Twilio POSTs here when a call comes in
router.post("/twilio/voice", (req, res, next) => next());

// ── Protected routes ─────────────────────────────────────────────────────────

router.use(requireAuth);
router.use(bookingsRouter);
router.use(aiRouter);
router.use(jobberRouter);
router.use(staffRouter);
router.use(twilioRouter);
router.use(mapRouter);

export default router;
