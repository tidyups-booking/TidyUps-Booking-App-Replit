import { Router, type IRouter } from "express";
import { requireAuth } from "../app.js";
import healthRouter from "./health";
import bookingsRouter from "./bookings";
import aiRouter from "./ai";
import jobberRouter from "./jobber";
import staffRouter from "./staff";

const router: IRouter = Router();

// Health check is public
router.use(healthRouter);

// Jobber OAuth callback must be public — Jobber redirects here without auth
router.get("/jobber/callback", (req, res, next) => next());

// All other routes require authentication
router.use(requireAuth);
router.use(bookingsRouter);
router.use(aiRouter);
router.use(jobberRouter);
router.use(staffRouter);

export default router;
