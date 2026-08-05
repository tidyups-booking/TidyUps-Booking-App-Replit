/**
 * Background geocode backfill for upcoming bookings.
 *
 * Jobber-synced bookings are geocoded at sync time, but bookings can still
 * land without stored coordinates (website form submissions, phone bookings
 * typed without picking an autocomplete suggestion, legacy rows). Those pins
 * previously geocoded one-by-one only when a dispatcher opened the map —
 * making the first map load slow.
 *
 * This poller finds upcoming bookings with a real address but no stored
 * coordinates, geocodes them via Google (paced by the shared concurrency
 * limiter in geocode.ts), and persists the result to
 * bookings.address_lat/address_lng — so the map serves every pin straight
 * from the database.
 *
 * MULTI-INSTANCE NOTE: safe on autoscale. Runs are idempotent — the UPDATE is
 * conditional on address_lat still being NULL and the address being unchanged,
 * so two instances racing simply write the same coords once; total Google
 * spend stays bounded because stored coords are never re-requested.
 */
import { and, asc, eq, gte, isNull, ne, notInArray } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { geocodeToCoords, NO_ADDRESS_PLACEHOLDER } from "./geocode.js";

/** How often to look for un-geocoded upcoming bookings. */
const BACKFILL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
/** Delay before the first run so it never competes with server boot. */
const FIRST_RUN_DELAY_MS = 15 * 1000;
/** Max bookings geocoded per run — bounds worst-case Google spend velocity. */
const BATCH_LIMIT = 40;

/** Business-local calendar date (YYYY-MM-DD) — bookings store Edmonton dates. */
function edmontonToday(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Edmonton",
  });
}

let running = false;

/**
 * Bookings whose address Google could not resolve (or that errored) this
 * process lifetime. Excluded from later selects so a block of permanently
 * un-geocodable rows can never starve valid rows behind them out of the
 * BATCH_LIMIT window. Per-instance by design: after a restart these are
 * retried once, and geocode.ts caches ZERO_RESULTS in memory, so repeat
 * lookups within a lifetime cost nothing.
 */
const skippedIds = new Set<number>();
const MAX_SKIPPED = 1000;

function rememberSkipped(id: number): void {
  if (skippedIds.size >= MAX_SKIPPED) {
    // Drop the oldest entries (Set preserves insertion order).
    const it = skippedIds.values();
    for (let i = 0; i < 100; i++) {
      const v = it.next();
      if (v.done) break;
      skippedIds.delete(v.value);
    }
  }
  skippedIds.add(id);
}

/** Test-only: inspect/reset the skip list. */
export function _skippedIdsForTest(): Set<number> {
  return skippedIds;
}

/**
 * One backfill pass. Exported for tests; never throws.
 * @param geocodeFn injectable for tests — production always uses the real
 *                  Google-backed geocodeToCoords.
 */
export async function runGeocodeBackfill(
  geocodeFn: typeof geocodeToCoords = geocodeToCoords
): Promise<{
  scanned: number;
  geocoded: number;
}> {
  if (running) return { scanned: 0, geocoded: 0 };
  running = true;
  try {
    const conditions = [
      isNull(bookingsTable.addressLat),
      gte(bookingsTable.scheduledDate, edmontonToday()),
      ne(bookingsTable.status, "cancelled"),
      ne(bookingsTable.address, NO_ADDRESS_PLACEHOLDER),
    ];
    if (skippedIds.size > 0) {
      conditions.push(notInArray(bookingsTable.id, [...skippedIds]));
    }
    const rows = await db
      .select({
        id: bookingsTable.id,
        address: bookingsTable.address,
        city: bookingsTable.city,
        province: bookingsTable.province,
        postalCode: bookingsTable.postalCode,
      })
      .from(bookingsTable)
      .where(and(...conditions))
      // Deterministic order: soonest jobs first, stable tiebreak — combined
      // with the skip list this guarantees forward progress through the set.
      .orderBy(asc(bookingsTable.scheduledDate), asc(bookingsTable.id))
      .limit(BATCH_LIMIT);

    if (rows.length === 0) return { scanned: 0, geocoded: 0 };

    let geocoded = 0;
    for (const row of rows) {
      try {
        const coords = await geocodeFn(
          row.address,
          row.city,
          row.province,
          row.postalCode
        );
        if (!coords) {
          // Unresolvable (or transient failure): remember it so the next
          // select moves past this row instead of rescanning it forever.
          rememberSkipped(row.id);
          continue;
        }

        // Conditional write: only fill still-missing coords for the same
        // address (an address edited mid-run must not get stale coords).
        const updated = await db
          .update(bookingsTable)
          .set({ addressLat: coords.lat, addressLng: coords.lng })
          .where(
            and(
              eq(bookingsTable.id, row.id),
              isNull(bookingsTable.addressLat),
              eq(bookingsTable.address, row.address)
            )
          )
          .returning({ id: bookingsTable.id });
        if (updated.length > 0) geocoded++;
      } catch (err: any) {
        rememberSkipped(row.id);
        logger.warn(
          { err: err.message, bookingId: row.id },
          "Geocode backfill: booking failed — skipping until next restart"
        );
      }
    }

    if (geocoded > 0) {
      logger.info(
        { scanned: rows.length, geocoded },
        "Geocode backfill: stored coordinates for upcoming bookings"
      );
    }
    return { scanned: rows.length, geocoded };
  } catch (err: any) {
    logger.warn({ err: err.message }, "Geocode backfill run failed");
    return { scanned: 0, geocoded: 0 };
  } finally {
    running = false;
  }
}

/**
 * On-demand geocode for a single booking (used when a dispatcher selects an
 * old/past booking whose coords the upcoming-only backfill never filled).
 *
 * Returns stored coords immediately when present; otherwise geocodes and
 * persists with the same conditional-update pattern as the backfill (only
 * fill still-NULL coords for the unchanged address). Returns null when the
 * address can't be resolved.
 *
 * @param geocodeFn injectable for tests — production uses the real
 *                  Google-backed geocodeToCoords.
 */
export async function geocodeBookingOnDemand(
  bookingId: number,
  geocodeFn: typeof geocodeToCoords = geocodeToCoords
): Promise<
  | { status: "ok"; lat: number; lng: number }
  | { status: "not_found" }
  | { status: "unresolvable" }
> {
  const [booking] = await db
    .select({
      id: bookingsTable.id,
      address: bookingsTable.address,
      city: bookingsTable.city,
      province: bookingsTable.province,
      postalCode: bookingsTable.postalCode,
      addressLat: bookingsTable.addressLat,
      addressLng: bookingsTable.addressLng,
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));

  if (!booking) return { status: "not_found" };

  // Already has coords (e.g. another client geocoded it moments ago) — return
  // them without hitting Google again.
  if (booking.addressLat != null && booking.addressLng != null) {
    return { status: "ok", lat: booking.addressLat, lng: booking.addressLng };
  }

  const coords = await geocodeFn(
    booking.address,
    booking.city,
    booking.province,
    booking.postalCode
  );
  if (!coords) return { status: "unresolvable" };

  // Conditional write: only fill still-missing coords for the same address
  // (an address edited mid-lookup must not get stale coords). If the row
  // changed under us, still return the freshly geocoded coords for display —
  // the next lookup will re-resolve against the new address.
  await db
    .update(bookingsTable)
    .set({ addressLat: coords.lat, addressLng: coords.lng })
    .where(
      and(
        eq(bookingsTable.id, booking.id),
        isNull(bookingsTable.addressLat),
        eq(bookingsTable.address, booking.address)
      )
    );

  return { status: "ok", lat: coords.lat, lng: coords.lng };
}

let started = false;

/** Starts the recurring backfill. Idempotent; call once at server startup. */
export function startGeocodeBackfill(): void {
  if (started) return;
  started = true;
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    logger.warn(
      "Geocode backfill disabled: GOOGLE_MAPS_API_KEY is not set"
    );
    return;
  }
  setTimeout(() => {
    void runGeocodeBackfill();
    setInterval(
      () => void runGeocodeBackfill(),
      BACKFILL_INTERVAL_MS
    ).unref?.();
  }, FIRST_RUN_DELAY_MS).unref?.();
}
