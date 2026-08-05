import { Router, type IRouter } from "express";
import { eq, gte, lte, and, or, ilike, desc, sql, inArray, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, bookingsTable, callTranscriptsTable, staffTable } from "@workspace/db";
import { syncBookingToJobber, syncBookingUpsertToJobber, getStoredTokens } from "../services/jobber.js";
import { resolveCallerRole, guardDispatcher } from "../lib/callerRole.js";
import {
  buildBookingSearchCondition,
  buildCustomerSearchCondition,
} from "./bookingSearchConditions.js";
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

// GET /bookings/stats — dispatcher only; must be before /:id to avoid route conflict
router.get("/bookings/stats", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
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

// GET /bookings/upcoming — dispatcher only
router.get("/bookings/upcoming", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
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

// GET /bookings/customers/search — dispatcher only.
// Returning-customer autocomplete for the New Booking form: matches previous
// bookings by name, phone, or address and returns one entry per customer
// (their most recent booking's details) so the whole form can be pre-filled.
router.get("/bookings/customers/search", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    res.json({ customers: [] });
    return;
  }
  const rows = await db
    .select()
    .from(bookingsTable)
    .where(buildCustomerSearchCondition(q))
    .orderBy(desc(bookingsTable.id))
    .limit(50);

  // One suggestion per customer — keyed by phone (fallback: name+address)
  // bookingCount = number of matched bookings for that customer (within the 50-row window),
  // used by the client to decide loyalty-discount eligibility.
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.phone?.replace(/\D/g, "") || `${r.firstName} ${r.lastName} ${r.address}`.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const customers: any[] = [];
  for (const r of rows) {
    const key = r.phone?.replace(/\D/g, "") || `${r.firstName} ${r.lastName} ${r.address}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    customers.push({
      bookingCount: counts.get(key) ?? 1,
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      email: r.email,
      address: r.address,
      city: r.city,
      province: r.province,
      postalCode: r.postalCode,
      addressLat: r.addressLat,
      addressLng: r.addressLng,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      serviceType: r.serviceType,
      frequency: r.frequency,
      lastBookingDate: r.scheduledDate,
    });
    if (customers.length >= 6) break;
  }
  res.json({ customers });
});

// Build the shared filter conditions for /bookings and /bookings/count so the
// reported total always matches what the list query would return.
function buildBookingFilterConditions(params: {
  status?: string;
  staffId?: number;
  date?: string;
  q?: string;
}) {
  const { status, staffId, date, q } = params;
  const conditions = [];
  if (status) conditions.push(eq(bookingsTable.status, status as typeof bookingsTable.status._.data));
  if (staffId !== undefined) conditions.push(eq(bookingsTable.staffId, staffId));
  if (date) conditions.push(eq(bookingsTable.scheduledDate, date));

  // Server-side search: match address, city, client name (first/last/full), or phone.
  // Phone also matches on digits-only so "4035551234" finds "(403) 555-1234".
  const search = typeof q === "string" ? q.trim() : "";
  if (search.length > 0) {
    conditions.push(buildBookingSearchCondition(search));
  }
  return conditions;
}

// GET /bookings/count — dispatcher only; total matches for the same filters as
// GET /bookings, so the UI can say "showing X of Y". Must be before /:id.
router.get("/bookings/count", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  const parsed = ListBookingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = buildBookingFilterConditions(parsed.data);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json({ total: row?.count ?? 0 });
});

// GET /bookings — dispatcher only
router.get("/bookings", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  const parsed = ListBookingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { limit = 50, offset = 0 } = parsed.data;
  // Sensible cap so a runaway limit can't drag the whole table into memory
  const cappedLimit = Math.min(Math.max(1, limit), 200);

  const conditions = buildBookingFilterConditions(parsed.data);

  const rows = await db
    .select()
    .from(bookingsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(bookingsTable.scheduledDate, bookingsTable.scheduledTime)
    .limit(cappedLimit)
    .offset(offset);

  // Fetch which booking IDs have at least one transcript in a single query
  let transcriptBookingIds = new Set<number>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const transcriptRows = await db
      .selectDistinct({ bookingId: callTranscriptsTable.bookingId })
      .from(callTranscriptsTable)
      .where(inArray(callTranscriptsTable.bookingId, ids));
    transcriptBookingIds = new Set(transcriptRows.map((r) => r.bookingId));
  }

  const response = rows.map((r) => ({
    ...r,
    hasTranscript: transcriptBookingIds.has(r.id),
  }));

  res.json(response);
});

// Verify a submitted price breakdown is internally consistent and matches the
// quoted price. Returns an error string, or null when valid (or absent).
// Invariants: a base line (hours × hourlyRate = baseAmount, or manualPrice)
// is required; base − discounts + fuel must equal total; total must equal
// estimatedPrice when one is provided.
function priceBreakdownError(pb: unknown, estimatedPrice: number | null | undefined): string | null {
  if (pb === null || pb === undefined) return null;
  if (typeof pb !== "object" || Array.isArray(pb)) return "priceBreakdown must be an object";
  const b = pb as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);
  if (!num(b.total)) return "priceBreakdown.total is required";
  // Semantic constraints: every monetary field must be a finite non-negative
  // number, counts must be non-negative integers.
  for (const field of ["hours", "hourlyRate", "baseAmount", "manualPrice", "leadDiscount", "loyaltyDiscount", "fuelSurcharge", "total"]) {
    if (b[field] !== undefined && (!num(b[field]) || (b[field] as number) < 0))
      return `priceBreakdown.${field} must be a non-negative number`;
  }
  for (const field of ["quickDiscountTens", "quickDiscountTwenties"]) {
    if (b[field] !== undefined && (!num(b[field]) || (b[field] as number) < 0 || !Number.isInteger(b[field])))
      return `priceBreakdown.${field} must be a non-negative integer`;
  }
  const hasBase = num(b.baseAmount);
  const hasManual = num(b.manualPrice);
  if (!hasBase && !hasManual) return "priceBreakdown requires baseAmount (with hours and hourlyRate) or manualPrice";
  if (hasBase && hasManual) return "priceBreakdown must have either baseAmount or manualPrice, not both";
  if (hasBase) {
    if (!num(b.hours) || !num(b.hourlyRate) || (b.hours as number) <= 0 || (b.hourlyRate as number) <= 0)
      return "priceBreakdown.baseAmount requires positive hours and hourlyRate";
    if (Math.abs((b.hours as number) * (b.hourlyRate as number) - (b.baseAmount as number)) > 0.01)
      return "priceBreakdown.baseAmount must equal hours × hourlyRate";
  }
  const base = hasBase ? (b.baseAmount as number) : (b.manualPrice as number);
  const totalDiscounts =
    (num(b.leadDiscount) ? b.leadDiscount : 0) +
    (num(b.quickDiscountTens) ? b.quickDiscountTens * 10 : 0) +
    (num(b.quickDiscountTwenties) ? b.quickDiscountTwenties * 20 : 0) +
    (num(b.loyaltyDiscount) ? b.loyaltyDiscount : 0);
  // Discounts may never exceed the pre-discount quote (quote floor is $0)
  if (base - totalDiscounts < -0.01) return "priceBreakdown discounts exceed the pre-discount quote";
  const reconciled = base - totalDiscounts + (num(b.fuelSurcharge) ? b.fuelSurcharge : 0);
  if (Math.abs(reconciled - (b.total as number)) > 0.01)
    return "priceBreakdown lines do not reconcile with priceBreakdown.total";
  if (estimatedPrice != null && Math.abs((b.total as number) - estimatedPrice) > 0.01)
    return "priceBreakdown.total must equal estimatedPrice";
  return null;
}

// POST /bookings — dispatcher only
router.post("/bookings", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid booking input");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const pbError = priceBreakdownError(data.priceBreakdown, data.estimatedPrice);
  if (pbError) {
    res.status(400).json({ error: pbError });
    return;
  }
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
      priceBreakdown: data.priceBreakdown ?? null,
      notes: data.notes ?? null,
      status: (data.status as typeof bookingsTable.status._.data) ?? "pending",
      staffId: data.staffId ?? null,
      addressLat: data.addressLat ?? null,
      addressLng: data.addressLng ?? null,
    })
    .returning();

  // Store call transcript synchronously so it's always visible on first detail load
  if (data.callTranscript && data.callTranscript.trim().length > 0) {
    try {
      await db
        .insert(callTranscriptsTable)
        .values({ bookingId: booking.id, transcript: data.callTranscript.trim() });
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Could not save call transcript");
      res.status(500).json({ error: "Booking created but transcript could not be saved" });
      return;
    }
  }

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
// Any authorized caller (dispatcher or cleaner) may read any booking;
// cleaner write restrictions are enforced in PATCH below.
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

  // Require authentication — this endpoint is cleaner-facing (called by the mobile app)
  const auth = getAuth(req);
  const callerId = auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const callerRole = await resolveCallerRole(callerId);
  if (callerRole.role === "denied") {
    res.status(403).json({ error: "Forbidden: account not authorized. Contact a dispatcher." });
    return;
  }
  // Cleaners may READ any team booking (to coordinate handoffs/coverage);
  // writes are still restricted to their own bookings in PATCH below.

  res.json(GetBookingResponse.parse(booking));
});

// PATCH /bookings/:id
// Cleaners may only update their OWN bookings, and only the status field.
// Dispatchers may update any field on any booking.
// POST /bookings/:id/claim — a linked cleaner claims an unassigned booking
// for themselves. Conditional update on staffId IS NULL so two cleaners
// claiming at once can't both win — the loser gets a 409.
router.post("/bookings/:id/claim", async (req, res): Promise<void> => {
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const auth = getAuth(req);
  const callerId = auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const caller = await resolveCallerRole(callerId);
  // A claim assigns the job to the caller's OWN staff record, so it needs a
  // staff link. Both linked cleaners and staff-linked dispatchers (e.g. the
  // owner working as a cleaner) can claim; dispatchers without a staff record
  // assign staff through the booking edit form instead.
  if (caller.staffId === null) {
    res.status(403).json({
      error:
        caller.role === "denied"
          ? "Forbidden: account not authorized. Contact a dispatcher."
          : "Forbidden: only team members with a linked staff record can claim jobs",
    });
    return;
  }

  const [existing] = await db
    .select({ id: bookingsTable.id, staffId: bookingsTable.staffId })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const [claimed] = await db
    .update(bookingsTable)
    .set({ staffId: caller.staffId })
    .where(and(eq(bookingsTable.id, params.data.id), isNull(bookingsTable.staffId)))
    .returning();

  if (!claimed) {
    res.status(409).json({ error: "This job was just claimed by someone else" });
    return;
  }

  req.log.info(
    { bookingId: claimed.id, staffId: caller.staffId },
    "Booking claimed by cleaner",
  );
  res.json(claimed);
});

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

  // Require authentication — this endpoint is cleaner-facing (called by the mobile app)
  const auth = getAuth(req);
  const callerId = auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  {
    const callerRole = await resolveCallerRole(callerId);
    if (callerRole.role === "denied") {
      res.status(403).json({ error: "Forbidden: account not authorized. Contact a dispatcher." });
      return;
    }
    if (callerRole.role === "cleaner") {
      // Fetch booking to verify ownership
      const [existing] = await db
        .select({ staffId: bookingsTable.staffId })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, params.data.id));

      if (!existing) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      if (existing.staffId !== callerRole.staffId) {
        res.status(403).json({ error: "Forbidden: cannot update another cleaner's booking" });
        return;
      }

      // Cleaners may only change status — reject any other field
      const raw = req.body as Record<string, unknown>;
      const forbiddenFields = Object.keys(raw).filter((k) => k !== "status");
      if (forbiddenFields.length > 0) {
        res.status(403).json({
          error: `Forbidden: cleaners may only update status (received: ${forbiddenFields.join(", ")})`,
        });
        return;
      }

      // Cleaners may only transition to in_progress or completed
      const allowedStatuses = ["in_progress", "completed"];
      if (typeof raw.status === "string" && !allowedStatuses.includes(raw.status)) {
        res.status(403).json({
          error: `Forbidden: cleaners may only set status to ${allowedStatuses.join(" or ")}`,
        });
        return;
      }
    }
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  // Non-nullable fields: only update when explicitly provided
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.province !== undefined) updateData.province = data.province;
  if (data.serviceType !== undefined) updateData.serviceType = data.serviceType;
  if (data.bedrooms !== undefined) updateData.bedrooms = data.bedrooms;
  if (data.bathrooms !== undefined) updateData.bathrooms = data.bathrooms;
  if (data.extras !== undefined) updateData.extras = data.extras;
  if (data.scheduledDate !== undefined) updateData.scheduledDate = data.scheduledDate;
  if (data.scheduledTime !== undefined) updateData.scheduledTime = data.scheduledTime;
  if (data.frequency !== undefined) updateData.frequency = data.frequency;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.jobberJobId !== undefined) updateData.jobberJobId = data.jobberJobId;
  // Nullable fields: undefined = no change; null or a value = write it (null clears the column)
  if (data.email !== undefined) updateData.email = data.email ?? null;
  if (data.postalCode !== undefined) updateData.postalCode = data.postalCode ?? null;
  if (data.estimatedPrice !== undefined) updateData.estimatedPrice = data.estimatedPrice ?? null;
  if (data.priceBreakdown !== undefined) {
    // Validate against the incoming price when provided, otherwise the stored one
    let priceForCheck: number | null | undefined = data.estimatedPrice;
    if (priceForCheck === undefined) {
      const [current] = await db
        .select({ estimatedPrice: bookingsTable.estimatedPrice })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, Number(req.params.id)));
      priceForCheck = current?.estimatedPrice;
    }
    const pbError = priceBreakdownError(data.priceBreakdown, priceForCheck);
    if (pbError) {
      res.status(400).json({ error: pbError });
      return;
    }
    updateData.priceBreakdown = data.priceBreakdown ?? null;
  } else if (data.estimatedPrice !== undefined) {
    // Price changed with no replacement breakdown: clear any stored breakdown
    // atomically so a stale itemization can never contradict the new price.
    // (Left intact when the incoming price equals the stored one.)
    const [current] = await db
      .select({ estimatedPrice: bookingsTable.estimatedPrice, priceBreakdown: bookingsTable.priceBreakdown })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, Number(req.params.id)));
    const oldPrice = current?.estimatedPrice ?? null;
    const newPrice = data.estimatedPrice ?? null;
    const changed = oldPrice === null || newPrice === null ? oldPrice !== newPrice : Math.abs(oldPrice - newPrice) > 0.005;
    if (current?.priceBreakdown && changed) updateData.priceBreakdown = null;
  }
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;
  if (data.staffId !== undefined) updateData.staffId = data.staffId ?? null;
  if (data.addressLat !== undefined) updateData.addressLat = data.addressLat ?? null;
  if (data.addressLng !== undefined) updateData.addressLng = data.addressLng ?? null;

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

  // Fire-and-forget Jobber sync so the linked Jobber record reflects the edit
  // (updates the existing request when one is linked — never a duplicate).
  // Skip when the edit only touched local-only fields (status, staff
  // assignment, jobber ids, coordinates) that Jobber doesn't carry — this also
  // covers cleaner status-only updates.
  const jobberRelevantFields = [
    "firstName", "lastName", "phone", "email",
    "address", "city", "province", "postalCode",
    "serviceType", "bedrooms", "bathrooms", "extras",
    "scheduledDate", "scheduledTime", "notes", "estimatedPrice",
  ];
  const touchesJobberFields = jobberRelevantFields.some((f) => f in updateData);
  if (!touchesJobberFields) return;

  void (async () => {
    let tokens;
    try {
      tokens = await getStoredTokens();
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Could not read Jobber tokens");
      return;
    }
    if (!tokens) return; // Jobber not connected — skip silently

    try {
      await db
        .update(bookingsTable)
        .set({ jobberSyncStatus: "pending" })
        .where(eq(bookingsTable.id, booking.id));
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Could not mark Jobber sync as pending");
    }

    try {
      const jobberRequestId = await syncBookingUpsertToJobber(booking);
      await db
        .update(bookingsTable)
        .set({ jobberJobId: jobberRequestId, jobberSyncStatus: "synced", jobberSyncError: null })
        .where(eq(bookingsTable.id, booking.id));
      req.log.info({ bookingId: booking.id, jobberRequestId }, "Booking edit synced to Jobber");
    } catch (err: any) {
      req.log.warn({ bookingId: booking.id, err: err.message }, "Jobber edit sync failed — persisting failure");
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

// DELETE /bookings/:id — dispatcher only
router.delete("/bookings/:id", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
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
