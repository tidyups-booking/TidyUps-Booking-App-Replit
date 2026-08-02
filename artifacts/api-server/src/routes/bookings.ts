import { Router, type IRouter } from "express";
import { eq, gte, lte, and, sql } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { syncBookingToJobber, getStoredTokens } from "../services/jobber.js";
import {
  ListBookingsQueryParams,
  CreateBookingBody,
  CreateBookingResponse,
  GetBookingStatsResponse,
  GetUpcomingBookingsResponse,
  GetBookingParams,
  GetBookingResponse,
  UpdateBookingParams,
  UpdateBookingBody,
  UpdateBookingResponse,
  DeleteBookingParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /bookings/stats — must be before /:id to avoid route conflict
router.get("/bookings/stats", async (req, res): Promise<void> => {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
  const twoWeeksStr = twoWeeksOut.toISOString().split("T")[0];

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split("T")[0];

  const [allBookings] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable);

  const [upcoming] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(
      and(
        gte(bookingsTable.scheduledDate, todayStr),
        lte(bookingsTable.scheduledDate, twoWeeksStr),
      ),
    );

  const [completed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(eq(bookingsTable.status, "completed"));

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(eq(bookingsTable.status, "pending"));

  const [cancelled] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(eq(bookingsTable.status, "cancelled"));

  const [revenue] = await db
    .select({
      total: sql<number>`coalesce(sum(estimated_price), 0)::float`,
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.status, "completed"));

  const [thisWeek] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(gte(bookingsTable.scheduledDate, weekStartStr));

  const [thisMonth] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(gte(bookingsTable.scheduledDate, monthStartStr));

  const stats = {
    totalBookings: allBookings?.count ?? 0,
    upcomingCount: upcoming?.count ?? 0,
    completedCount: completed?.count ?? 0,
    pendingCount: pending?.count ?? 0,
    cancelledCount: cancelled?.count ?? 0,
    totalRevenue: revenue?.total ?? 0,
    thisWeekCount: thisWeek?.count ?? 0,
    thisMonthCount: thisMonth?.count ?? 0,
  };

  res.json(GetBookingStatsResponse.parse(stats));
});

// GET /bookings/upcoming
router.get("/bookings/upcoming", async (req, res): Promise<void> => {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
  const twoWeeksStr = twoWeeksOut.toISOString().split("T")[0];

  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        gte(bookingsTable.scheduledDate, todayStr),
        lte(bookingsTable.scheduledDate, twoWeeksStr),
      ),
    )
    .orderBy(bookingsTable.scheduledDate, bookingsTable.scheduledTime);

  res.json(GetUpcomingBookingsResponse.parse(bookings));
});

// GET /bookings
router.get("/bookings", async (req, res): Promise<void> => {
  const parsed = ListBookingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, staffId, date, limit = 50, offset = 0 } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(bookingsTable.status, status as typeof bookingsTable.status._.data));
  if (staffId !== undefined) conditions.push(eq(bookingsTable.staffId, staffId));
  if (date) conditions.push(eq(bookingsTable.scheduledDate, date));

  const rows = await db
    .select()
    .from(bookingsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(bookingsTable.scheduledDate, bookingsTable.scheduledTime)
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

// POST /bookings
router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid booking input");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email ?? null,
      address: data.address,
      city: data.city,
      province: data.province ?? "AB",
      postalCode: data.postalCode ?? null,
      serviceType: data.serviceType,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      extras: data.extras ?? [],
      scheduledDate: data.scheduledDate,
      scheduledTime: data.scheduledTime,
      frequency: data.frequency,
      estimatedPrice: data.estimatedPrice ?? null,
      notes: data.notes ?? null,
      status: (data.status as typeof bookingsTable.status._.data) ?? "pending",
      staffId: data.staffId ?? null,
    })
    .returning();

  res.status(201).json(CreateBookingResponse.parse(booking));

  // Fire-and-forget Jobber sync (don't block the response)
  void (async () => {
    let tokens;
    try {
      tokens = await getStoredTokens();
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Could not read Jobber tokens");
      return; // Can't determine connectivity; leave status as not_started
    }

    if (!tokens) return; // Jobber not connected — skip silently

    // Mark sync as in-progress so the UI can show "pending"
    try {
      await db
        .update(bookingsTable)
        .set({ jobberSyncStatus: "pending" })
        .where(eq(bookingsTable.id, booking.id));
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Could not mark Jobber sync as pending");
      // Continue — we'll still attempt the sync and record the terminal state
    }

    try {
      const jobberRequestId = await syncBookingToJobber(booking);
      await db
        .update(bookingsTable)
        .set({ jobberJobId: jobberRequestId, jobberSyncStatus: "synced", jobberSyncError: null })
        .where(eq(bookingsTable.id, booking.id));
      req.log.info({ bookingId: booking.id, jobberRequestId }, "Synced to Jobber");
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Jobber sync failed — persisting failure");
      try {
        await db
          .update(bookingsTable)
          .set({ jobberSyncStatus: "failed", jobberSyncError: err.message })
          .where(eq(bookingsTable.id, booking.id));
      } catch (dbErr: any) {
        req.log.error(
          { bookingId: booking.id, syncErr: err.message, dbErr: dbErr.message },
          "Could not persist Jobber sync failure — booking may show stale pending status"
        );
      }
    }
  })();
});

// GET /bookings/:id
router.get("/bookings/:id", async (req, res): Promise<void> => {
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, params.data.id));

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  res.json(GetBookingResponse.parse(booking));
});

// PATCH /bookings/:id
router.patch("/bookings/:id", async (req, res): Promise<void> => {
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.province !== undefined) updateData.province = data.province;
  if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
  if (data.serviceType !== undefined) updateData.serviceType = data.serviceType;
  if (data.bedrooms !== undefined) updateData.bedrooms = data.bedrooms;
  if (data.bathrooms !== undefined) updateData.bathrooms = data.bathrooms;
  if (data.extras !== undefined) updateData.extras = data.extras;
  if (data.scheduledDate !== undefined) updateData.scheduledDate = data.scheduledDate;
  if (data.scheduledTime !== undefined) updateData.scheduledTime = data.scheduledTime;
  if (data.frequency !== undefined) updateData.frequency = data.frequency;
  if (data.estimatedPrice !== undefined) updateData.estimatedPrice = data.estimatedPrice;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.jobberJobId !== undefined) updateData.jobberJobId = data.jobberJobId;
  if (data.staffId !== undefined) updateData.staffId = data.staffId;

  const [booking] = await db
    .update(bookingsTable)
    .set(updateData)
    .where(eq(bookingsTable.id, params.data.id))
    .returning();

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  res.json(UpdateBookingResponse.parse(booking));
});

// DELETE /bookings/:id
router.delete("/bookings/:id", async (req, res): Promise<void> => {
  const params = DeleteBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(bookingsTable)
    .where(eq(bookingsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
