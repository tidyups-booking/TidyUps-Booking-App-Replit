import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
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

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.active !== undefined) updateData.active = data.active;

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
