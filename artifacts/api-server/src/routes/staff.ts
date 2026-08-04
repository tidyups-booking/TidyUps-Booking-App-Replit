import { Router, type IRouter } from "express";
import { eq, and, sql, isNull } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import {
  db,
  staffTable,
  bookingsTable,
  dispatcherAllowlistTable,
  dispatcherInvitesTable,
} from "@workspace/db";
import {
  ListStaffQueryParams,
  CreateStaffBody,
  UpdateStaffParams,
  UpdateStaffBody,
  GetStaffScheduleParams,
  GetStaffScheduleQueryParams,
  GetDayScheduleQueryParams,
  ConnectStaffAccountParams,
  ConnectStaffAccountBody,
} from "@workspace/api-zod";
import { resolveCallerRole, guardDispatcher, guardStaff } from "../lib/callerRole.js";

const router: IRouter = Router();

// Same email shape the OpenAPI spec enforces on create — applied to PATCH and
// import too so malformed emails can't enter through a side door.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /staff — dispatcher only
router.get("/staff", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

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

// POST /staff — dispatcher only
router.post("/staff", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;
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
      email: data.email ?? null,
      active: data.active ?? true,
    })
    .returning();

  res.status(201).json(staff);
});

/**
 * Role model — see lib/callerRole.ts for the shared implementation.
 *
 *   DISPATCHER — userId has NO matching staff record. Full access.
 *   CLEANER    — userId matches a staff record. Restricted to own data.
 */

// GET /staff/me — return the staff record linked to the caller's Clerk account.
// Goes through resolveCallerRole (NOT a direct clerkUserId lookup) so that a
// first-time sign-in with the email on an unlinked staff record triggers the
// self-link bootstrap — this is the first endpoint the cleaner app calls.
router.get("/staff/me", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const callerId = auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const caller = await resolveCallerRole(callerId);
  if (caller.role === "cleaner" && caller.staffId !== null) {
    const [staff] = await db
      .select()
      .from(staffTable)
      .where(eq(staffTable.id, caller.staffId));
    if (staff) {
      res.json(staff);
      return;
    }
  }

  res.status(404).json({ error: "No staff record is linked to this account. Sign in with the same email your dispatcher has on file, or ask your dispatcher to add it to your staff record." });
});

// GET /staff/unlinked-signups — dispatcher only. Cleaner-app accounts that are
// waiting to be connected: signed up, verified email, but no staff link, no
// dispatcher access, and no email match that would connect them automatically.
router.get("/staff/unlinked-signups", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  try {
    // Page through Clerk users (bounded) so signups beyond the first page
    // aren't silently missed.
    const PAGE_SIZE = 200;
    const MAX_USERS = 1000;
    const fetchUsers = async () => {
      const all: Awaited<
        ReturnType<typeof clerkClient.users.getUserList>
      >["data"] = [];
      for (let offset = 0; offset < MAX_USERS; offset += PAGE_SIZE) {
        const { data } = await clerkClient.users.getUserList({
          limit: PAGE_SIZE,
          offset,
          orderBy: "-created_at",
        });
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return all;
    };

    const [users, staffRows, allowRows, inviteRows] = await Promise.all([
      fetchUsers(),
      db
        .select({
          clerkUserId: staffTable.clerkUserId,
          email: staffTable.email,
          active: staffTable.active,
        })
        .from(staffTable),
      db
        .select({ clerkUserId: dispatcherAllowlistTable.clerkUserId })
        .from(dispatcherAllowlistTable),
      db
        .select({ email: dispatcherInvitesTable.email })
        .from(dispatcherInvitesTable)
        .where(isNull(dispatcherInvitesTable.claimedAt)),
    ]);

    const linkedIds = new Set(staffRows.map((r) => r.clerkUserId).filter(Boolean));
    // Only emails that will actually auto-connect on the cleaner's next app
    // open (unlinked + active — mirrors the self-link rules in callerRole.ts).
    // Emails on linked or inactive rows do NOT auto-connect, so those signups
    // must stay visible to the dispatcher.
    const staffEmails = new Set(
      staffRows
        .filter((r) => !r.clerkUserId && r.active)
        .map((r) => r.email?.trim().toLowerCase())
        .filter(Boolean),
    );
    const dispatcherIds = new Set(allowRows.map((r) => r.clerkUserId));
    const reservedEmails = new Set(
      [
        ...(process.env.DISPATCHER_EMAILS ?? "").split(","),
        ...inviteRows.map((r) => r.email),
      ]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );

    const waiting = [];
    for (const u of users) {
      if (linkedIds.has(u.id) || dispatcherIds.has(u.id)) continue;
      // Internal test accounts never belong in the dispatcher's list
      if (u.emailAddresses.some((e) => e.emailAddress.includes("+clerk_test"))) continue;
      const verified = u.emailAddresses.filter(
        (e) => e.verification?.status === "verified",
      );
      if (verified.length === 0) continue;
      const emailsLower = verified.map((e) => e.emailAddress.toLowerCase());
      // Owner/invited-dispatcher emails resolve as dispatchers on next sign-in
      if (emailsLower.some((e) => reservedEmails.has(e))) continue;
      // An email already on a staff record connects automatically — not waiting
      if (emailsLower.some((e) => staffEmails.has(e))) continue;

      const primary =
        verified.find((e) => e.id === u.primaryEmailAddressId) ?? verified[0];
      waiting.push({
        clerkUserId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
        email: primary.emailAddress,
        imageUrl: u.imageUrl || null,
        createdAt: new Date(u.createdAt).toISOString(),
      });
    }

    res.json(waiting);
  } catch (err) {
    console.error("[staff] failed to list unlinked signups:", err);
    res.status(502).json({ error: "Failed to list accounts from Clerk" });
  }
});

// POST /staff/:id/connect-account — dispatcher only. Directly links a
// signed-up cleaner account to a staff record and stores the account's
// verified email on it. Takes effect on the cleaner's next request.
router.post("/staff/:id/connect-account", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const params = ConnectStaffAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ConnectStaffAccountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { id } = params.data;
  const { clerkUserId } = body.data;

  const [target] = await db
    .select({ id: staffTable.id, clerkUserId: staffTable.clerkUserId })
    .from(staffTable)
    .where(eq(staffTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  if (target.clerkUserId) {
    res.status(409).json({ error: "This staff member is already connected to an account" });
    return;
  }

  const [[alreadyLinked], [isDispatcher]] = await Promise.all([
    db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(eq(staffTable.clerkUserId, clerkUserId)),
    db
      .select({ clerkUserId: dispatcherAllowlistTable.clerkUserId })
      .from(dispatcherAllowlistTable)
      .where(eq(dispatcherAllowlistTable.clerkUserId, clerkUserId)),
  ]);
  if (alreadyLinked) {
    res.status(409).json({ error: "That account is already connected to another staff member" });
    return;
  }
  if (isDispatcher) {
    res.status(400).json({ error: "That account has dispatcher access and can't be connected as a cleaner" });
    return;
  }

  let verifiedEmail: string | null = null;
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const verified = user.emailAddresses.filter(
      (e) => e.verification?.status === "verified",
    );
    verifiedEmail =
      (verified.find((e) => e.id === user.primaryEmailAddressId) ?? verified[0])
        ?.emailAddress ?? null;
  } catch {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (!verifiedEmail) {
    res.status(400).json({ error: "That account has no verified email address" });
    return;
  }

  // Conditional update so a concurrent connect/self-link can't double-assign
  // the staff row; the unique constraint on staff.clerk_user_id catches the
  // mirror race (same account connected to two rows at once) — map it to 409.
  let updated;
  try {
    [updated] = await db
      .update(staffTable)
      .set({ clerkUserId, email: verifiedEmail })
      .where(and(eq(staffTable.id, id), isNull(staffTable.clerkUserId)))
      .returning();
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "That account is already connected to another staff member" });
      return;
    }
    throw err;
  }
  if (!updated) {
    res.status(409).json({ error: "This staff member was just connected to another account" });
    return;
  }

  console.log(`[staff] record ${id} connected to ${clerkUserId} by dispatcher`);
  res.json(updated);
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

  // Deny unlinked/unrecognized accounts
  if (callerRole.role === "denied") {
    res.status(403).json({ error: "Forbidden: account not authorized. Contact a dispatcher." });
    return;
  }

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
    // clerkUserId — how a dispatcher links a cleaner's Clerk account to this staff record
    if (data.clerkUserId !== undefined) {
      // null = unlink; empty string treated as null; any other string = link
      updateData.clerkUserId =
        data.clerkUserId === null || data.clerkUserId === ""
          ? null
          : data.clerkUserId;
    }
  }

  // Self-service fields (both roles, own record only for cleaners — enforced above)
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.email !== undefined) {
    // null or empty string clears the email; anything else must be a valid address
    if (data.email === null || data.email === "") {
      updateData.email = null;
    } else if (!EMAIL_RE.test(data.email)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    } else {
      updateData.email = data.email;
    }
  }
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
// Cleaners may only fetch their OWN schedule.
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
  if (callerRole.role === "cleaner" && callerRole.staffId !== params.data.id) {
    res.status(403).json({ error: "Forbidden: cannot access another staff member's schedule" });
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

// POST /staff/import — bulk upsert staff records (dispatcher only)
// Matches existing records by name (case-insensitive). Updates if found, inserts if not.
// Preserves all fields including homeLat/homeLng so map pins survive the round-trip.
router.post("/staff/import", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const body = req.body;
  if (!Array.isArray(body)) {
    res.status(400).json({ error: "Request body must be an array of staff records" });
    return;
  }

  if (body.length === 0) {
    res.json({ imported: 0, created: 0, updated: 0, records: [] });
    return;
  }

  const VALID_ROLES = new Set(["cleaner", "lead_cleaner", "supervisor"]);

  type ImportRecord = {
    name: string;
    role: "cleaner" | "lead_cleaner" | "supervisor";
    phone: string | null;
    email: string | null;
    active: boolean;
    homeAddress: string | null;
    homeLat: number | null;
    homeLng: number | null;
  };

  // Strict validation — reject the entire batch on first invalid record
  const validRecords: ImportRecord[] = [];
  for (let i = 0; i < body.length; i++) {
    const item = body[i] as Record<string, unknown>;
    if (typeof item !== "object" || item === null) {
      res.status(400).json({ error: `Record at index ${i} is not an object` });
      return;
    }
    if (typeof item.name !== "string" || item.name.trim() === "") {
      res.status(400).json({ error: `Record at index ${i}: "name" must be a non-empty string` });
      return;
    }
    if (item.role !== undefined && !VALID_ROLES.has(item.role as string)) {
      res.status(400).json({
        error: `Record at index ${i}: "role" must be one of cleaner, lead_cleaner, supervisor (got ${JSON.stringify(item.role)})`,
      });
      return;
    }
    if (item.active !== undefined && typeof item.active !== "boolean") {
      res.status(400).json({
        error: `Record at index ${i}: "active" must be a boolean (got ${JSON.stringify(item.active)})`,
      });
      return;
    }
    if (item.homeLat !== undefined && item.homeLat !== null && typeof item.homeLat !== "number") {
      res.status(400).json({
        error: `Record at index ${i}: "homeLat" must be a number or null (got ${JSON.stringify(item.homeLat)})`,
      });
      return;
    }
    if (item.homeLng !== undefined && item.homeLng !== null && typeof item.homeLng !== "number") {
      res.status(400).json({
        error: `Record at index ${i}: "homeLng" must be a number or null (got ${JSON.stringify(item.homeLng)})`,
      });
      return;
    }
    if (item.email !== undefined && item.email !== null && typeof item.email !== "string") {
      res.status(400).json({
        error: `Record at index ${i}: "email" must be a string or null (got ${JSON.stringify(item.email)})`,
      });
      return;
    }
    if (
      typeof item.email === "string" &&
      item.email.trim() !== "" &&
      !EMAIL_RE.test(item.email.trim())
    ) {
      res.status(400).json({
        error: `Record at index ${i}: "email" is not a valid email address (got ${JSON.stringify(item.email)})`,
      });
      return;
    }
    validRecords.push({
      name: (item.name as string).trim(),
      role: (item.role as "cleaner" | "lead_cleaner" | "supervisor") ?? "cleaner",
      phone: typeof item.phone === "string" ? item.phone || null : null,
      email: typeof item.email === "string" ? item.email.trim() || null : null,
      active: typeof item.active === "boolean" ? item.active : true,
      homeAddress: typeof item.homeAddress === "string" ? item.homeAddress || null : null,
      homeLat: typeof item.homeLat === "number" ? item.homeLat : null,
      homeLng: typeof item.homeLng === "number" ? item.homeLng : null,
    });
  }

  // Run all DB writes in a single transaction — all-or-nothing
  const { created, updated } = await db.transaction(async (tx) => {
    // Build name→record map from DB; updated as we insert new records within the batch
    // so duplicate names in the import file update the earlier result rather than inserting twice.
    const existingStaff = await tx.select().from(staffTable);
    const existingByName = new Map(
      existingStaff.map((s) => [s.name.toLowerCase().trim(), s])
    );

    const created: (typeof staffTable.$inferSelect)[] = [];
    const updated: (typeof staffTable.$inferSelect)[] = [];

    for (const record of validRecords) {
      const key = record.name.toLowerCase().trim();
      const existing = existingByName.get(key);

      if (existing) {
        const [staff] = await tx
          .update(staffTable)
          .set({
            role: record.role as typeof staffTable.role._.data,
            phone: record.phone,
            email: record.email,
            active: record.active,
            homeAddress: record.homeAddress,
            homeLat: record.homeLat,
            homeLng: record.homeLng,
          })
          .where(eq(staffTable.id, existing.id))
          .returning();
        if (staff) {
          updated.push(staff);
          // Refresh map entry in case a later record in the batch also matches this name
          existingByName.set(key, staff);
        }
      } else {
        const [staff] = await tx
          .insert(staffTable)
          .values({
            name: record.name,
            role: record.role as typeof staffTable.role._.data,
            phone: record.phone,
            email: record.email,
            active: record.active,
            homeAddress: record.homeAddress,
            homeLat: record.homeLat,
            homeLng: record.homeLng,
          })
          .returning();
        if (staff) {
          created.push(staff);
          // Register the new record so any later duplicate name in this batch triggers an update
          existingByName.set(key, staff);
        }
      }
    }

    return { created, updated };
  });

  res.json({
    imported: created.length + updated.length,
    created: created.length,
    updated: updated.length,
    records: [...created, ...updated],
  });
});

// GET /schedule?date=YYYY-MM-DD — all staff schedules for a given day.
// Any linked team member (dispatcher or cleaner) may view the whole team's
// schedule — same policy as the Live Map (see routes/map.ts GET /map/data).
// Cleaners get a trimmed staff object (no email/phone); write access to
// bookings remains restricted to the cleaner's own jobs elsewhere.
router.get("/schedule", async (req, res): Promise<void> => {
  const caller = await guardStaff(req, res);
  if (!caller) return;

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
    // Cleaners see the team schedule but not teammates' contact details.
    staff:
      caller.role === "dispatcher"
        ? staff
        : { ...staff, email: null, phone: null, clerkUserId: null },
    bookings: bookings.filter((b) => b.staffId === staff.id),
  }));

  res.json(schedules);
});

export default router;
