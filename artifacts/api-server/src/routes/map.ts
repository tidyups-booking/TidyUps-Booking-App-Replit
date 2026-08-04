import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  db,
  staffTable,
  bookingsTable,
  cleanerLocationsTable,
  homeownerPinsTable,
} from "@workspace/db";
import { requireAuth } from "../app.js";
import { guardDispatcher } from "../lib/callerRole.js";

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

  // Ownership check: if the staff record has a linked Clerk account, only that
  // user may update it. This prevents any authenticated user from spoofing
  // another cleaner's GPS position.
  const [staff] = await db
    .select({ clerkUserId: staffTable.clerkUserId })
    .from(staffTable)
    .where(eq(staffTable.id, staffId));

  if (!staff) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  // Require the record to have a linked Clerk account. Without this a cleaner
  // has no verified identity — any authenticated user could post for them.
  if (staff.clerkUserId === null) {
    res.status(403).json({
      error: "Staff account not linked to a Clerk user. Ask a dispatcher to link your account first.",
    });
    return;
  }

  const auth = getAuth(req);
  const callerId = auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (callerId !== staff.clerkUserId) {
    res.status(403).json({ error: "Forbidden: cannot update another staff member's location" });
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

// GET /map/maps-key — dispatcher only. Returns the Google Maps browser key so
// the frontend can load the Maps JavaScript API.
router.get("/map/maps-key", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GOOGLE_MAPS_API_KEY not configured" });
    return;
  }
  res.json({ apiKey });
});

// GET /map/data?date=YYYY-MM-DD — dispatcher only
// Returns staff with their effective position for the given date:
//   - Today: live GPS (if recent <5 min) else home coords
//   - Future/past: home coords only
// Also returns bookings for that date, each with a proximity ranking of all staff.
router.get("/map/data", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
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

  // Live GPS locations — always fetched: the date-scoped `position` only uses
  // them for today, but `currentPosition` (homeowner-pin distances) always
  // prefers a fresh live fix regardless of which calendar day is selected.
  const liveLocations = await db.select().from(cleanerLocationsTable);
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

    // Where the cleaner is RIGHT NOW, independent of the selected calendar
    // date — fresh live GPS if available, else home. Used for homeowner pins.
    let currentPosition: { lat: number; lng: number; source: "live" | "home" } | null = null;
    if (live && liveRecent) {
      currentPosition = { lat: live.lat, lng: live.lng, source: "live" };
    } else if (s.homeLat != null && s.homeLng != null) {
      currentPosition = { lat: s.homeLat, lng: s.homeLng, source: "home" };
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
      currentPosition,
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

/**
 * Validates a YYYY-MM-DD string as a real calendar date.
 * Rejects impossible dates like 2025-02-31 by parsing through Date and
 * verifying the ISO string round-trips to the same value.
 */
function isRealCalendarDate(s: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z"); // noon UTC avoids timezone day-shift
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateDateRange(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return "startDate and endDate are required";
  if (!isRealCalendarDate(startDate) || !isRealCalendarDate(endDate))
    return "Dates must be valid calendar dates in YYYY-MM-DD format";
  if (startDate > endDate) return "startDate must be on or before endDate";
  return null;
}

// ── Homeowner pins — dispatcher-saved locations on the Live Map ─────────────

// GET /map/pins — dispatcher only. List all saved homeowner pins.
router.get("/map/pins", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  const pins = await db
    .select()
    .from(homeownerPinsTable)
    .orderBy(homeownerPinsTable.createdAt);
  res.json(pins);
});

// POST /map/pins — dispatcher only. Save a homeowner pin (address search or
// dropped directly on the map). Plain JS validation — no zod in this router.
router.post("/map/pins", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const { name, address, lat, lng } = req.body ?? {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName || trimmedName.length > 120) {
    res.status(400).json({ error: "Name is required (max 120 characters)" });
    return;
  }
  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    res.status(400).json({ error: "Invalid lat/lng" });
    return;
  }
  const trimmedAddress =
    typeof address === "string" && address.trim() ? address.trim().slice(0, 300) : null;

  const [pin] = await db
    .insert(homeownerPinsTable)
    .values({ name: trimmedName, address: trimmedAddress, lat, lng })
    .returning();
  res.status(201).json(pin);
});

// DELETE /map/pins/:id — dispatcher only. Remove a saved pin.
router.delete("/map/pins/:id", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  // Strict lexical check — parseInt would accept "1junk" or "1.9" as 1.
  if (!/^\d+$/.test(req.params.id)) {
    res.status(400).json({ error: "Invalid pin id" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ error: "Invalid pin id" });
    return;
  }
  const deleted = await db
    .delete(homeownerPinsTable)
    .where(eq(homeownerPinsTable.id, id))
    .returning({ id: homeownerPinsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Pin not found" });
    return;
  }
  res.json({ ok: true });
});

// GET /map/counts?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Returns {[date]: bookingCount} for the given range (used by month calendar view)
router.get("/map/counts", requireAuth, async (req, res): Promise<void> => {
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate.trim() : null;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate.trim() : null;

  const rangeErr = validateDateRange(startDate, endDate);
  if (rangeErr) {
    res.status(400).json({ error: rangeErr });
    return;
  }
  // After validateDateRange returns null, both values are non-null valid dates.
  const start = startDate as string;
  const end = endDate as string;

  const rows = await db
    .select()
    .from(bookingsTable)
    .where(and(
      gte(bookingsTable.scheduledDate, start),
      lte(bookingsTable.scheduledDate, end),
    ))
    .orderBy(bookingsTable.scheduledDate, bookingsTable.scheduledTime);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.scheduledDate] = (counts[row.scheduledDate] ?? 0) + 1;
  }
  res.json(counts);
});

// GET /map/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Returns bookings grouped by date (used by week / 3-day calendar views)
router.get("/map/range", requireAuth, async (req, res): Promise<void> => {
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate.trim() : null;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate.trim() : null;

  const rangeErr2 = validateDateRange(startDate, endDate);
  if (rangeErr2) {
    res.status(400).json({ error: rangeErr2 });
    return;
  }
  const start2 = startDate as string;
  const end2 = endDate as string;

  const rows = await db
    .select()
    .from(bookingsTable)
    .where(and(
      gte(bookingsTable.scheduledDate, start2),
      lte(bookingsTable.scheduledDate, end2),
    ))
    .orderBy(bookingsTable.scheduledDate, bookingsTable.scheduledTime);

  const byDate: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!byDate[row.scheduledDate]) byDate[row.scheduledDate] = [];
    byDate[row.scheduledDate].push(row);
  }
  res.json(byDate);
});

export default router;
