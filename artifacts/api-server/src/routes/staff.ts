import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, staffTable, bookingsTable } from "@workspace/db";
import {
  ListStaffQueryParams,
  CreateStaffBody,
  UpdateStaffParams,
  UpdateStaffBody,
  GetStaffScheduleParams,
  GetStaffScheduleQueryParams,
  GetDayScheduleQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /staff
router.get("/staff", async (req, res): Promise<void> => {
  const parsed = ListStaffQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { activeOnly = true } = parsed.data;

  const rows = await db
    .select()
    .from(staffTable)
    .where(activeOnly ? eq(staffTable.active, true) : undefined)
    .orderBy(staffTable.name);

  res.json(rows);
});

// POST /staff
router.post("/staff", async (req, res): Promise<void> => {
  const parsed = CreateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const [staff] = await db
    .insert(staffTable)
    .values({
      name: data.name,
      role: (data.role as typeof staffTable.role._.data) ?? "cleaner",
      phone: data.phone ?? null,
      active: data.active ?? true,
    })
    .returning();

  res.status(201).json(staff);
});

/**
 * Role model for staff mutations:
 *
 *   DISPATCHER — an authenticated Clerk user whose userId does NOT match any
 *                staff record's clerkUserId. Dispatchers manage the team:
 *                they may update all fields on any staff record including
 *                clerkUserId (which is how a cleaner's account gets linked).
 *
 *   CLEANER    — an authenticated Clerk user whose userId matches exactly one
 *                staff record's clerkUserId. Cleaners may update only their
 *                OWN record, and only a safe subset of fields
 *                (phone, homeAddress, homeLat, homeLng).
 *
 * Self-service claiming is intentionally absent: linking a Clerk account to a
 * staff record is a dispatcher-only operation performed via PATCH clerkUserId.
 */
async function resolveCallerRole(callerId: string): Promise<{
  role: "dispatcher" | "cleaner";
  staffId: number | null;
}> {
  const [ownRecord] = await db
    .select({ id: staffTable.id })
    .from(staffTable)
    .where(eq(staffTable.clerkUserId, callerId));
  return ownRecord
    ? { role: "cleaner", staffId: ownRecord.id }
    : { role: "dispatcher", staffId: null };
}

// PATCH /staff/:id
router.patch("/staff/:id", async (req, res): Promise<void> => {
  const params = UpdateStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const auth = getAuth(req);
  const callerId = auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Fetch target record and resolve caller role in parallel
  const [[existing], callerRole] = await Promise.all([
    db.select({ id: staffTable.id, clerkUserId: staffTable.clerkUserId })
      .from(staffTable)
      .where(eq(staffTable.id, params.data.id)),
    resolveCallerRole(callerId),
  ]);

  if (!existing) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  const raw = req.body as Record<string, unknown>;

  if (callerRole.role === "cleaner") {
    // Cleaners may only edit their own record …
    if (callerRole.staffId !== existing.id) {
      res.status(403).json({ error: "Forbidden: cannot update another staff member's record" });
      return;
    }
    // … and only the safe self-service fields.
    const privilegedFields = ["name", "role", "active", "clerkUserId"] as const;
    const attempted = privilegedFields.filter(
      (f) => parsed.data[f as keyof typeof parsed.data] !== undefined || raw[f] !== undefined,
    );
    if (attempted.length > 0) {
      res.status(403).json({
        error: `Forbidden: cleaners cannot update ${attempted.join(", ")}`,
      });
      return;
    }
  }

  // Build the update payload
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};

  // Dispatcher-only fields
  if (callerRole.role === "dispatcher") {
    if (data.name !== undefined) updateData.name = data.name;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.active !== undefined) updateData.active = data.active;
    // clerkUserId — how a dispatcher links a cleaner's Clerk account
    if (typeof raw.clerkUserId === "string") {
      updateData.clerkUserId = raw.clerkUserId || null;
    } else if (raw.clerkUserId === null) {
      updateData.clerkUserId = null;
    }
  }

  // Self-service fields (both roles, own record only for cleaners — enforced above)
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (typeof raw.homeAddress === "string") updateData.homeAddress = raw.homeAddress || null;
  if (typeof raw.homeLat === "number") updateData.homeLat = raw.homeLat;
  if (typeof raw.homeLng === "number") updateData.homeLng = raw.homeLng;
  if (raw.homeAddress === "" || raw.homeAddress === null) {
    updateData.homeLat = null;
    updateData.homeLng = null;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }

  const [staff] = await db
    .update(staffTable)
    .set(updateData)
    .where(eq(staffTable.id, params.data.id))
    .returning();

  if (!staff) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  res.json(staff);
});

// GET /staff/:id/schedule?date=YYYY-MM-DD
router.get("/staff/:id/schedule", async (req, res): Promise<void> => {
  const params = GetStaffScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetStaffScheduleQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  // Verify staff member exists
  const [staff] = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.id, params.data.id));

  if (!staff) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.staffId, params.data.id),
        eq(bookingsTable.scheduledDate, query.data.date),
      ),
    )
    .orderBy(bookingsTable.scheduledTime);

  res.json(bookings);
});

// GET /schedule?date=YYYY-MM-DD — all staff schedules for a given day
router.get("/schedule", async (req, res): Promise<void> => {
  const query = GetDayScheduleQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const allStaff = await db
    .select()
    .from(staffTable)
    .where(eq(staffTable.active, true))
    .orderBy(staffTable.name);

  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.scheduledDate, query.data.date))
    .orderBy(bookingsTable.scheduledTime);

  const schedules = allStaff.map((staff) => ({
    staff,
    bookings: bookings.filter((b) => b.staffId === staff.id),
  }));

  res.json(schedules);
});

export default router;
