// Shared Google Maps JS API loader.
// The key is fetched from the dispatcher-guarded API endpoint, then the Maps
// script is injected once and reused by every map on the site.

let gmapsPromise: Promise<void> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if ((window as any).google?.maps?.marker) return Promise.resolve();
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((resolve, reject) => {
    (window as any).__gmapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=marker&loading=async&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => { gmapsPromise = null; reject(new Error("Failed to load Google Maps")); };
    document.head.appendChild(s);
  });
  return gmapsPromise;
}

/** Fetch the Maps key and ensure the Maps JS API is loaded. baseUrl must NOT end with a slash. */
export async function ensureGoogleMaps(baseUrl: string): Promise<void> {
  if ((window as any).google?.maps?.marker) return;
  const res = await fetch(`${baseUrl}/api/map/maps-key`, { credentials: "include" });
  if (!res.ok) throw new Error("Could not load the map key");
  const { apiKey } = await res.json();
  await loadGoogleMaps(apiKey);
}

export function htmlToEl(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}
