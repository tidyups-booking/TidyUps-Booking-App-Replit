import { Router } from "express";
import {
  getStoredTokens,
  exchangeCodeForTokens,
  getCallbackUrl,
  syncBookingToJobber,
  jobberGQL,
} from "../services/jobber.js";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware.js";
import { requireAuth } from "../app.js";
import { db } from "@workspace/db";
import { bookingsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const router = Router();

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";

// GET /jobber/redirect-uri — returns the current OAuth callback URL so the
// frontend can display it for copy-paste into the Jobber developer portal
router.get("/jobber/redirect-uri", (req, res) => {
  try {
    res.json({ redirectUri: getCallbackUrl(getClerkProxyHost(req)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobber/status — is Jobber connected?
router.get("/jobber/status", async (req, res) => {
  try {
    const tokens = await getStoredTokens();
    if (!tokens) {
      res.json({ connected: false });
      return;
    }
    // Token exists — check it hasn't expired
    const expired = tokens.expiresAt && tokens.expiresAt < new Date();
    if (expired) {
      res.json({ connected: false, stale: true });
      return;
    }
    res.json({ connected: true });
  } catch (err: any) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /jobber/auth — kick off OAuth
router.get("/jobber/auth", (req, res) => {
  const clientId = process.env.JOBBER_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: "JOBBER_CLIENT_ID not configured" });
    return;
  }

  let callbackUrl: string;
  try {
    // Use the live request host so this works on dev AND production domains
    callbackUrl = getCallbackUrl(getClerkProxyHost(req));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "read_clients write_clients read_jobs write_jobs",
  });

  res.redirect(`${JOBBER_AUTH_URL}?${params.toString()}`);
});

// GET /jobber/callback — Jobber redirects here with ?code=
router.get("/jobber/callback", async (req, res) => {
  // Log everything Jobber sends so we can debug
  req.log.info({ query: req.query }, "Jobber OAuth callback received");

  const { code, error, error_description } = req.query as {
    code?: string;
    error?: string;
    error_description?: string;
  };

  if (error) {
    const reason = error_description ? `${error}: ${error_description}` : error;
    req.log.warn({ error, error_description }, "Jobber OAuth error");
    res.redirect(`/?jobber=error&reason=${encodeURIComponent(reason)}`);
    return;
  }

  if (!code) {
    // Show a helpful page instead of blank 400
    const allParams = JSON.stringify(req.query, null, 2);
    res.status(400).send(`
      <h2>Jobber callback — no code received</h2>
      <p>Jobber redirected here but did not include an authorization code.</p>
      <p>This usually means the <strong>redirect URI</strong> in your Jobber app doesn't match exactly.</p>
      <p>Make sure your Jobber developer app has this redirect URI registered:</p>
      <code>https://${getClerkProxyHost(req)}${req.path}</code>
      <p>Raw query params received: <pre>${allParams}</pre></p>
    `);
    return;
  }

  try {
    const redirectUri = getCallbackUrl(getClerkProxyHost(req));
    await exchangeCodeForTokens(code, redirectUri);
    // Serve a small page that signals the opener via BroadcastChannel then
    // closes itself, so the original dashboard tab updates without a manual
    // refresh (Jobber blocks iframe embedding so we open OAuth in a new tab).
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Jobber Connected</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;background:#f0fdf4;color:#166534}
  .box{text-align:center;padding:2rem;border-radius:1rem;background:#dcfce7;
       border:1px solid #bbf7d0;max-width:320px}
  h2{margin:0 0 .5rem}p{margin:0;font-size:.9rem;color:#4b7c5d}
</style>
</head>
<body>
<div class="box">
  <h2>✓ Jobber Connected</h2>
  <p>This tab will close automatically…</p>
</div>
<script>
  try {
    const ch = new BroadcastChannel("jobber_oauth");
    ch.postMessage({ type: "connected" });
    ch.close();
  } catch (_) {}
  // Fall back to localStorage for browsers that don't support BroadcastChannel
  try {
    localStorage.setItem("jobber_oauth_signal", Date.now().toString());
  } catch (_) {}
  setTimeout(() => window.close(), 1200);
</script>
</body>
</html>`);
  } catch (err: any) {
    console.error("Jobber OAuth callback error:", err);
    // Serve an error page that also signals the opener, then closes
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Jobber Error</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;background:#fef2f2;color:#991b1b}
  .box{text-align:center;padding:2rem;border-radius:1rem;background:#fee2e2;
       border:1px solid #fecaca;max-width:360px}
  h2{margin:0 0 .5rem}p{margin:0;font-size:.85rem;color:#7f1d1d;word-break:break-word}
</style>
</head>
<body>
<div class="box">
  <h2>⚠ Jobber connection failed</h2>
  <p>${err.message}</p>
  <p style="margin-top:.75rem">You can close this tab and try again.</p>
</div>
<script>
  try {
    const ch = new BroadcastChannel("jobber_oauth");
    ch.postMessage({ type: "error", reason: ${JSON.stringify(err.message)} });
    ch.close();
  } catch (_) {}
  try {
    localStorage.setItem("jobber_oauth_signal", "error:" + Date.now());
  } catch (_) {}
</script>
</body>
</html>`);
  }
});

// POST /jobber/sync/:bookingId — manually sync one booking to Jobber
router.post("/jobber/sync/:bookingId", async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  if (isNaN(bookingId)) {
    res.status(400).json({ error: "Invalid booking ID" });
    return;
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  // Mark as pending before attempting
  await db
    .update(bookingsTable)
    .set({ jobberSyncStatus: "pending", jobberSyncError: null })
    .where(eq(bookingsTable.id, bookingId));

  try {
    const jobberRequestId = await syncBookingToJobber(booking);

    // Store the Jobber ID and mark as synced
    await db
      .update(bookingsTable)
      .set({ jobberJobId: jobberRequestId, jobberSyncStatus: "synced", jobberSyncError: null })
      .where(eq(bookingsTable.id, bookingId));

    res.json({ success: true, jobberRequestId });
  } catch (err: any) {
    // Persist the failure so the UI can surface it
    await db
      .update(bookingsTable)
      .set({ jobberSyncStatus: "failed", jobberSyncError: err.message })
      .where(eq(bookingsTable.id, bookingId));

    req.log.warn({ bookingId, err: err.message }, "Jobber sync failed");
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true only if the string is a real calendar date in YYYY-MM-DD format.
 * Rejects impossible dates like 2025-02-31 by round-tripping through Date.
 */
function isRealCalendarDate(s: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z"); // noon UTC avoids timezone day-shift
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Returns the UTC offset string for America/Edmonton at a given date,
 * accounting for Daylight Saving Time (MDT = -06:00, MST = -07:00).
 */
function edmontonOffset(dateStr: string): string {
  const pivot = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Edmonton",
    timeZoneName: "shortOffset",
  }).formatToParts(pivot);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-7";
  const match = tzPart.match(/GMT([+-]\d+)/);
  const hours = match ? parseInt(match[1], 10) : -7;
  return hours < 0
    ? `-${String(Math.abs(hours)).padStart(2, "0")}:00`
    : `+${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

/**
 * Given an ISO datetime string, returns { date: "YYYY-MM-DD", time: "HH:mm" }
 * in the America/Edmonton timezone so the record lands on the right calendar day.
 */
function parseEdmontonDateTime(isoStr: string): { date: string; time: string } {
  const dt = new Date(isoStr);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);

  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);

  return { date, time };
}

type JobberJob = {
  id: string;
  title: string;
  startAt: string | null;
  client: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
  } | null;
  property: {
    address: {
      street: string;
      city: string;
      province: string;
      postalCode: string;
    } | null;
  } | null;
};

// ---------------------------------------------------------------------------
// POST /jobber/sync-calendar
// Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
//
// Requires authentication (dispatcher/admin). Uses POST because it has
// write side-effects (upserts booking records).
//
// Pulls Jobber JOBS filtered by scheduledBetween. Jobs carry startAt — the
// actual scheduled appointment date/time — and are the correct entity for
// populating calendar views. (Our outbound sync creates Jobber requests via
// requestCreate; those requests become jobs once scheduled in Jobber. Any
// work created directly in Jobber also arrives here as a job.)
//
// Max sync window: 93 days. Results are complete within that window (up to
// 5 pages × 100 jobs = 500 jobs); if a page boundary is hit the response
// includes a warning so the caller knows to narrow the range.
//
// Insert vs update is determined by a pre-SELECT of existing jobberJobIds,
// avoiding reliance on implementation-specific rowCount behaviour.
//
// Uses America/Edmonton timezone for correct DST-aware date boundaries.
// Jobber API errors are logged server-side; clients receive only a generic msg.
// ---------------------------------------------------------------------------

/** Max allowed sync window in days. Keeps results complete within 500 jobs. */
const MAX_SYNC_DAYS = 93;

router.post("/jobber/sync-calendar", requireAuth, async (req, res) => {
  const startDate =
    typeof req.body?.startDate === "string" ? req.body.startDate.trim() : null;
  const endDate =
    typeof req.body?.endDate === "string" ? req.body.endDate.trim() : null;

  if (!startDate || !endDate) {
    res.status(400).json({ error: "startDate and endDate are required" });
    return;
  }
  if (!isRealCalendarDate(startDate) || !isRealCalendarDate(endDate)) {
    res.status(400).json({ error: "Dates must be valid calendar dates in YYYY-MM-DD format" });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ error: "startDate must be on or before endDate" });
    return;
  }

  // Enforce max window so results are always complete
  const dayDiff =
    (new Date(endDate).getTime() - new Date(startDate).getTime()) /
    (1000 * 60 * 60 * 24);
  if (dayDiff > MAX_SYNC_DAYS) {
    res.status(400).json({
      error: `Sync window cannot exceed ${MAX_SYNC_DAYS} days. Split into smaller ranges.`,
    });
    return;
  }

  try {
    const tokens = await getStoredTokens();
    if (!tokens) {
      res.json({ synced: 0, imported: 0, jobberCount: 0, warning: "Jobber not connected" });
      return;
    }

    // Build DST-aware Edmonton boundaries for scheduledBetween
    const startOffset = edmontonOffset(startDate);
    const endOffset = edmontonOffset(endDate);
    const scheduledStart = `${startDate}T00:00:00${startOffset}`;
    const scheduledEnd = `${endDate}T23:59:59${endOffset}`;

    // Paginate Jobber jobs (up to 5 pages × 100 = 500)
    const jobberJobs: JobberJob[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const MAX_PAGES = 5;
    let hitPageLimit = false;

    type JobberJobsGQLResponse = {
      jobs: {
        nodes: JobberJob[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const emptyPage: JobberJobsGQLResponse["jobs"] = {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    try {
      do {
        const gqlData: JobberJobsGQLResponse = await jobberGQL<JobberJobsGQLResponse>(
          `query SyncCalendarJobs($filter: JobFilterAttributes, $after: String) {
            jobs(filter: $filter, first: 100, after: $after) {
              nodes {
                id
                title
                startAt
                client {
                  firstName
                  lastName
                  phone
                  email
                }
                property {
                  address {
                    street
                    city
                    province
                    postalCode
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          {
            filter: { scheduledBetween: { startAt: scheduledStart, endAt: scheduledEnd } },
            after: cursor,
          }
        );

        const page: JobberJobsGQLResponse["jobs"] = gqlData.jobs ?? emptyPage;
        jobberJobs.push(...page.nodes);
        cursor = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null;
        pages++;

        if (cursor && pages >= MAX_PAGES) {
          hitPageLimit = true;
          cursor = null; // stop paging
        }
      } while (cursor);
    } catch (gqlErr: any) {
      (req as any).log?.warn({ err: gqlErr.message }, "Jobber sync-calendar: GraphQL error");
      res.json({
        synced: 0,
        imported: 0,
        jobberCount: 0,
        warning: "Jobber sync unavailable — check the Jobber connection",
      });
      return;
    }

    // Pre-fetch which Jobber job IDs are already locally present in
    // jobber_synced_job_id — the dedicated column for calendar-sync job IDs,
    // separate from jobber_job_id (Jobber request IDs from outbound sync).
    // Raw SQL avoids stale Drizzle type issues with the new column.
    // This pre-SELECT gives accurate insert vs update counts without relying
    // on rowCount semantics (PostgreSQL reports 1 for both INSERT and
    // ON CONFLICT DO UPDATE).
    const jobIds = jobberJobs.map((j) => j.id);
    let existingIds = new Set<string>();
    if (jobIds.length > 0) {
      const existing = await db.execute<{ jobber_synced_job_id: string }>(
        sql`SELECT jobber_synced_job_id FROM bookings WHERE jobber_synced_job_id = ANY(${jobIds}::text[])`
      );
      existingIds = new Set(existing.rows.map((r) => r.jobber_synced_job_id));
    }

    let synced = 0;
    let imported = 0;
    let skipped = 0;

    for (const job of jobberJobs) {
      if (!job.startAt) {
        skipped++;
        continue; // skip unscheduled jobs (no appointment date to place on calendar)
      }

      const { date, time } = parseEdmontonDateTime(job.startAt);

      // Derive display values with safe fallbacks so scheduled jobs always
      // appear on the calendar even when optional Jobber fields are absent.
      const firstName = job.client?.firstName ?? job.title ?? "Jobber";
      const lastName  = job.client?.lastName  ?? "Job";
      const phone     = job.client?.phone     ?? "";
      const email     = job.client?.email     ?? null;
      const street    = job.property?.address?.street   ?? "Address not provided";
      const city      = job.property?.address?.city     ?? "Edmonton";
      const province  = job.property?.address?.province ?? "AB";
      const postalCode = job.property?.address?.postalCode ?? null;

      try {
        // Raw SQL upsert on jobber_synced_job_id to avoid stale Drizzle types.
        // ON CONFLICT uses the unique index created in migration 002.
        await db.execute(sql`
          INSERT INTO bookings (
            first_name, last_name, phone, email,
            address, city, province, postal_code,
            service_type, bedrooms, bathrooms, extras,
            scheduled_date, scheduled_time,
            frequency, status,
            jobber_synced_job_id, jobber_sync_status
          ) VALUES (
            ${firstName}, ${lastName}, ${phone}, ${email},
            ${street}, ${city}, ${province}, ${postalCode},
            'standard_clean', 2, 1, '{}',
            ${date}, ${time},
            'one_time', 'confirmed',
            ${job.id}, 'synced'
          )
          ON CONFLICT (jobber_synced_job_id) DO UPDATE SET
            first_name         = EXCLUDED.first_name,
            last_name          = EXCLUDED.last_name,
            phone              = EXCLUDED.phone,
            email              = EXCLUDED.email,
            address            = EXCLUDED.address,
            city               = EXCLUDED.city,
            province           = EXCLUDED.province,
            postal_code        = EXCLUDED.postal_code,
            scheduled_date     = EXCLUDED.scheduled_date,
            scheduled_time     = EXCLUDED.scheduled_time,
            status             = EXCLUDED.status,
            jobber_sync_status = 'synced'
        `);

        if (existingIds.has(job.id)) synced++;
        else imported++;
      } catch (upsertErr: any) {
        skipped++;
        (req as any).log?.warn(
          { err: upsertErr.message, jobId: job.id },
          "Jobber sync-calendar: upsert failed"
        );
      }
    }

    const result: Record<string, unknown> = {
      synced,
      imported,
      skipped,
      jobberCount: jobberJobs.length,
    };
    if (skipped > 0) {
      result.skippedNote = `${skipped} job(s) skipped — missing scheduled time or client/address data`;
    }
    if (hitPageLimit) {
      result.warning = `Result may be incomplete — more than ${MAX_PAGES * 100} jobs found. Narrow the date range for a complete sync.`;
    }
    res.json(result);
  } catch (err: any) {
    (req as any).log?.error({ err: err.message }, "Jobber sync-calendar: unexpected error");
    res.status(500).json({ error: "Sync failed — please try again" });
  }
});

export default router;
