import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, callTranscriptsTable } from "@workspace/db";

const router: IRouter = Router();

// GET /call-transcripts/:bookingId
router.get("/call-transcripts/:bookingId", async (req, res): Promise<void> => {
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

export default router;
