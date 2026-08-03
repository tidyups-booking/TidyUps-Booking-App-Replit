import React, { useEffect, useRef, useState } from "react";
import { ensureGoogleMaps, htmlToEl } from "@/lib/google-maps";

// Compact Google Map for the New Booking form: shows the caller's address pin
// plus every cleaner (live GPS if sharing, otherwise home address) so the
// dispatcher can eyeball who's closest while still on the phone.

const CLEANER_COLORS = [
  "#EE3FCE", "#8870C4", "#3B82F6", "#10B981",
  "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];
function cleanerColor(id: number) { return CLEANER_COLORS[id % CLEANER_COLORS.length]; }
function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

function callerPinHtml() {
  return `
    <div style="width:36px;height:44px;display:flex;flex-direction:column;align-items:center;">
      <div style="width:32px;height:32px;border-radius:50% 50% 50% 4px;
        background:#EA4335;border:2.5px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;font-size:15px;">📍</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;
        border-top:7px solid #EA4335;margin-top:-1px;"></div>
    </div>`;
}

function cleanerPinHtml(id: number, name: string, isLive: boolean) {
  const color = cleanerColor(id);
  return `
    <div style="width:30px;height:36px;display:flex;flex-direction:column;align-items:center;" title="${esc(name)}">
      <div style="width:26px;height:26px;border-radius:50% 50% 50% 4px;
        background:${isLive ? color : "white"};color:${isLive ? "white" : color};
        border:2px ${isLive ? "solid white" : `dashed ${color}`};
        box-shadow:0 1px 6px rgba(0,0,0,0.22);
        display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;font-size:10px;font-weight:700;">${esc(initials(name))}</div>
      <div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
        border-top:5px solid ${color};margin-top:-1px;"></div>
    </div>`;
}

interface StaffPos { id: number; name: string; lat: number; lng: number; isLive: boolean }

interface Props {
  lat: number;
  lng: number;
  /** API base URL without trailing slash */
  baseUrl: string;
}

export function BookingMiniMap({ lat, lng, baseUrl }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [staffPos, setStaffPos] = useState<StaffPos[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Load Google Maps + cleaner positions once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [, posRes] = await Promise.all([
          ensureGoogleMaps(baseUrl),
          fetch(`${baseUrl}/api/map/data?date=${new Date().toISOString().split("T")[0]}`, { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (posRes.ok) {
          const data = await posRes.json();
          const positions: StaffPos[] = (data.staff ?? [])
            .map((s: any) => {
              if (s.position) return { id: s.id, name: s.name, lat: s.position.lat, lng: s.position.lng, isLive: s.position.source === "live" };
              if (s.homeLat != null && s.homeLng != null) return { id: s.id, name: s.name, lat: s.homeLat, lng: s.homeLng, isLive: false };
              return null;
            })
            .filter(Boolean);
          if (!cancelled) setStaffPos(positions);
        }
        if (!cancelled) setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Map unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [baseUrl]);

  // Render / update the map whenever coords or staff change
  const renderGenRef = useRef(0);
  useEffect(() => {
    if (!ready || !elRef.current) return;
    const gen = ++renderGenRef.current;
    const g = (window as any).google?.maps;
    if (!g) return;

    if (!mapRef.current) {
      mapRef.current = new g.Map(elRef.current, {
        center: { lat, lng },
        zoom: 12,
        mapId: "DEMO_MAP_ID",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "cooperative",
      });
    }
    const map = mapRef.current;

    // Clear + rebuild markers (few pins; simplest correct approach)
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];

    const caller = new g.marker.AdvancedMarkerElement({
      map, position: { lat, lng }, content: htmlToEl(callerPinHtml()), zIndex: 100,
    });
    markersRef.current.push(caller);

    const bounds = new g.LatLngBounds();
    bounds.extend({ lat, lng });
    staffPos.forEach(s => {
      const m = new g.marker.AdvancedMarkerElement({
        map, position: { lat: s.lat, lng: s.lng }, content: htmlToEl(cleanerPinHtml(s.id, s.name, s.isLive)),
      });
      markersRef.current.push(m);
      bounds.extend({ lat: s.lat, lng: s.lng });
    });

    if (staffPos.length > 0) {
      map.fitBounds(bounds, 40);
      g.event.addListenerOnce(map, "idle", () => {
        if (gen !== renderGenRef.current) return;
        if (mapRef.current && mapRef.current.getZoom() > 13) mapRef.current.setZoom(13);
      });
    } else {
      map.setCenter({ lat, lng });
      map.setZoom(13);
    }
  }, [ready, lat, lng, staffPos]);

  // Detach markers and drop map refs on unmount
  useEffect(() => {
    return () => {
      renderGenRef.current++;
      markersRef.current.forEach(m => { m.map = null; });
      markersRef.current = [];
      mapRef.current = null;
    };
  }, []);

  if (error) return null; // fail quietly — the form still works without the preview

  return (
    <div className="rounded-lg overflow-hidden border shadow-sm">
      <div ref={elRef} style={{ height: 220 }} className="w-full bg-muted/40" />
      <div className="px-3 py-1.5 bg-muted/40 text-[11px] text-muted-foreground flex items-center gap-3">
        <span>📍 Caller</span>
        <span>● Cleaner (live)</span>
        <span>◌ Cleaner (home)</span>
      </div>
    </div>
  );
}
