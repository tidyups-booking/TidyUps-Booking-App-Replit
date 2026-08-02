import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, staffTable, bookingsTable, cleanerLocationsTable } from "@workspace/db";

const router: IRouter = Router();

// ── Haversine distance (km) ──────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// POST /staff/:id/location — cleaner posts their live GPS position
router.post("/staff/:id/location", async (req, res): Promise<void> => {
  const staffId = parseInt(req.params.id, 10);
  if (isNaN(staffId)) {
    res.status(400).json({ error: "Invalid staff id" });
    return;
  }

  const { lat, lng, accuracy } = req.body ?? {};
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    res.status(400).json({ error: "Invalid lat/lng" });
    return;
  }

  await db
    .insert(cleanerLocationsTable)
    .values({ staffId, lat, lng, accuracy: accuracy ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: cleanerLocationsTable.staffId,
      set: { lat, lng, accuracy: accuracy ?? null, updatedAt: new Date() },
    });

  res.json({ ok: true });
});

// GET /map/data?date=YYYY-MM-DD
// Returns staff with their effective position for the given date:
//   - Today: live GPS (if recent <5 min) else home coords
//   - Future/past: home coords only
// Also returns bookings for that date, each with a proximity ranking of all staff.
router.get("/map/data", async (req, res): Promise<void> => {
  const date =
    typeof req.query.date === "string"
      ? req.query.date
      : new Date().toISOString().split("T")[0];

  const today = new Date().toISOString().split("T")[0];
  const isToday = date === today;

  // All active staff
  const staff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.name);

  // Live GPS locations (only relevant for today)
  const liveLocations = isToday
    ? await db.select().from(cleanerLocationsTable)
    : [];
  const liveMap = new Map(liveLocations.map((l) => [l.staffId, l]));

  // Build staff with effective position
  const staffWithPosition = staff.map((s) => {
    const live = liveMap.get(s.id);
    const liveRecent = live
      ? (Date.now() - new Date(live.updatedAt).getTime()) / 1000 < 300
      : false;

    let position: { lat: number; lng: number; source: "live" | "home" } | null = null;

    if (isToday && live && liveRecent) {
      position = { lat: live.lat, lng: live.lng, source: "live" };
    } else if (s.homeLat != null && s.homeLng != null) {
      position = { lat: s.homeLat, lng: s.homeLng, source: "home" };
    }

    return {
      id: s.id,
      name: s.name,
      role: s.role,
      homeAddress: s.homeAddress,
      homeLat: s.homeLat,
      homeLng: s.homeLng,
      liveLocation: live ? { lat: live.lat, lng: live.lng, updatedAt: live.updatedAt } : null,
      position,
    };
  });

  // Bookings for that date
  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.scheduledDate, date))
    .orderBy(bookingsTable.scheduledTime);

  // The client will geocode booking addresses and compute proximity —
  // but we also return which staff have positions so the client can rank them.
  res.json({ staff: staffWithPosition, bookings, isToday });
});

export default router;
