import { or, ilike, eq, desc, sql, type SQL } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

// Shared search conditions for GET /bookings?q= and GET /bookings/customers/search.
//
// IMPORTANT: every ILIKE expression here must have a matching pg_trgm GIN index
// on the *exact same expression* (see lib/db/migrations/016_add_booking_search_trgm_indexes.sql),
// otherwise search silently falls back to sequential scans as the table grows.
// The e2e-booking-search-perf-check.mts script imports these builders, runs
// them against a 50k-row scratch table via EXPLAIN ANALYZE, and fails if any
// condition triggers a Seq Scan or exceeds the latency budget — so adding a
// new condition here without a matching index will fail that check.

/**
 * Search conditions for GET /bookings?q= — matches address, city,
 * client name (first/last/full), and phone (formatted or digits-only).
 */
export function buildBookingSearchCondition(search: string): SQL {
  const pattern = `%${search}%`;
  const conditions: SQL[] = [
    ilike(bookingsTable.address, pattern),
    ilike(bookingsTable.city, pattern),
    ilike(bookingsTable.firstName, pattern),
    ilike(bookingsTable.lastName, pattern),
    ilike(sql`${bookingsTable.firstName} || ' ' || ${bookingsTable.lastName}`, pattern),
    ilike(bookingsTable.phone, pattern),
  ];
  // Digits-only match against normalized phone so "4035551234" finds
  // "(403) 555-1234". Matches the trgm expression index on the same
  // regexp_replace expression (016 migration) so this stays indexed —
  // the old interleaved '%4%0%3%…' pattern defeated trigram indexes.
  const digits = search.replace(/\D/g, "");
  if (digits.length >= 3) {
    conditions.push(
      ilike(sql`regexp_replace(${bookingsTable.phone}, '\\D', '', 'g')`, `%${digits}%`),
    );
  }
  return or(...conditions)!;
}

/**
 * Grouped customer-autocomplete query for GET /bookings/customers/search.
 *
 * One row per customer (keyed by digits-only phone, falling back to
 * lowercased name+address) with a TRUE total booking count computed by the
 * database over ALL matching rows — not a 50-row window — so repeat customers
 * with many bookings keep an accurate count at any table size. Each entry
 * carries the customer's most recent booking (max id) for form pre-fill.
 *
 * The e2e perf check imports this builder and EXPLAINs it against a 50k-row
 * scratch table, so shape changes here stay covered automatically.
 */
export function buildCustomerSearchQuery(q: string, limit = 6) {
  const customerKey = sql`coalesce(nullif(regexp_replace(${bookingsTable.phone}, '\\D', '', 'g'), ''), lower(${bookingsTable.firstName} || ' ' || ${bookingsTable.lastName} || ' ' || ${bookingsTable.address}))`;
  const agg = db
    .select({
      latestId: sql<number>`max(${bookingsTable.id})`.as("latest_id"),
      bookingCount: sql<number>`count(*)::int`.as("booking_count"),
    })
    .from(bookingsTable)
    .where(buildCustomerSearchCondition(q))
    .groupBy(customerKey)
    .as("agg");
  return db
    .select({ booking: bookingsTable, bookingCount: agg.bookingCount })
    .from(agg)
    .innerJoin(bookingsTable, eq(bookingsTable.id, agg.latestId))
    .orderBy(desc(agg.latestId))
    .limit(limit);
}

/**
 * Search conditions for GET /bookings/customers/search — returning-customer
 * autocomplete: matches name (first/last/full), address, and phone.
 */
export function buildCustomerSearchCondition(q: string): SQL {
  const pattern = `%${q}%`;
  const conditions: SQL[] = [
    ilike(bookingsTable.firstName, pattern),
    ilike(bookingsTable.lastName, pattern),
    ilike(sql`${bookingsTable.firstName} || ' ' || ${bookingsTable.lastName}`, pattern),
    ilike(bookingsTable.address, pattern),
    ilike(bookingsTable.phone, pattern),
  ];
  // Digits-only match against normalized phone; indexed via the
  // regexp_replace expression index from migration 016.
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3) {
    conditions.push(
      ilike(sql`regexp_replace(${bookingsTable.phone}, '\\D', '', 'g')`, `%${digits}%`),
    );
  }
  return or(...conditions)!;
}
