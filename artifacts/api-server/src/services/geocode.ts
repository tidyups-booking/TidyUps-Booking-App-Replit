/**
 * Server-side geocoding via the Google Geocoding API.
 *
 * Used at Jobber sync time so imported bookings get address_lat/address_lng
 * stored once — map job pins then render instantly without the client having
 * to fall back to throttled Nominatim lookups.
 */

import { logger } from "../lib/logger.js";

/** In-memory cache: full address string → coords (or null for "not found"). */
const cache = new Map<string, { lat: number; lng: number } | null>();
const MAX_CACHE = 2000;

/** Placeholder used by the sync when Jobber has no property address. */
export const NO_ADDRESS_PLACEHOLDER = "Address not provided";

// ── Concurrency limiter ──────────────────────────────────────────────────────
// Bounds parallel Google Geocoding calls so a burst (e.g. a month view firing
// dozens of on-demand geocode requests) is paced instead of hitting Google all
// at once. Excess callers queue FIFO and still complete — just serialized into
// at most MAX_CONCURRENT_GEOCODES in-flight lookups. This caps worst-case
// spend velocity and avoids OVER_QUERY_LIMIT responses.
const MAX_CONCURRENT_GEOCODES = 3;
let activeGeocodes = 0;
const geocodeWaiters: Array<() => void> = [];

async function acquireGeocodeSlot(): Promise<void> {
  if (activeGeocodes < MAX_CONCURRENT_GEOCODES) {
    activeGeocodes++;
    return;
  }
  // The releasing caller hands its slot to us directly (activeGeocodes stays
  // unchanged during handoff), so do NOT increment again after resuming.
  await new Promise<void>((resolve) => geocodeWaiters.push(resolve));
}

function releaseGeocodeSlot(): void {
  const next = geocodeWaiters.shift();
  if (next) {
    // Atomic handoff: transfer the slot directly to the next waiter without
    // dropping activeGeocodes, so a newly arriving caller can't barge in
    // between the decrement and the waiter resuming (which would let the
    // in-flight count exceed the cap and break FIFO ordering).
    next();
  } else {
    activeGeocodes--;
  }
}

/**
 * Geocodes a street address to coordinates. Returns null when the API key is
 * missing, the address is a placeholder, or Google can't resolve it.
 * Transient failures (network / API errors) are NOT cached, so a later sync
 * can retry.
 */
export async function geocodeToCoords(
  street: string,
  city: string,
  province: string,
  postalCode?: string | null
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  if (!street || street === NO_ADDRESS_PLACEHOLDER) return null;

  const full = [street, city, province, postalCode, "Canada"]
    .filter(Boolean)
    .join(", ");

  if (cache.has(full)) return cache.get(full)!;

  await acquireGeocodeSlot();
  // A queued caller may find the answer cached by the request that just
  // finished ahead of it — return it without another Google lookup.
  if (cache.has(full)) {
    releaseGeocodeSlot();
    return cache.get(full)!;
  }

  try {
    const params = new URLSearchParams({
      address: full,
      components: "country:CA",
      key: apiKey,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = (await res.json()) as any;

    if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
      const { lat, lng } = data.results[0].geometry.location;
      if (typeof lat === "number" && typeof lng === "number") {
        setCached(full, { lat, lng });
        return { lat, lng };
      }
    }
    if (data.status === "ZERO_RESULTS") {
      // Definitive "not found" — cache so we don't re-ask every sync
      setCached(full, null);
      return null;
    }
    // OVER_QUERY_LIMIT / REQUEST_DENIED / etc — transient or config issue,
    // don't cache so a later sync retries.
    logger.warn(
      { status: data.status, error: data.error_message },
      "Geocoding API non-OK status"
    );
    return null;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Geocoding request failed");
    return null;
  } finally {
    releaseGeocodeSlot();
  }
}

function setCached(key: string, value: { lat: number; lng: number } | null) {
  if (cache.size >= MAX_CACHE) {
    // Drop the oldest entry (Map preserves insertion order)
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, value);
}
