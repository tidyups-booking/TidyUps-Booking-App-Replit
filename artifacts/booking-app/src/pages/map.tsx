import React, { useEffect, useRef, useState, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useListStaff } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Users, Home, Clock, Wifi, WifiOff, ChevronLeft, ChevronRight, Calendar, RefreshCw, CalendarDays, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, subDays, parseISO, isToday as dateFnsIsToday, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { MonthCalendar, ColumnCalendar, type CalendarBooking } from "@/components/map-calendar";

type CalendarView = "day" | "3day" | "week" | "month";

// ── Types ────────────────────────────────────────────────────────────────────

interface Position { lat: number; lng: number; source: "live" | "home" }

interface StaffEntry {
  id: number;
  name: string;
  role: string;
  homeAddress: string | null;
  homeLat: number | null;
  homeLng: number | null;
  liveLocation: { lat: number; lng: number; updatedAt: string } | null;
  position: Position | null;
}

interface BookingEntry {
  id: number;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  scheduledTime: string | null;
  staffId: number | null;
  addressLat?: number | null;
  addressLng?: number | null;
  // enriched client-side:
  coords?: [number, number] | null;
  ranking?: { id: number; name: string; km: number }[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const CLEANER_COLORS = [
  "#EE3FCE", "#8870C4", "#3B82F6", "#10B981",
  "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];
function cleanerColor(id: number) { return CLEANER_COLORS[id % CLEANER_COLORS.length]; }
function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

// ── Leaflet DivIcons ─────────────────────────────────────────────────────────

function makeCleanerIcon(s: StaffEntry, isStale: boolean) {
  const color = cleanerColor(s.id);
  const ini = initials(s.name);
  const isHome = s.position?.source === "home";
  const opacity = isStale ? 0.45 : 1;
  const border = isHome ? `border:2px dashed ${color};` : `border:2.5px solid white;`;
  const html = `
    <div style="width:44px;height:52px;display:flex;flex-direction:column;align-items:center;opacity:${opacity}">
      <div style="width:40px;height:40px;border-radius:50% 50% 50% 4px;
        background:${isHome ? "white" : color};
        color:${isHome ? color : "white"};
        ${border}
        box-shadow:0 2px 8px rgba(0,0,0,0.25);
        display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;font-size:13px;font-weight:700;flex-shrink:0;">
        ${ini}
      </div>
      <div style="width:0;height:0;
        border-left:5px solid transparent;border-right:5px solid transparent;
        border-top:7px solid ${color};margin-top:-1px;"></div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [44, 52], iconAnchor: [22, 52], popupAnchor: [0, -54] });
}

/** Small house pin — always-on home address marker for each staff member. */
function makeHomeIcon(s: StaffEntry) {
  const color = cleanerColor(s.id);
  const ini = initials(s.name);
  const html = `
    <div style="width:36px;height:44px;display:flex;flex-direction:column;align-items:center;">
      <div style="width:32px;height:32px;border-radius:50% 50% 50% 4px;
        background:white;color:${color};
        border:2px dashed ${color};
        box-shadow:0 1px 6px rgba(0,0,0,0.18);
        display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;font-size:11px;font-weight:700;flex-shrink:0;">
        ${ini}
      </div>
      <div style="width:0;height:0;
        border-left:4px solid transparent;border-right:4px solid transparent;
        border-top:6px solid ${color};margin-top:-1px;opacity:0.6;"></div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [36, 44], iconAnchor: [18, 44], popupAnchor: [0, -46] });
}

function makeJobIcon(borderColor: string, isNearest: boolean) {
  const bg = isNearest ? borderColor : "white";
  const emoji = isNearest ? "🏠" : "🏠";
  const html = `
    <div style="width:34px;height:40px;display:flex;flex-direction:column;align-items:center;">
      <div style="width:30px;height:30px;border-radius:8px 8px 8px 4px;
        background:${bg};border:2.5px solid ${borderColor};
        box-shadow:0 2px 7px rgba(0,0,0,0.22);
        display:flex;align-items:center;justify-content:center;font-size:14px;">
        ${emoji}
      </div>
      <div style="width:0;height:0;
        border-left:4px solid transparent;border-right:4px solid transparent;
        border-top:6px solid ${borderColor};margin-top:-1px;"></div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [34, 40], iconAnchor: [17, 40], popupAnchor: [0, -42] });
}

// ── Geocode (Nominatim) ───────────────────────────────────────────────────────

const geocodeCache = new Map<string, [number, number] | null>();

async function geocodeAddress(address: string, city: string): Promise<[number, number] | null> {
  const key = `${address}, ${city}, AB, Canada`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(key)}&format=json&limit=1&countrycodes=ca`;
    const res = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "833TidyupsDispatch/1.0" } });
    const data = await res.json();
    if (data.length > 0) {
      const coord: [number, number] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      geocodeCache.set(key, coord);
      return coord;
    }
  } catch { /* ignore */ }
  geocodeCache.set(key, null);
  return null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function secondsAgo(iso: string) { return Math.round((Date.now() - new Date(iso).getTime()) / 1000); }
function formatAgo(iso: string) {
  const s = secondsAgo(iso);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function isTrackingHours() { const h = new Date().getHours(); return h >= 8 && h < 20; }

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

// ── Proximity popup HTML ─────────────────────────────────────────────────────

function buildJobPopup(b: BookingEntry, staffMap: Map<number, StaffEntry>) {
  const assignee = b.staffId ? staffMap.get(b.staffId) : null;
  const ranking = b.ranking ?? [];

  const rankingRows = ranking.map((r, i) => {
    const color = cleanerColor(r.id);
    const medal = i === 0 ? "🟢" : i === ranking.length - 1 ? "🔴" : "⚪";
    const label = i === 0 ? " (closest)" : i === ranking.length - 1 ? " (farthest)" : "";
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;">
      <span>${medal}</span>
      <span style="color:${color};font-weight:600;">${r.name}</span>
      <span style="color:#888;margin-left:auto;">${r.km.toFixed(1)} km${label}</span>
    </div>`;
  }).join("");

  return `
    <div style="font-family:sans-serif;min-width:200px;max-width:260px;">
      <strong style="font-size:13px;">${b.firstName} ${b.lastName}</strong><br/>
      ${b.scheduledTime ? `<span style="font-size:12px;color:#555;">⏰ ${b.scheduledTime}</span><br/>` : ""}
      <span style="font-size:11px;color:#888;">📍 ${b.address}, ${b.city}</span><br/>
      ${assignee
        ? `<span style="font-size:12px;color:${cleanerColor(assignee.id)};font-weight:600;">👤 Assigned: ${assignee.name}</span>`
        : `<span style="font-size:12px;color:#888;">👤 Unassigned</span>`}
      ${ranking.length > 0 ? `
        <div style="margin-top:8px;border-top:1px solid #eee;padding-top:6px;">
          <div style="font-size:11px;color:#888;font-weight:600;margin-bottom:4px;">CLEANERS BY DISTANCE</div>
          ${rankingRows}
        </div>` : ""}
    </div>`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MapPage() {
  const mapRef = useRef<L.Map | null>(null);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapCardRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [staffData, setStaffData] = useState<StaffEntry[]>([]);
  const [bookings, setBookings] = useState<BookingEntry[]>([]);
  const [isToday, setIsToday] = useState(true);

  const [myStaffId, setMyStaffId] = useState<number | null>(() => {
    const saved = localStorage.getItem("cleaner_map_staff_id");
    return saved ? parseInt(saved, 10) : null;
  });
  const [sharing, setSharing] = useState(false);
  const [lastPing, setLastPing] = useState<Date | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // ── Calendar view state ───────────────────────────────────────────────────────
  const [calendarView, setCalendarView] = useState<CalendarView>("day");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({});
  const [bookingsByDate, setBookingsByDate] = useState<Record<string, CalendarBooking[]>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const { data: allStaff = [] } = useListStaff({ activeOnly: true });
  const baseUrl = getBaseUrl();

  // ── Fetch map data ──────────────────────────────────────────────────────────
  const fetchMapData = useCallback(async (date: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/map/data?date=${date}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setStaffData(data.staff);
      setIsToday(data.isToday);
      setBookings(
        data.bookings.map((b: any) => ({
          id: b.id,
          firstName: b.firstName,
          lastName: b.lastName,
          address: b.address,
          city: b.city,
          scheduledTime: b.scheduledTime,
          staffId: b.staffId,
          addressLat: b.addressLat ?? null,
          addressLng: b.addressLng ?? null,
        }))
      );
    } catch { /* ignore */ }
  }, [baseUrl]);

  useEffect(() => {
    fetchMapData(selectedDate);
    const interval = setInterval(() => fetchMapData(selectedDate), 30_000);
    return () => clearInterval(interval);
  }, [fetchMapData, selectedDate]);

  // ── Calendar helper functions ─────────────────────────────────────────────────

  function getViewDates(): Date[] {
    const anchor = parseISO(selectedDate);
    if (calendarView === "3day") {
      return [-1, 0, 1].map(d => addDays(anchor, d));
    }
    if (calendarView === "week") {
      const dayOfWeek = (anchor.getDay() + 6) % 7; // 0=Mon
      const monday = subDays(anchor, dayOfWeek);
      return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    }
    return [];
  }

  const fetchCounts = useCallback(async (monthDate: Date) => {
    const startDate = format(startOfMonth(monthDate), "yyyy-MM-dd");
    const endDate = format(endOfMonth(monthDate), "yyyy-MM-dd");
    try {
      const res = await fetch(`${baseUrl}/api/map/counts?startDate=${startDate}&endDate=${endDate}`, {
        credentials: "include",
      });
      if (res.ok) setDayCounts(await res.json());
    } catch { /* ignore */ }
  }, [baseUrl]);

  const fetchRange = useCallback(async (dates: Date[]) => {
    if (dates.length === 0) return;
    const startDate = format(dates[0], "yyyy-MM-dd");
    const endDate = format(dates[dates.length - 1], "yyyy-MM-dd");
    try {
      const res = await fetch(`${baseUrl}/api/map/range?startDate=${startDate}&endDate=${endDate}`, {
        credentials: "include",
      });
      if (res.ok) setBookingsByDate(await res.json());
    } catch { /* ignore */ }
  }, [baseUrl]);

  const syncFromJobber = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    let startDate: string, endDate: string;
    if (calendarView === "month") {
      startDate = format(startOfMonth(calendarMonth), "yyyy-MM-dd");
      endDate = format(endOfMonth(calendarMonth), "yyyy-MM-dd");
    } else {
      const viewDates = getViewDates();
      startDate = viewDates.length > 0 ? format(viewDates[0], "yyyy-MM-dd") : selectedDate;
      endDate = viewDates.length > 0 ? format(viewDates[viewDates.length - 1], "yyyy-MM-dd") : selectedDate;
    }
    try {
      const res = await fetch(
        `${baseUrl}/api/jobber/sync-calendar`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate, endDate }),
        }
      );
      const data = await res.json();
      // Always refresh calendar data — even when there's a warning the server
      // may have imported/updated records (e.g. first 500 of a large range).
      if (calendarView === "month") fetchCounts(calendarMonth);
      else fetchRange(getViewDates());
      fetchMapData(selectedDate);

      if (data.warning) {
        const parts = [];
        if (data.jobberCount > 0) parts.push(`${data.jobberCount} jobs`);
        if (data.synced > 0) parts.push(`${data.synced} updated`);
        if (data.imported > 0) parts.push(`${data.imported} imported`);
        const summary = parts.length > 0 ? `${parts.join(" · ")} · ` : "";
        setSyncMsg(`⚠ ${summary}${data.warning}`);
      } else {
        const parts = [`${data.jobberCount} Jobber jobs`];
        if (data.synced > 0) parts.push(`${data.synced} updated`);
        if (data.imported > 0) parts.push(`${data.imported} imported`);
        if (data.skipped > 0) parts.push(`${data.skipped} skipped`);
        setSyncMsg(`✓ ${parts.join(" · ")}`);
      }
    } catch {
      setSyncMsg("⚠ Sync failed — check your connection");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, calendarView, calendarMonth, selectedDate, fetchCounts, fetchRange, fetchMapData]);

  // Fetch calendar data when view or anchor changes
  useEffect(() => {
    if (calendarView === "month") fetchCounts(calendarMonth);
  }, [calendarView, calendarMonth, fetchCounts]);

  useEffect(() => {
    if (calendarView === "3day" || calendarView === "week") {
      fetchRange(getViewDates());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarView, selectedDate]);

  // ── Init Leaflet ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { center: [53.5461, -113.4938], zoom: 11 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Update staff markers ─────────────────────────────────────────────────────
  // Two independent layers:
  //   home-{id}  — permanent pin at home address; visible by default whenever
  //                homeLat/homeLng are saved, regardless of live-sharing status.
  //   live-{id}  — larger pin at current GPS position; only shown while a
  //                cleaner is actively sharing location (≤5 min ago).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seenHome = new Set<string>();
    const seenLive = new Set<string>();

    staffData.forEach((s) => {
      const color = cleanerColor(s.id);

      // ── Home pin (always on) ─────────────────────────────────────────────────
      if (s.homeLat != null && s.homeLng != null) {
        const homeKey = `home-${s.id}`;
        seenHome.add(homeKey);
        const homePopup = `
          <div style="font-family:sans-serif;min-width:150px;">
            <strong style="color:${color}">${s.name}</strong><br/>
            <span style="color:#888;font-size:12px;">${s.role.replace("_", " ")}</span><br/>
            <span style="font-size:12px;">🏠 Home address</span>
            ${s.homeAddress ? `<br/><span style="font-size:11px;color:#aaa;">📍 ${s.homeAddress}</span>` : ""}
          </div>`;
        const homeIcon = makeHomeIcon(s);
        const existingHome = markersRef.current.get(homeKey);
        if (existingHome) {
          existingHome.setLatLng([s.homeLat, s.homeLng]);
          existingHome.setIcon(homeIcon);
          existingHome.setPopupContent(homePopup);
        } else {
          const m = L.marker([s.homeLat, s.homeLng], { icon: homeIcon })
            .addTo(map).bindPopup(homePopup);
          markersRef.current.set(homeKey, m);
        }
      }

      // ── Live pin (only when actively sharing) ────────────────────────────────
      const isLive = s.liveLocation != null && secondsAgo(s.liveLocation.updatedAt) <= 300;
      if (isLive && s.liveLocation) {
        const liveKey = `live-${s.id}`;
        seenLive.add(liveKey);
        const liveIcon = makeCleanerIcon(s, false);
        const livePopup = `
          <div style="font-family:sans-serif;min-width:150px;">
            <strong style="color:${color}">${s.name}</strong><br/>
            <span style="color:#888;font-size:12px;">${s.role.replace("_", " ")}</span><br/>
            <span style="font-size:12px;">📡 Live · updated ${formatAgo(s.liveLocation.updatedAt)}</span>
            ${s.homeAddress ? `<br/><span style="font-size:11px;color:#aaa;">📍 ${s.homeAddress}</span>` : ""}
          </div>`;
        const existingLive = markersRef.current.get(liveKey);
        if (existingLive) {
          existingLive.setLatLng([s.liveLocation.lat, s.liveLocation.lng]);
          existingLive.setIcon(liveIcon);
          existingLive.setPopupContent(livePopup);
        } else {
          const m = L.marker([s.liveLocation.lat, s.liveLocation.lng], { icon: liveIcon })
            .addTo(map).bindPopup(livePopup);
          markersRef.current.set(liveKey, m);
        }
      }
    });

    // Remove markers for staff no longer in the dataset
    markersRef.current.forEach((m, key) => {
      if (key.startsWith("home-") && !seenHome.has(key)) { m.remove(); markersRef.current.delete(key); }
      if (key.startsWith("live-") && !seenLive.has(key)) { m.remove(); markersRef.current.delete(key); }
    });
  }, [staffData]);

  // ── Geocode bookings + compute proximity + render job markers ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove stale job markers when date changes
    markersRef.current.forEach((m, key) => {
      if (key.startsWith("job-")) { m.remove(); markersRef.current.delete(key); }
    });

    const staffMap = new Map(staffData.map(s => [s.id, s]));

    bookings.forEach(async (b, i) => {
      // Use stored coordinates if available, otherwise fall back to Nominatim geocoding
      let coords: [number, number] | null = null;
      if (b.addressLat != null && b.addressLng != null) {
        coords = [b.addressLat, b.addressLng];
      } else {
        await new Promise(r => setTimeout(r, i * 350));
        coords = await geocodeAddress(b.address, b.city);
      }
      if (!coords || !mapRef.current) return;

      // Compute proximity ranking — always uses home address coords so the
      // distance reflects how far each cleaner's home is from the job site,
      // regardless of whether they are currently sharing live GPS.
      const ranking = staffData
        .filter(s => s.homeLat != null && s.homeLng != null)
        .map(s => ({
          id: s.id,
          name: s.name,
          km: haversineKm(coords[0], coords[1], s.homeLat!, s.homeLng!),
        }))
        .sort((a, b) => a.km - b.km);

      const nearest = ranking[0];
      const assignee = b.staffId ? staffMap.get(b.staffId) : null;
      const borderColor = assignee ? cleanerColor(assignee.id) : nearest ? cleanerColor(nearest.id) : "#6B7280";

      // Enrich booking with ranking for popup
      const enriched: BookingEntry = { ...b, coords, ranking };

      const icon = makeJobIcon(borderColor, !!nearest && nearest.id === b.staffId);
      const popup = buildJobPopup(enriched, staffMap);

      const key = `job-${b.id}`;
      const existing = markersRef.current.get(key);
      if (existing) {
        existing.setLatLng(coords);
        existing.setIcon(icon);
        existing.setPopupContent(popup);
      } else {
        const m = L.marker(coords, { icon }).addTo(mapRef.current).bindPopup(popup);
        markersRef.current.set(key, m);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  // ── GPS tracking (cleaner self-share) ────────────────────────────────────────
  const postLocation = useCallback(async (lat: number, lng: number, accuracy?: number) => {
    if (!myStaffId) return;
    try {
      await fetch(`${baseUrl}/api/staff/${myStaffId}/location`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, accuracy }),
      });
      setLastPing(new Date());
      setGeoError(null);
    } catch { /* ignore */ }
  }, [myStaffId, baseUrl]);

  useEffect(() => {
    if (!myStaffId || !navigator.geolocation || !isTrackingHours()) {
      setSharing(false);
      return;
    }
    setSharing(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => postLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      err => { setGeoError(err.message); setSharing(false); },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 }
    );
    const interval = setInterval(() => {
      if (!isTrackingHours()) { setSharing(false); clearInterval(interval); return; }
      navigator.geolocation.getCurrentPosition(
        pos => postLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => {}
      );
    }, 30_000);
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      clearInterval(interval);
      setSharing(false);
    };
  }, [myStaffId, postLocation]);

  // ── Date navigation ──────────────────────────────────────────────────────────
  function changeDate(delta: number) {
    const d = addDays(parseISO(selectedDate), delta);
    setSelectedDate(format(d, "yyyy-MM-dd"));
  }

  function goToday() { setSelectedDate(format(new Date(), "yyyy-MM-dd")); }

  const displayDate = parseISO(selectedDate);
  const isSelectedToday = dateFnsIsToday(displayDate);

  // Build 5-week date strip (Mon–Sun, current week centred)
  const stripDates: Date[] = [];
  const startOfStrip = subDays(new Date(), 7);
  for (let i = 0; i < 35; i++) stripDates.push(addDays(startOfStrip, i));

  // ── Stats ────────────────────────────────────────────────────────────────────
  const onlineCount = staffData.filter(s => s.liveLocation && secondsAgo(s.liveLocation.updatedAt) < 300).length;
  const homeCount = staffData.filter(s => s.homeLat != null && s.homeLng != null).length;
  const myStaff = allStaff.find((s: any) => s.id === myStaffId);

  const VIEW_TABS: { id: CalendarView; label: string; icon: React.ReactNode }[] = [
    { id: "day",   label: "Day",   icon: <Calendar className="w-3.5 h-3.5" /> },
    { id: "3day",  label: "3-Day", icon: <CalendarDays className="w-3.5 h-3.5" /> },
    { id: "week",  label: "Week",  icon: <CalendarDays className="w-3.5 h-3.5" /> },
    { id: "month", label: "Month", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">Live Map</h1>
          <p className="text-muted-foreground">Cleaner positions · schedule · Jobber sync</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg border">
            {VIEW_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setCalendarView(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  calendarView === tab.id
                    ? "bg-white dark:bg-card shadow-sm text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sync from Jobber */}
          <Button
            variant="outline"
            size="sm"
            onClick={syncFromJobber}
            disabled={syncing}
            className="gap-1.5 text-xs h-8"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync Jobber"}
          </Button>

          {calendarView === "day" && (
            isToday ? (
              <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
                <Wifi className="w-3.5 h-3.5 text-green-500" />
                {onlineCount} live · {homeCount} home pins
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
                <Home className="w-3.5 h-3.5" />
                {homeCount} home pins
              </Badge>
            )
          )}
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {bookings.length} jobs
          </Badge>
        </div>
      </div>

      {/* Sync result message */}
      {syncMsg && (
        <div className={cn(
          "px-4 py-2 rounded-lg text-sm font-medium",
          syncMsg.startsWith("✓") ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"
        )}>
          {syncMsg}
        </div>
      )}

      {/* ── Calendar view ──────────────────────────────────────────────────────── */}

      {calendarView === "month" && (
        <MonthCalendar
          selectedDate={selectedDate}
          onDateSelect={(date) => {
            setSelectedDate(date);
            setCalendarView("day");
            // After React re-renders into Day view, scroll the map into view
            setTimeout(() => {
              mapCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 50);
          }}
          counts={dayCounts}
          currentMonth={calendarMonth}
          onMonthChange={(delta) => setCalendarMonth(m => addMonths(m, delta))}
        />
      )}

      {(calendarView === "3day" || calendarView === "week") && (
        <ColumnCalendar
          dates={getViewDates()}
          selectedDate={selectedDate}
          onDateSelect={setSelectedDate}
          bookingsByDate={bookingsByDate}
        />
      )}

      {/* ── Day view: date strip ───────────────────────────────────────────────── */}
      {calendarView === "day" && (
      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            <button onClick={() => changeDate(-1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 overflow-x-auto no-scrollbar">
              <div className="flex gap-1 min-w-max">
                {stripDates.map((d, i) => {
                  const key = format(d, "yyyy-MM-dd");
                  const isSelected = key === selectedDate;
                  const isTod = dateFnsIsToday(d);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(key)}
                      className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg text-xs font-medium min-w-[44px] transition-all ${
                        isSelected
                          ? "brand-gradient text-white shadow-md shadow-primary/20"
                          : isTod
                          ? "bg-primary/10 text-primary border border-primary/30"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="text-[10px] uppercase">{format(d, "EEE")}</span>
                      <span className="text-sm font-bold">{format(d, "d")}</span>
                      {isTod && !isSelected && <span className="w-1 h-1 rounded-full bg-primary mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={() => changeDate(1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
            {!isSelectedToday && (
              <Button variant="outline" size="sm" onClick={goToday} className="shrink-0 text-xs h-8">
                Today
              </Button>
            )}
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="sr-only"
              aria-label="Jump to date"
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground px-1">
            <span className="font-semibold text-foreground">{format(displayDate, "EEEE, MMMM d, yyyy")}</span>
            {isSelectedToday
              ? <span className="text-green-600 font-medium">· Live GPS tracking active</span>
              : <span>· Cleaners shown at home address</span>}
          </div>
        </CardContent>
      </Card>
      )}

      {/* Future date info banner */}
      {calendarView === "day" && !isSelectedToday && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm">
          <Home className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold text-blue-700 dark:text-blue-400">Future date — showing home addresses</span>
            <span className="text-blue-600/80 dark:text-blue-400/70 ml-2">
              Cleaners without a home address saved won't appear on the map.
              <a href="/staff" className="underline ml-1 font-medium">Add addresses on the Staff page →</a>
            </span>
          </div>
        </div>
      )}

      {/* Cleaner self-identification (only meaningful for today) */}
      {isSelectedToday && (
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
                <p className="text-sm text-muted-foreground">Tap your name to start sharing GPS (8 AM – 8 PM).</p>
                <div className="flex flex-wrap gap-2">
                  {allStaff.map((s: any) => (
                    <button key={s.id} onClick={() => { setMyStaffId(s.id); localStorage.setItem("cleaner_map_staff_id", String(s.id)); }}
                      className="px-4 py-2 rounded-full text-sm font-medium border hover:border-primary/60 hover:bg-primary/5 transition-all"
                      style={{ borderColor: cleanerColor(s.id) + "44" }}>
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: cleanerColor(s.id) }} />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ background: cleanerColor(myStaffId) }}>
                    {initials(myStaff?.name ?? "?")}
                  </div>
                  <div>
                    <p className="font-medium">{myStaff?.name}</p>
                    <div className="flex items-center gap-1.5 text-sm">
                      {sharing && isTrackingHours() ? (
                        <>
                          <Wifi className="w-3.5 h-3.5 text-green-500" />
                          <span className="text-green-600 font-medium">Sharing live</span>
                          {lastPing && <span className="text-muted-foreground">· {lastPing.toLocaleTimeString()}</span>}
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            {!isTrackingHours() ? "Outside tracking hours (8 AM–8 PM)" : geoError ?? "Location unavailable"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
                  setMyStaffId(null); setSharing(false);
                  localStorage.removeItem("cleaner_map_staff_id");
                }}>Not me</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Map */}
      <Card ref={mapCardRef} className="overflow-hidden shadow-md">
        <div ref={mapElRef} style={{ height: 520 }} className="w-full" />
      </Card>

      {/* Cleaner roster — all staff, always visible */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            All Cleaners
            <span className="text-muted-foreground font-normal text-xs ml-1">
              — click to find on map
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {allStaff.map((s: any) => {
              const entry = staffData.find(d => d.id === s.id);
              const hasLive = entry?.position?.source === "live";
              const hasHome = entry?.position?.source === "home" || (entry?.homeLat != null);
              const noLocation = !hasLive && !hasHome;

              return (
                <button
                  key={s.id}
                  onClick={() => {
                    // Prefer live marker; fall back to home pin
                    const marker = markersRef.current.get(`live-${s.id}`)
                      ?? markersRef.current.get(`home-${s.id}`);
                    if (marker && mapRef.current) {
                      mapRef.current.setView(marker.getLatLng(), 14, { animate: true });
                      marker.openPopup();
                    }
                  }}
                  disabled={noLocation}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                    noLocation
                      ? "opacity-50 cursor-default border-dashed border-muted-foreground/30 bg-muted/20"
                      : "hover:border-primary/50 hover:bg-primary/5 cursor-pointer border-border"
                  )}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                    style={{ background: noLocation ? "#9CA3AF" : cleanerColor(s.id) }}
                  >
                    {initials(s.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs flex items-center gap-1">
                      {hasLive ? (
                        <><Wifi className="w-3 h-3 text-green-500" /><span className="text-green-600">Live</span></>
                      ) : hasHome ? (
                        <><Home className="w-3 h-3 text-blue-400" /><span className="text-blue-500">Home</span></>
                      ) : (
                        <><MapPin className="w-3 h-3 text-muted-foreground" /><span className="text-muted-foreground">No location</span></>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          {allStaff.some((s: any) => {
            const entry = staffData.find(d => d.id === s.id);
            return !entry?.position;
          }) && (
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Greyed-out cleaners have no location saved.{" "}
              <a href="/staff" className="underline font-medium hover:text-primary transition-colors">
                Add home addresses on the Staff page →
              </a>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-white font-bold text-[9px]">AB</div>
          Live GPS (solid)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full border-2 border-dashed border-primary bg-white flex items-center justify-center text-primary text-[9px] font-bold">AB</div>
          Home address (dashed)
        </div>
        <div className="flex items-center gap-1.5">🏠 Job · border = assigned cleaner · 🟢 popup = closest · 🔴 = farthest</div>
        <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Refreshes every 30s</div>
      </div>
    </div>
  );
}
