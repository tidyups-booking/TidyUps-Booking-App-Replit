// ── Geocode (server, on-demand) ──────────────────────────────────────────────
// Bookings missing stored coordinates ask the API server, which geocodes via
// Google and persists the result to the booking — so the pin is instant on
// every later visit. Shared by the Live Map and the Schedule search mini map.

const geocodeCache = new Map<number, [number, number] | null>();
// In-flight dedupe: month views + 30s repolls can ask for the same booking at
// once; requests join the existing promise instead of re-fetching.
const geocodeInflight = new Map<number, Promise<[number, number] | null>>();

export function geocodeBooking(
  baseUrl: string,
  bookingId: number
): Promise<[number, number] | null> {
  if (geocodeCache.has(bookingId)) return Promise.resolve(geocodeCache.get(bookingId)!);
  const inflight = geocodeInflight.get(bookingId);
  if (inflight) return inflight;

  const p = (async (): Promise<[number, number] | null> => {
    try {
      const res = await fetch(`${baseUrl}/api/map/bookings/${bookingId}/geocode`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 422) {
        // Definitive "address not geocodable" — don't re-ask this session
        geocodeCache.set(bookingId, null);
        return null;
      }
      if (!res.ok) return null; // transient — allow a later retry
      const data = await res.json();
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        const coord: [number, number] = [data.lat, data.lng];
        geocodeCache.set(bookingId, coord);
        return coord;
      }
      return null;
    } catch {
      // Transient failure — don't cache, allow a later retry
      return null;
    }
  })();
  geocodeInflight.set(bookingId, p);
  p.finally(() => geocodeInflight.delete(bookingId));
  return p;
}
