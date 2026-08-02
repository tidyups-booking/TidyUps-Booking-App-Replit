import React, { useEffect, useRef, useState, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useListStaff } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Users, Home, Clock, Wifi, WifiOff } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface StaffLocation {
  id: number;
  name: string;
  role: string;
  location: { lat: number; lng: number; updatedAt: string } | null;
}

interface BookingPin {
  id: number;
  customerName: string;
  address: string;
  city: string;
  scheduledTime: string | null;
  staffId: number | null;
  lat?: number;
  lng?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CLEANER_COLORS = [
  "#EE3FCE", "#8870C4", "#3B82F6", "#10B981",
  "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];

function cleanerColor(staffId: number) {
  return CLEANER_COLORS[staffId % CLEANER_COLORS.length];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Leaflet DivIcons ─────────────────────────────────────────────────────────

function makeCleanerIcon(staff: StaffLocation, isStale: boolean) {
  const color = cleanerColor(staff.id);
  const ini = initials(staff.name);
  const opacity = isStale ? 0.45 : 1;
  const html = `
    <div style="
      width:44px;height:52px;display:flex;flex-direction:column;
      align-items:center;gap:0;opacity:${opacity};
    ">
      <div style="
        width:40px;height:40px;border-radius:50% 50% 50% 4px;
        background:${color};
        border:2.5px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.28);
        display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;font-size:13px;font-weight:700;color:white;
        flex-shrink:0;
      ">${ini}</div>
      <div style="
        width:0;height:0;
        border-left:5px solid transparent;
        border-right:5px solid transparent;
        border-top:7px solid ${color};
        margin-top:-1px;
      "></div>
    </div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [44, 52],
    iconAnchor: [22, 52],
    popupAnchor: [0, -54],
  });
}

function makeJobIcon(color: string) {
  const html = `
    <div style="
      width:32px;height:36px;display:flex;flex-direction:column;
      align-items:center;
    ">
      <div style="
        width:28px;height:28px;border-radius:6px 6px 6px 4px;
        background:white;
        border:2px solid ${color};
        box-shadow:0 2px 6px rgba(0,0,0,0.22);
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
      ">🏠</div>
      <div style="
        width:0;height:0;
        border-left:4px solid transparent;
        border-right:4px solid transparent;
        border-top:5px solid ${color};
        margin-top:-1px;
      "></div>
    </div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [32, 36],
    iconAnchor: [16, 36],
    popupAnchor: [0, -38],
  });
}

// ── Geocode helper (Nominatim) ───────────────────────────────────────────────

const geocodeCache = new Map<string, [number, number] | null>();

async function geocodeAddress(address: string, city: string): Promise<[number, number] | null> {
  const key = `${address}, ${city}, AB, Canada`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(key)}&format=json&limit=1&countrycodes=ca`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "833TidyupsDispatch/1.0" },
    });
    const data = await res.json();
    if (data.length > 0) {
      const coord: [number, number] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      geocodeCache.set(key, coord);
      return coord;
    }
  } catch {
    // ignore
  }
  geocodeCache.set(key, null);
  return null;
}

// ── Tracking hours helper ────────────────────────────────────────────────────

function isTrackingHours() {
  const h = new Date().getHours();
  return h >= 8 && h < 20;
}

function secondsAgo(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 1000);
}

function formatAgo(iso: string) {
  const s = secondsAgo(iso);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Main component ───────────────────────────────────────────────────────────

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export default function MapPage() {
  const mapRef = useRef<L.Map | null>(null);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const [staffData, setStaffData] = useState<StaffLocation[]>([]);
  const [bookings, setBookings] = useState<BookingPin[]>([]);
  const [myStaffId, setMyStaffId] = useState<number | null>(() => {
    const saved = localStorage.getItem("cleaner_map_staff_id");
    return saved ? parseInt(saved, 10) : null;
  });
  const [sharing, setSharing] = useState(false);
  const [lastPing, setLastPing] = useState<Date | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const { data: allStaff = [] } = useListStaff({ activeOnly: true });

  const today = new Date().toISOString().split("T")[0];
  const baseUrl = getBaseUrl();

  // ── Fetch map data ──────────────────────────────────────────────────────────
  const fetchMapData = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/map/data?date=${today}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setStaffData(data.staff);
      setBookings(
        data.bookings.map((b: any) => ({
          id: b.id,
          customerName: `${b.firstName} ${b.lastName}`,
          address: b.address,
          city: b.city,
          scheduledTime: b.scheduledTime,
          staffId: b.staffId,
        }))
      );
    } catch {
      // ignore
    }
  }, [baseUrl, today]);

  useEffect(() => {
    fetchMapData();
    const interval = setInterval(fetchMapData, 30_000);
    return () => clearInterval(interval);
  }, [fetchMapData]);

  // ── Init Leaflet ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const map = L.map(mapElRef.current, {
      center: [53.5461, -113.4938], // Edmonton
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Update cleaner markers ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    staffData.forEach((s) => {
      if (!s.location) return;
      const key = `cleaner-${s.id}`;
      seen.add(key);

      const stale = secondsAgo(s.location.updatedAt) > 300; // >5 min
      const icon = makeCleanerIcon(s, stale);
      const popup = `
        <div style="font-family:sans-serif;min-width:140px">
          <strong style="color:${cleanerColor(s.id)}">${s.name}</strong><br/>
          <span style="color:#888;font-size:12px">${s.role.replace("_", " ")}</span><br/>
          <span style="font-size:12px">📍 Updated ${formatAgo(s.location.updatedAt)}</span>
        </div>`;

      const existing = markersRef.current.get(key);
      if (existing) {
        existing.setLatLng([s.location.lat, s.location.lng]);
        existing.setIcon(icon);
        existing.setPopupContent(popup);
      } else {
        const m = L.marker([s.location.lat, s.location.lng], { icon })
          .addTo(map)
          .bindPopup(popup);
        markersRef.current.set(key, m);
      }
    });

    // Remove stale cleaner markers
    markersRef.current.forEach((m, key) => {
      if (key.startsWith("cleaner-") && !seen.has(key)) {
        m.remove();
        markersRef.current.delete(key);
      }
    });
  }, [staffData]);

  // ── Geocode + update job markers ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const staffMap = new Map(staffData.map((s) => [s.id, s]));

    bookings.forEach(async (b, i) => {
      const key = `job-${b.id}`;
      if (markersRef.current.has(key)) return; // already pinned

      // Stagger requests to be Nominatim-friendly
      await new Promise((r) => setTimeout(r, i * 400));
      const coords = await geocodeAddress(b.address, b.city);
      if (!coords) return;
      if (!mapRef.current) return;

      const assignee = b.staffId ? staffMap.get(b.staffId) : null;
      const color = assignee ? cleanerColor(assignee.id) : "#6B7280";
      const icon = makeJobIcon(color);
      const popup = `
        <div style="font-family:sans-serif;min-width:140px">
          <strong>${b.customerName}</strong><br/>
          <span style="font-size:12px">⏰ ${b.scheduledTime ?? "TBD"}</span><br/>
          <span style="font-size:12px">📍 ${b.address}, ${b.city}</span><br/>
          ${assignee ? `<span style="font-size:12px;color:${color}">👤 ${assignee.name}</span>` : '<span style="font-size:12px;color:#888">Unassigned</span>'}
        </div>`;

      const m = L.marker(coords, { icon }).addTo(mapRef.current).bindPopup(popup);
      markersRef.current.set(key, m);
    });
  }, [bookings, staffData]);

  // ── GPS tracking (cleaner view) ──────────────────────────────────────────────
  const postLocation = useCallback(
    async (lat: number, lng: number, accuracy?: number) => {
      if (!myStaffId) return;
      try {
        await fetch(`${baseUrl}/api/staff/${myStaffId}/location`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, accuracy }),
        });
        setLastPing(new Date());
        setGeoError(null);
      } catch {
        // ignore — will retry
      }
    },
    [myStaffId, baseUrl]
  );

  useEffect(() => {
    if (!myStaffId || !navigator.geolocation) return;

    if (!isTrackingHours()) {
      setSharing(false);
      return;
    }

    setSharing(true);

    // Watch position — browser calls this whenever position changes
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        postLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      (err) => {
        setGeoError(err.message);
        setSharing(false);
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 }
    );

    // Also ping on a 30s interval (in case watchPosition fires infrequently)
    const interval = setInterval(() => {
      if (!isTrackingHours()) {
        setSharing(false);
        clearInterval(interval);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => postLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => {}
      );
    }, 30_000);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      clearInterval(interval);
      setSharing(false);
    };
  }, [myStaffId, postLocation]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function selectMyself(id: number) {
    setMyStaffId(id);
    localStorage.setItem("cleaner_map_staff_id", String(id));
  }

  function stopSharing() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setMyStaffId(null);
    setSharing(false);
    localStorage.removeItem("cleaner_map_staff_id");
  }

  const onlineCount = staffData.filter(
    (s) => s.location && secondsAgo(s.location.updatedAt) < 300
  ).length;

  const myStaff = allStaff.find((s: any) => s.id === myStaffId);

  return (
    <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">Live Map</h1>
          <p className="text-muted-foreground">
            Cleaner positions &amp; today's jobs — updates every 30s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <Users className="w-3.5 h-3.5" />
            {onlineCount} / {staffData.length} online
          </Badge>
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <Home className="w-3.5 h-3.5" />
            {bookings.length} jobs today
          </Badge>
        </div>
      </div>

      {/* Cleaner self-identification */}
      <Card className="border-t-4 border-t-primary shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Navigation className="w-4 h-4 text-primary" />
            Cleaner — Share Your Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!myStaffId ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Are you a cleaner? Tap your name to start sharing your location
                (8 AM – 8 PM only).
              </p>
              <div className="flex flex-wrap gap-2">
                {allStaff.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => selectMyself(s.id)}
                    className="px-4 py-2 rounded-full text-sm font-medium border border-border hover:border-primary/60 hover:bg-primary/5 transition-all"
                    style={{ borderColor: cleanerColor(s.id) + "44" }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{ background: cleanerColor(s.id) }}
                    />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ background: cleanerColor(myStaffId) }}
                >
                  {initials(myStaff?.name ?? "?")}
                </div>
                <div>
                  <p className="font-medium">{myStaff?.name}</p>
                  <div className="flex items-center gap-1.5 text-sm">
                    {sharing && isTrackingHours() ? (
                      <>
                        <Wifi className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-green-600 font-medium">Sharing live</span>
                        {lastPing && (
                          <span className="text-muted-foreground">
                            · pinged {lastPing.toLocaleTimeString()}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {!isTrackingHours()
                            ? "Outside tracking hours (8 AM–8 PM)"
                            : geoError ?? "Location unavailable"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={stopSharing}>
                Not me
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Map */}
      <Card className="overflow-hidden shadow-md">
        <div ref={mapElRef} style={{ height: 520 }} className="w-full" />
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-primary/80 flex items-center justify-center text-white text-[9px] font-bold">AB</div>
          Cleaner (live)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-primary/25 border border-primary/40 flex items-center justify-center text-[9px] font-bold">AB</div>
          Cleaner (stale &gt;5 min)
        </div>
        <div className="flex items-center gap-1.5">
          <span>🏠</span> Today's job (colored border = assigned cleaner)
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Map refreshes every 30s
        </div>
      </div>
    </div>
  );
}
