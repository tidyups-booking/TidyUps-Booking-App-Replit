import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, staffTable, bookingsTable, cleanerLocationsTable } from "@workspace/db";

const router: IRouter = Router();

// POST /staff/:id/location — cleaner posts their GPS position
router.post("/staff/:id/location", async (req, res): Promise<void> => {
  const staffId = parseInt(req.params.id, 10);
  if (isNaN(staffId)) {
    res.status(400).json({ error: "Invalid staff id" });
    return;
  }

  const { lat, lng, accuracy } = req.body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number" ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "Invalid lat/lng" });
    return;
  }

  // Upsert — one row per cleaner
  await db
    .insert(cleanerLocationsTable)
    .values({ staffId, lat, lng, accuracy: accuracy ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: cleanerLocationsTable.staffId,
      set: { lat, lng, accuracy: accuracy ?? null, updatedAt: new Date() },
    });

  res.json({ ok: true });
});

// GET /map/data?date=YYYY-MM-DD — all cleaner locations + today's bookings
router.get("/map/data", async (req, res): Promise<void> => {
  const date =
    typeof req.query.date === "string"
      ? req.query.date
      : new Date().toISOString().split("T")[0];

  // All active staff with their latest location (left join)
  const staff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.name);

  const locations = await db.select().from(cleanerLocationsTable);

  const locMap = new Map(locations.map((l) => [l.staffId, l]));

  const staffWithLocation = staff.map((s) => ({
    ...s,
    location: locMap.get(s.id) ?? null,
  }));

  // Today's bookings (confirmed or pending) with an assigned cleaner
  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.scheduledDate, date),
      )
    )
    .orderBy(bookingsTable.scheduledTime);

  res.json({ staff: staffWithLocation, bookings });
});

export default router;
