import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, callTranscriptsTable } from "@workspace/db";
import { guardDispatcher } from "../lib/callerRole.js";

const router: IRouter = Router();

// GET /call-transcripts/:bookingId — dispatcher only
router.get("/call-transcripts/:bookingId", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const bookingId = Number(req.params.bookingId);
  if (isNaN(bookingId) || bookingId <= 0) {
    res.status(400).json({ error: "Invalid bookingId" });
    return;
  }

  const rows = await db
    .select()
    .from(callTranscriptsTable)
    .where(eq(callTranscriptsTable.bookingId, bookingId))
    .orderBy(callTranscriptsTable.createdAt);

  res.json(rows);
});

// POST /call-transcripts/:bookingId — dispatcher only
router.post("/call-transcripts/:bookingId", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const bookingId = Number(req.params.bookingId);
  if (isNaN(bookingId) || bookingId <= 0) {
    res.status(400).json({ error: "Invalid bookingId" });
    return;
  }

  const { transcript } = req.body;
  if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
    res.status(400).json({ error: "transcript is required" });
    return;
  }

  const [row] = await db
    .insert(callTranscriptsTable)
    .values({ bookingId, transcript: transcript.trim() })
    .returning();

  res.status(201).json(row);
});

export default router;
