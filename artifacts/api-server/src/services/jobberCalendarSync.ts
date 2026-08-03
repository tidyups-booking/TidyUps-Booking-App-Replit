/**
 * Jobber calendar sync — shared import logic used by both the manual
 * POST /jobber/sync-calendar route and the background auto-sync poller.
 *
 * Pulls Jobber JOBS filtered by scheduledBetween and upserts them into the
 * bookings table keyed on jobber_synced_job_id.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getStoredTokens, jobberGQL } from "./jobber.js";
import { logger } from "../lib/logger.js";

// ── Date helpers (America/Edmonton, DST-aware) ────────────────────────────────

/**
 * Returns the UTC offset string for America/Edmonton at a given date,
 * accounting for Daylight Saving Time (MDT = -06:00, MST = -07:00).
 */
export function edmontonOffset(dateStr: string): string {
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
export function parseEdmontonDateTime(isoStr: string): { date: string; time: string } {
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

/** Returns today's date string (YYYY-MM-DD) in America/Edmonton. */
function edmontonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobberJob = {
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

export interface CalendarSyncResult {
  synced: number;
  imported: number;
  skipped: number;
  cancelled: number;
  jobberCount: number;
  hitPageLimit: boolean;
}

/** Max pages of 100 jobs fetched per sync. */
const MAX_PAGES = 5;

// ── Shared upsert ─────────────────────────────────────────────────────────────

/** GraphQL selection set for a Jobber job — shared by list and single-job queries. */
const JOB_FIELDS = `
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
  }`;

/**
 * Upserts one Jobber job into the bookings table keyed on jobber_synced_job_id.
 * Returns false when the job has no startAt (nothing to place on the calendar).
 * Throws on database errors — callers decide how to count/log failures.
 */
async function upsertJobberJob(job: JobberJob): Promise<boolean> {
  if (!job.startAt) return false;

  const { date, time } = parseEdmontonDateTime(job.startAt);

  // Derive display values with safe fallbacks so scheduled jobs always
  // appear on the calendar even when optional Jobber fields are absent.
  const firstName = job.client?.firstName ?? job.title ?? "Jobber";
  const lastName = job.client?.lastName ?? "Job";
  const phone = job.client?.phone ?? "";
  const email = job.client?.email ?? null;
  const street = job.property?.address?.street ?? "Address not provided";
  const city = job.property?.address?.city ?? "Edmonton";
  const province = job.property?.address?.province ?? "AB";
  const postalCode = job.property?.address?.postalCode ?? null;

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
  return true;
}

/**
 * Targeted sync of a single Jobber job by ID — used by the webhook handler
 * so JOB_CREATE / JOB_UPDATE events land on the calendar near-instantly
 * without a full-window sync.
 * Returns "upserted", "skipped" (no startAt), or "not_found".
 * Throws if Jobber is not connected or the API call fails.
 */
export async function syncSingleJob(
  jobId: string
): Promise<"upserted" | "skipped" | "not_found"> {
  const tokens = await getStoredTokens();
  if (!tokens) throw new Error("Jobber not connected");

  const data = await jobberGQL<{ job: JobberJob | null }>(
    `query WebhookJob($id: EncodedId!) {
      job(id: $id) {${JOB_FIELDS}
      }
    }`,
    { id: jobId }
  );

  if (!data.job) return "not_found";
  return (await upsertJobberJob(data.job)) ? "upserted" : "skipped";
}

// ── Core sync ─────────────────────────────────────────────────────────────────

/**
 * Runs one calendar sync for the given date range (YYYY-MM-DD, inclusive).
 * Throws if Jobber is not connected or the Jobber API call fails.
 * Individual row upsert failures are logged and counted as skipped.
 */
export async function runCalendarSync(
  startDate: string,
  endDate: string,
  log: { warn: (obj: unknown, msg?: string) => void } = logger
): Promise<CalendarSyncResult> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    throw new Error("Jobber not connected");
  }

  // Build DST-aware Edmonton boundaries for scheduledBetween
  const startOffset = edmontonOffset(startDate);
  const endOffset = edmontonOffset(endDate);
  const scheduledStart = `${startDate}T00:00:00${startOffset}`;
  const scheduledEnd = `${endDate}T23:59:59${endOffset}`;

  // Paginate Jobber jobs (up to MAX_PAGES × 100)
  const jobberJobs: JobberJob[] = [];
  let cursor: string | null = null;
  let pages = 0;
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
        // Jobber API 2025-04-16: filter scheduled jobs by startAt range
        // (older versions used scheduledBetween, which no longer exists)
        filter: { startAt: { after: scheduledStart, before: scheduledEnd } },
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

  // Pre-fetch which Jobber job IDs are already locally present in
  // jobber_synced_job_id — the dedicated column for calendar-sync job IDs,
  // separate from jobber_job_id (Jobber request IDs from outbound sync).
  // This pre-SELECT gives accurate insert vs update counts without relying
  // on rowCount semantics.
  const jobIds = jobberJobs.map((j) => j.id);
  let existingIds = new Set<string>();
  if (jobIds.length > 0) {
    const existing = await db.execute<{ jobber_synced_job_id: string }>(
      sql`SELECT jobber_synced_job_id FROM bookings WHERE jobber_synced_job_id = ANY(${sql.param(jobIds)}::text[])`
    );
    existingIds = new Set(existing.rows.map((r) => r.jobber_synced_job_id));
  }

  let synced = 0;
  let imported = 0;
  let skipped = 0;

  for (const job of jobberJobs) {
    try {
      const upserted = await upsertJobberJob(job);
      if (!upserted) {
        skipped++; // unscheduled job — no appointment date to place on calendar
        continue;
      }
      if (existingIds.has(job.id)) synced++;
      else imported++;
    } catch (upsertErr: any) {
      skipped++;
      log.warn(
        { err: upsertErr.message, jobId: job.id },
        "Jobber calendar sync: upsert failed"
      );
    }
  }

  // ── Cancellation sweep ──────────────────────────────────────────────────────
  // Any local booking that was imported from Jobber (jobber_synced_job_id set),
  // falls inside this sync window, and no longer appears in the Jobber results
  // was cancelled/deleted in Jobber. Mark it cancelled locally (never delete —
  // history is preserved). Skipped entirely when the page limit was hit, since
  // the Jobber list would be incomplete and we could wrongly cancel bookings.
  let cancelled = 0;
  if (!hitPageLimit) {
    try {
      const jobIdSet = jobberJobs.map((j) => j.id);
      const result = await db.execute<{ id: string; jobber_synced_job_id: string }>(sql`
        UPDATE bookings
        SET status = 'cancelled'
        WHERE jobber_synced_job_id IS NOT NULL
          AND scheduled_date >= ${startDate}
          AND scheduled_date <= ${endDate}
          AND status <> 'cancelled'
          AND NOT (jobber_synced_job_id = ANY(${sql.param(jobIdSet)}::text[]))
        RETURNING id, jobber_synced_job_id
      `);
      cancelled = result.rows.length;
      if (cancelled > 0) {
        log.warn(
          {
            cancelled,
            jobberJobIds: result.rows.map((r) => r.jobber_synced_job_id),
          },
          "Jobber calendar sync: marked bookings cancelled (no longer in Jobber)"
        );
      }
    } catch (cancelErr: any) {
      log.warn(
        { err: cancelErr.message },
        "Jobber calendar sync: cancellation sweep failed"
      );
    }
  }

  return { synced, imported, skipped, cancelled, jobberCount: jobberJobs.length, hitPageLimit };
}

// ── Background auto-sync poller ───────────────────────────────────────────────

/** How often the background sync runs. */
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Rolling window the poller keeps fresh: today → +60 days. */
const POLL_WINDOW_DAYS = 60;

export interface AutoSyncStatus {
  lastRunAt: string | null; // ISO timestamp of last attempt
  lastSuccessAt: string | null; // ISO timestamp of last successful run
  lastError: string | null; // error message of the most recent failure (null if last run succeeded)
  lastResult: CalendarSyncResult | null;
}

const autoSyncStatus: AutoSyncStatus = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null,
};

/** Snapshot of the background sync state — surfaced via GET /jobber/status. */
export function getAutoSyncStatus(): AutoSyncStatus {
  return { ...autoSyncStatus };
}

let pollerStarted = false;
let running = false;

async function autoSyncTick(): Promise<void> {
  if (running) return; // never overlap runs
  running = true;
  try {
    const tokens = await getStoredTokens();
    if (!tokens) return; // Jobber not connected — nothing to do, not an error

    autoSyncStatus.lastRunAt = new Date().toISOString();

    const start = edmontonToday();
    const end = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000));

    const result = await runCalendarSync(start, end);
    autoSyncStatus.lastSuccessAt = new Date().toISOString();
    autoSyncStatus.lastError = null;
    autoSyncStatus.lastResult = result;

    if (result.imported > 0 || result.cancelled > 0) {
      logger.info(
        {
          imported: result.imported,
          updated: result.synced,
          cancelled: result.cancelled,
          jobberCount: result.jobberCount,
        },
        "Jobber auto-sync: calendar changes applied"
      );
    } else {
      logger.debug(
        { updated: result.synced, jobberCount: result.jobberCount },
        "Jobber auto-sync: up to date"
      );
    }
  } catch (err: any) {
    autoSyncStatus.lastError = err.message ?? String(err);
    logger.error({ err: err.message }, "Jobber auto-sync failed");
  } finally {
    running = false;
  }
}

/**
 * Starts the background poller that automatically pulls new Jobber
 * appointments every few minutes while Jobber is connected.
 * Safe to call once at server startup; subsequent calls are no-ops.
 */
export function startJobberAutoSync(): void {
  if (pollerStarted) return;
  pollerStarted = true;

  // First run shortly after boot (give the server a moment to settle),
  // then on a fixed interval.
  setTimeout(() => void autoSyncTick(), 15 * 1000);
  const timer = setInterval(() => void autoSyncTick(), POLL_INTERVAL_MS);
  timer.unref(); // don't keep the process alive just for the poller

  logger.info(
    { intervalMinutes: POLL_INTERVAL_MS / 60000, windowDays: POLL_WINDOW_DAYS },
    "Jobber auto-sync poller started"
  );
}
