import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useListStaff } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Navigation, Users, Home, Clock, Wifi, WifiOff, ChevronLeft, ChevronRight, Calendar, RefreshCw, CalendarDays, LayoutGrid, Plus, Trash2, Crosshair, X } from "lucide-react";
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
  /** Where the cleaner is right now (fresh live GPS else home) — independent
   *  of the selected calendar date. Used for homeowner-pin distances. */
  currentPosition: Position | null;
}

interface HomeownerPin {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  createdAt: string;
}

interface BookingEntry {
  id: number;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  scheduledDate: string;
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
function esc(s: string) {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

import { loadGoogleMaps, htmlToEl } from "@/lib/google-maps";

// ── Marker HTML (used as AdvancedMarkerElement content) ─────────────────────

function makeCleanerIcon(s: StaffEntry, isStale: boolean) {
  const color = cleanerColor(s.id);
  const ini = esc(initials(s.name));
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
  return html;
}

/** Small house pin — always-on home address marker for each staff member. */
function makeHomeIcon(s: StaffEntry) {
  const color = cleanerColor(s.id);
  const ini = esc(initials(s.name));
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
  return html;
}

/** Homeowner pin — dispatcher-saved location, distinct purple rounded pin. */
const PIN_COLOR = "#7C3AED";
function makeHomeownerPinIcon() {
  const html = `
    <div style="width:36px;height:44px;display:flex;flex-direction:column;align-items:center;">
      <div style="width:32px;height:32px;border-radius:50% 50% 50% 4px;
        background:${PIN_COLOR};border:2.5px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;font-size:15px;">
        🏡
      </div>
      <div style="width:0;height:0;
        border-left:5px solid transparent;border-right:5px solid transparent;
        border-top:7px solid ${PIN_COLOR};margin-top:-1px;"></div>
    </div>`;
  return html;
}

// One-time CSS for the "jumped to this day" pulse highlight on job pins
if (typeof document !== "undefined" && !document.getElementById("job-pin-pulse-style")) {
  const style = document.createElement("style");
  style.id = "job-pin-pulse-style";
  style.textContent = `
@keyframes jobPinPulse {
  0%   { transform: scale(1);    filter: drop-shadow(0 0 0 rgba(238,63,206,0.0)); }
  50%  { transform: scale(1.28); filter: drop-shadow(0 0 10px rgba(238,63,206,0.65)); }
  100% { transform: scale(1);    filter: drop-shadow(0 0 0 rgba(238,63,206,0.0)); }
}
.job-pin-highlight { animation: jobPinPulse 0.9s ease-in-out 4; transform-origin: 50% 100%; }`;
  document.head.appendChild(style);
}

function makeJobIcon(borderColor: string, isNearest: boolean, highlight = false) {
  const bg = isNearest ? borderColor : "white";
  const emoji = isNearest ? "🏠" : "🏠";
  const html = `
    <div class="${highlight ? "job-pin-highlight" : ""}" style="width:34px;height:40px;display:flex;flex-direction:column;align-items:center;">
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
  return html;
}

// ── Geocode (server, on-demand) ──────────────────────────────────────────────
// Bookings missing stored coordinates ask the API server, which geocodes via
// Google and persists the result to the booking — so the pin is instant on
// every later visit. (Replaces the old throttled client-side Nominatim path.)

const geocodeCache = new Map<number, [number, number] | null>();
// In-flight dedupe: month views + 30s repolls can ask for the same booking at
// once; requests join the existing promise instead of re-fetching.
const geocodeInflight = new Map<number, Promise<[number, number] | null>>();

function geocodeBooking(baseUrl: string, bookingId: number): Promise<[number, number] | null> {
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

function buildJobPopup(b: BookingEntry, staffMap: Map<number, StaffEntry>, showDate = false) {
  const assignee = b.staffId ? staffMap.get(b.staffId) : null;
  const ranking = b.ranking ?? [];
  let dateLabel = "";
  if (showDate && b.scheduledDate) {
    try { dateLabel = format(parseISO(b.scheduledDate), "EEE, MMM d"); } catch { dateLabel = b.scheduledDate; }
  }

  const rankingRows = ranking.map((r, i) => {
    const color = cleanerColor(r.id);
    const medal = i === 0 ? "🟢" : i === ranking.length - 1 ? "🔴" : "⚪";
    const label = i === 0 ? " (closest)" : i === ranking.length - 1 ? " (farthest)" : "";
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;">
      <span>${medal}</span>
      <span style="color:${color};font-weight:600;">${esc(r.name)}</span>
      <span style="color:#888;margin-left:auto;">${r.km.toFixed(1)} km${label}</span>
    </div>`;
  }).join("");

  return `
    <div style="font-family:sans-serif;min-width:200px;max-width:260px;">
      <strong style="font-size:13px;">${esc(b.firstName)} ${esc(b.lastName)}</strong><br/>
      ${dateLabel ? `<span style="font-size:12px;color:#555;">📅 ${esc(dateLabel)}</span><br/>` : ""}
      ${b.scheduledTime ? `<span style="font-size:12px;color:#555;">⏰ ${esc(b.scheduledTime)}</span><br/>` : ""}
      <span style="font-size:11px;color:#888;">📍 ${esc(b.address)}, ${esc(b.city)}</span><br/>
      ${assignee
        ? `<span style="font-size:12px;color:${cleanerColor(assignee.id)};font-weight:600;">👤 Assigned: ${esc(assignee.name)}</span>`
        : `<span style="font-size:12px;color:#888;">👤 Unassigned</span>`}
      ${ranking.length > 0 ? `
        <div style="margin-top:8px;border-top:1px solid #eee;padding-top:6px;">
          <div style="font-size:11px;color:#888;font-weight:600;margin-bottom:4px;">CLEANERS BY DISTANCE</div>
          ${rankingRows}
        </div>` : ""}
    </div>`;
}

// ── Homeowner pin popup: cleaners ranked by distance ─────────────────────────

function rankCleanersFrom(lat: number, lng: number, staffData: StaffEntry[]) {
  // Use currentPosition (live-now else home, independent of the calendar
  // date being viewed); fall back to position for safety.
  return staffData
    .map(s => ({ s, pos: s.currentPosition ?? s.position }))
    .filter(({ pos }) => pos != null)
    .map(({ s, pos }) => ({
      id: s.id,
      name: s.name,
      source: pos!.source,
      km: haversineKm(lat, lng, pos!.lat, pos!.lng),
    }))
    .sort((a, b) => a.km - b.km);
}

function buildPinPopup(pin: HomeownerPin, staffData: StaffEntry[]) {
  const ranking = rankCleanersFrom(pin.lat, pin.lng, staffData);
  const rows = ranking.map((r, i) => {
    const color = cleanerColor(r.id);
    const medal = i === 0 ? "🟢" : i === ranking.length - 1 && ranking.length > 1 ? "🔴" : "⚪";
    const label = i === 0 ? " (closest)" : "";
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;">
      <span>${medal}</span>
      <span style="color:${color};font-weight:600;">${esc(r.name)}</span>
      <span style="font-size:10px;">${r.source === "live" ? "📡" : "🏠"}</span>
      <span style="color:#888;margin-left:auto;">${r.km.toFixed(1)} km${label}</span>
    </div>`;
  }).join("");

  return `
    <div style="font-family:sans-serif;min-width:200px;max-width:260px;">
      <strong style="font-size:13px;color:${PIN_COLOR};">🏡 ${esc(pin.name)}</strong><br/>
      ${pin.address ? `<span style="font-size:11px;color:#888;">📍 ${esc(pin.address)}</span><br/>` : ""}
      ${ranking.length > 0 ? `
        <div style="margin-top:8px;border-top:1px solid #eee;padding-top:6px;">
          <div style="font-size:11px;color:#888;font-weight:600;margin-bottom:4px;">CLEANERS BY DISTANCE</div>
          ${rows}
          <div style="font-size:10px;color:#aaa;margin-top:4px;">📡 live position · 🏠 home address · straight-line</div>
        </div>` : `<div style="font-size:11px;color:#aaa;margin-top:6px;">No cleaner locations available yet</div>`}
    </div>`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MapPage() {
  const mapRef = useRef<any>(null);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapCardRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const infoWindowRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

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
  const [jumpHighlight, setJumpHighlight] = useState<string | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const { data: allStaff = [] } = useListStaff({ activeOnly: true });
  const baseUrl = getBaseUrl();
  const { toast } = useToast();

  // ── Homeowner pins state ────────────────────────────────────────────────────
  const [pins, setPins] = useState<HomeownerPin[]>([]);
  const [pinName, setPinName] = useState("");
  const [pinAddress, setPinAddress] = useState("");
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropMode, setDropMode] = useState(false);
  const dropModeRef = useRef(false);
  dropModeRef.current = dropMode;
  const [savingPin, setSavingPin] = useState(false);
  // Whole team can VIEW the map; only dispatchers can manage homeowner pins.
  const [isDispatcher, setIsDispatcher] = useState(false);

  // ── Fetch map data ──────────────────────────────────────────────────────────
  // Last-issued-wins guard: a slow response from an earlier date/range (or an
  // older poll) must never overwrite data from a newer request.
  const mapDataSeqRef = useRef(0);
  const fetchMapData = useCallback(async (date: string, endDate?: string) => {
    const seq = ++mapDataSeqRef.current;
    const range = endDate && endDate !== date ? `&endDate=${endDate}` : "";
    try {
      const res = await fetch(`${baseUrl}/api/map/data?date=${date}${range}`, { credentials: "include" });
      if (!res.ok || seq !== mapDataSeqRef.current) return;
      const data = await res.json();
      if (seq !== mapDataSeqRef.current) return;
      setIsDispatcher(data.callerRole === "dispatcher");
      setStaffData(data.staff);
      setIsToday(data.isToday);
      setBookings(
        data.bookings.map((b: any) => ({
          id: b.id,
          firstName: b.firstName,
          lastName: b.lastName,
          address: b.address,
          city: b.city,
          scheduledDate: b.scheduledDate,
          scheduledTime: b.scheduledTime,
          staffId: b.staffId,
          addressLat: b.addressLat ?? null,
          addressLng: b.addressLng ?? null,
        }))
      );
    } catch { /* ignore */ }
  }, [baseUrl]);

  // The map's job pins follow the calendar view: Day shows one day, while
  // 3-Day / Week / Month show every job in the visible range at once.
  const mapRange = useMemo(() => {
    if (calendarView === "3day") {
      const anchor = parseISO(selectedDate);
      return {
        start: format(addDays(anchor, -1), "yyyy-MM-dd"),
        end: format(addDays(anchor, 1), "yyyy-MM-dd"),
      };
    }
    if (calendarView === "week") {
      const anchor = parseISO(selectedDate);
      const monday = subDays(anchor, (anchor.getDay() + 6) % 7);
      return {
        start: format(monday, "yyyy-MM-dd"),
        end: format(addDays(monday, 6), "yyyy-MM-dd"),
      };
    }
    if (calendarView === "month") {
      return {
        start: format(startOfMonth(calendarMonth), "yyyy-MM-dd"),
        end: format(endOfMonth(calendarMonth), "yyyy-MM-dd"),
      };
    }
    return { start: selectedDate, end: selectedDate };
  }, [calendarView, selectedDate, calendarMonth]);
  const isRangeView = mapRange.start !== mapRange.end;

  useEffect(() => {
    fetchMapData(mapRange.start, mapRange.end);
    const interval = setInterval(() => fetchMapData(mapRange.start, mapRange.end), 30_000);
    return () => clearInterval(interval);
  }, [fetchMapData, mapRange.start, mapRange.end]);

  // ── Homeowner pins: fetch / save / delete ───────────────────────────────────
  // Sequence guard: a slow in-flight list fetch must never overwrite state
  // changed by a later add/delete (stale response would resurrect/lose pins).
  const pinsSeqRef = useRef(0);
  const fetchPins = useCallback(async () => {
    const seq = pinsSeqRef.current;
    try {
      const res = await fetch(`${baseUrl}/api/map/pins`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (pinsSeqRef.current === seq) setPins(data);
      }
    } catch { /* ignore */ }
  }, [baseUrl]);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  // Saves the pin. When called from address selection, `override` carries the
  // just-picked location so the pin drops immediately — no extra click needed.
  // Name is optional: falls back to the address, then "Dropped pin".
  // saveSeqRef: if the dispatcher picks another address while a save is in
  // flight, the older save must not clear the newer selection's form state.
  const saveSeqRef = useRef(0);
  const savePin = useCallback(async (override?: { address?: string; lat: number; lng: number }) => {
    const mySeq = ++saveSeqRef.current;
    const coords = override ?? pinCoords;
    if (!coords) return;
    const address = (override?.address ?? pinAddress).trim();
    const name =
      pinName.trim() ||
      address.split(",").slice(0, 2).join(",").trim() ||
      "Dropped pin";
    setSavingPin(true);
    try {
      const res = await fetch(`${baseUrl}/api/map/pins`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address: address || undefined,
          lat: coords.lat,
          lng: coords.lng,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `Server error ${res.status}`);
      }
      const pin = await res.json();
      pinsSeqRef.current++; // invalidate any in-flight list fetch
      setPins(prev => [...prev, pin]);
      // Only clear the form / move the map if no newer selection superseded
      // this save while it was in flight.
      if (saveSeqRef.current === mySeq) {
        setPinName("");
        setPinAddress("");
        setPinCoords(null);
        if (mapRef.current) {
          mapRef.current.panTo({ lat: pin.lat, lng: pin.lng });
          if (mapRef.current.getZoom() < 12) mapRef.current.setZoom(12);
        }
      }
      toast({ title: "Pin added", description: `${pin.name} is now on the map.` });
    } catch (err: any) {
      toast({ title: "Couldn't add pin", description: err?.message ?? "Please try again.", variant: "destructive" });
    } finally {
      if (saveSeqRef.current === mySeq) setSavingPin(false);
    }
  }, [baseUrl, pinCoords, pinName, pinAddress, toast]);

  const deletePin = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${baseUrl}/api/map/pins/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) throw new Error(`Server error ${res.status}`);
      pinsSeqRef.current++; // invalidate any in-flight list fetch
      setPins(prev => prev.filter(p => p.id !== id));
    } catch {
      toast({ title: "Couldn't remove pin", description: "Please try again.", variant: "destructive" });
    }
  }, [baseUrl, toast]);

  // Reverse-geocode a dropped pin so the address field isn't empty (best effort)
  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18`,
        { headers: { "Accept-Language": "en" } },
      );
      const data = await res.json();
      if (data?.display_name) {
        // Keep it short: first three components are usually house/street/area
        return String(data.display_name).split(",").slice(0, 3).join(",").trim();
      }
    } catch { /* ignore */ }
    return null;
  }, []);

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

  // Jump to Day view for a date, highlight its pins, and scroll the map into view
  const jumpToDay = useCallback((date: string) => {
    setSelectedDate(date);
    setCalendarView("day");
    setJumpHighlight(date);
    // After React re-renders into Day view, scroll the map into view
    setTimeout(() => {
      mapCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, []);

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

  // ── Init Google Map ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (window as any).gm_authFailure = () => {
      setMapError("Google rejected the Maps API key — 'Maps JavaScript API' needs to be enabled for this key in Google Cloud.");
    };
    (async () => {
      if (!mapElRef.current || mapRef.current) return;
      try {
        const res = await fetch(`${baseUrl}/api/map/maps-key`, { credentials: "include" });
        if (!res.ok) throw new Error("Could not load the map key");
        const { apiKey } = await res.json();
        await loadGoogleMaps(apiKey);
        if (cancelled || !mapElRef.current || mapRef.current) return;
        const g = (window as any).google.maps;
        const map = new g.Map(mapElRef.current, {
          center: { lat: 53.5461, lng: -113.4938 },
          zoom: 11,
          mapId: "DEMO_MAP_ID",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        infoWindowRef.current = new g.InfoWindow();
        mapRef.current = map;
        setMapReady(true);
      } catch (e: any) {
        if (!cancelled) setMapError(e?.message ?? "Failed to load Google Maps");
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach(m => { m.map = null; });
      markersRef.current.clear();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drop-pin mode: map click sets the new pin's location ────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const listener = mapRef.current.addListener("click", async (e: any) => {
      if (!dropModeRef.current || !e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setPinCoords({ lat, lng });
      setDropMode(false);
      toast({ title: "Location set", description: "Tap Add Pin to save it — a name is optional." });
      const addr = await reverseGeocode(lat, lng);
      if (addr) setPinAddress(prev => (prev.trim() ? prev : addr));
    });
    return () => listener.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Crosshair cursor while drop-pin mode is armed
  useEffect(() => {
    mapRef.current?.setOptions({ draggableCursor: dropMode ? "crosshair" : null });
  }, [dropMode]);

  // Create or update an AdvancedMarkerElement with HTML content + popup
  const upsertMarker = useCallback((key: string, lat: number, lng: number, html: string, popupHtml: string) => {
    const map = mapRef.current;
    if (!map) return null;
    const existing = markersRef.current.get(key);
    if (existing) {
      existing.position = { lat, lng };
      existing.content = htmlToEl(html);
      existing.__popup = popupHtml;
      return existing;
    }
    const g = (window as any).google.maps;
    const m = new g.marker.AdvancedMarkerElement({
      map,
      position: { lat, lng },
      content: htmlToEl(html),
    });
    m.__popup = popupHtml;
    m.addListener("click", () => {
      infoWindowRef.current?.setContent(m.__popup);
      infoWindowRef.current?.open({ map: mapRef.current, anchor: m });
    });
    markersRef.current.set(key, m);
    return m;
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
            <strong style="color:${color}">${esc(s.name)}</strong><br/>
            <span style="color:#888;font-size:12px;">${esc(s.role.replace("_", " "))}</span><br/>
            <span style="font-size:12px;">🏠 Home address</span>
            ${s.homeAddress ? `<br/><span style="font-size:11px;color:#aaa;">📍 ${esc(s.homeAddress)}</span>` : ""}
          </div>`;
        upsertMarker(homeKey, s.homeLat, s.homeLng, makeHomeIcon(s), homePopup);
      }

      // ── Live pin (only when actively sharing) ────────────────────────────────
      const isLive = s.liveLocation != null && secondsAgo(s.liveLocation.updatedAt) <= 300;
      if (isLive && s.liveLocation) {
        const liveKey = `live-${s.id}`;
        seenLive.add(liveKey);
        const liveIcon = makeCleanerIcon(s, false);
        const livePopup = `
          <div style="font-family:sans-serif;min-width:150px;">
            <strong style="color:${color}">${esc(s.name)}</strong><br/>
            <span style="color:#888;font-size:12px;">${esc(s.role.replace("_", " "))}</span><br/>
            <span style="font-size:12px;">📡 Live · updated ${formatAgo(s.liveLocation.updatedAt)}</span>
            ${s.homeAddress ? `<br/><span style="font-size:11px;color:#aaa;">📍 ${esc(s.homeAddress)}</span>` : ""}
          </div>`;
        upsertMarker(liveKey, s.liveLocation.lat, s.liveLocation.lng, liveIcon, livePopup);
      }
    });

    // Remove markers for staff no longer in the dataset
    markersRef.current.forEach((m, key) => {
      if (key.startsWith("home-") && !seenHome.has(key)) { m.map = null; markersRef.current.delete(key); }
      if (key.startsWith("live-") && !seenLive.has(key)) { m.map = null; markersRef.current.delete(key); }
    });
  }, [staffData, mapReady, upsertMarker]);

  // ── Homeowner pin markers (distances refresh with staff positions) ──────────
  useEffect(() => {
    if (!mapRef.current) return;
    const seen = new Set<string>();
    pins.forEach((pin) => {
      const key = `pin-${pin.id}`;
      seen.add(key);
      upsertMarker(key, pin.lat, pin.lng, makeHomeownerPinIcon(), buildPinPopup(pin, staffData));
    });
    markersRef.current.forEach((m, key) => {
      if (key.startsWith("pin-") && !seen.has(key)) { m.map = null; markersRef.current.delete(key); }
    });
  }, [pins, staffData, mapReady, upsertMarker]);

  // ── Geocode bookings + compute proximity + render job markers ───────────────
  const jobRenderGenRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Generation token: invalidates async marker work from earlier renders so a
    // slow geocode can't resurrect pins for a previously selected date.
    const gen = ++jobRenderGenRef.current;

    // Remove stale job markers when date changes
    markersRef.current.forEach((m, key) => {
      if (key.startsWith("job-")) { m.map = null; markersRef.current.delete(key); }
    });

    const staffMap = new Map(staffData.map(s => [s.id, s]));
    const highlight = jumpHighlight === selectedDate;
    const coordsForFit: [number, number][] = [];

    bookings.forEach(async (b) => {
      // Use stored coordinates if available, otherwise ask the server to
      // geocode on demand (it persists the result, so the pin is instant on
      // every later visit). In-flight dedupe prevents duplicate requests
      // across month views and 30s repolls.
      let coords: [number, number] | null = null;
      if (b.addressLat != null && b.addressLng != null) {
        coords = [b.addressLat, b.addressLng];
      } else {
        coords = await geocodeBooking(baseUrl, b.id);
      }
      if (gen !== jobRenderGenRef.current || !coords || !mapRef.current) return;

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

      const icon = makeJobIcon(borderColor, !!nearest && nearest.id === b.staffId, highlight);
      // In range views, each popup shows which day the job is on
      const popup = buildJobPopup(enriched, staffMap, isRangeView);

      const key = `job-${b.id}`;
      upsertMarker(key, coords[0], coords[1], icon, popup);

      // Auto-fit the map to include all of the day's job pins after a
      // Month → Day jump. Markers appear asynchronously (some geocode),
      // so debounce the fit until pins stop arriving.
      if (highlight) {
        coordsForFit.push(coords);
        if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
        fitTimerRef.current = setTimeout(() => {
          if (gen !== jobRenderGenRef.current) return;
          if (coordsForFit.length > 0 && mapRef.current) {
            const g = (window as any).google.maps;
            const bounds = new g.LatLngBounds();
            coordsForFit.forEach(([la, ln]) => bounds.extend({ lat: la, lng: ln }));
            mapRef.current.fitBounds(bounds, 60);
            g.event.addListenerOnce(mapRef.current, "idle", () => {
              if (mapRef.current && mapRef.current.getZoom() > 14) mapRef.current.setZoom(14);
            });
          }
        }, 400);
      }
    });

    return () => {
      // Invalidate in-flight async marker work and pending fit
      jobRenderGenRef.current++;
      if (fitTimerRef.current) { clearTimeout(fitTimerRef.current); fitTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, jumpHighlight, selectedDate, mapReady, isRangeView]);

  // Clear the jump highlight after the pulse animation finishes
  useEffect(() => {
    if (!jumpHighlight) return;
    const t = setTimeout(() => setJumpHighlight(null), 5000);
    return () => clearTimeout(t);
  }, [jumpHighlight]);

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

          {/* Sync from Jobber — dispatcher-only action */}
          {isDispatcher && (
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
          )}

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

      {/* Quick address search — pinned to the top of the page so dispatchers
          can drop a homeowner pin without scrolling below the map. */}
      {isDispatcher && (
        <Card className="shadow-sm">
          <CardContent className="px-4 py-3 space-y-2">
            <div className="grid sm:grid-cols-[1fr_1.4fr_auto_auto] gap-2 items-start">
              <Input
                placeholder="Name (optional), e.g. Mrs. Beckett"
                value={pinName}
                onChange={(e) => setPinName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && pinCoords) savePin(); }}
              />
              <div className="space-y-1">
                <AddressAutocomplete
                  value={pinAddress}
                  onChange={(v) => { setPinAddress(v); setPinCoords(null); }}
                  onPlaceSelect={(place) => {
                    const label = place.address && place.city
                      ? `${place.address}, ${place.city}`
                      : place.formattedAddress;
                    setPinAddress(label);
                    setPinCoords({ lat: place.lat, lng: place.lng });
                    // Pin drops immediately on address selection — form state
                    // above is kept so a failed save leaves the address in place.
                    savePin({ address: label, lat: place.lat, lng: place.lng });
                  }}
                  placeholder="Search an address — pin drops when you pick one"
                  className={cn(pinCoords ? "border-green-400 bg-green-50 dark:bg-green-950/20" : "")}
                />
                {pinCoords && (
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Location set ({pinCoords.lat.toFixed(4)}, {pinCoords.lng.toFixed(4)})
                  </p>
                )}
              </div>
              <Button
                variant={dropMode ? "default" : "outline"}
                onClick={() => setDropMode(!dropMode)}
                className="gap-1.5"
                title="Then click anywhere on the map to set the location"
              >
                {dropMode ? <X className="w-4 h-4" /> : <Crosshair className="w-4 h-4" />}
                {dropMode ? "Cancel" : "Drop on map"}
              </Button>
              <Button
                onClick={() => savePin()}
                disabled={!pinCoords}
                isLoading={savingPin}
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Pin
              </Button>
            </div>
            {dropMode && (
              <div className="px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 text-sm text-violet-700 dark:text-violet-300">
                Click anywhere on the map to place the pin.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Calendar view ──────────────────────────────────────────────────────── */}

      {calendarView === "month" && (
        <MonthCalendar
          selectedDate={selectedDate}
          onDateSelect={jumpToDay}
          counts={dayCounts}
          currentMonth={calendarMonth}
          onMonthChange={(delta) => setCalendarMonth(m => addMonths(m, delta))}
        />
      )}

      {(calendarView === "3day" || calendarView === "week") && (
        <ColumnCalendar
          dates={getViewDates()}
          selectedDate={selectedDate}
          onDateSelect={jumpToDay}
          bookingsByDate={bookingsByDate}
        />
      )}

      {/* Range-view hint: the map below shows every job in the visible range */}
      {isRangeView && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>
            Map shows all <span className="font-semibold text-foreground">{bookings.length}</span> jobs
            from <span className="font-semibold text-foreground">{format(parseISO(mapRange.start), "MMM d")}</span> to{" "}
            <span className="font-semibold text-foreground">{format(parseISO(mapRange.end), "MMM d")}</span> — tap a pin
            to see its date and cleaner distances.
          </span>
        </div>
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
        {mapError && (
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-700 font-medium">
            ⚠ {mapError}
          </div>
        )}
        <div ref={mapElRef} style={{ height: 520 }} className="w-full" />
      </Card>

      {/* Homeowner pins — saved locations + distances to cleaners */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4" style={{ color: "#7C3AED" }} />
            Homeowner Pins
            {pins.length > 0 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">{pins.length}</Badge>
            )}
            <span className="text-muted-foreground font-normal text-xs ml-1">
              — tap a pin on the map to see cleaner distances
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {pins.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No pins yet{isDispatcher ? " — use the address search at the top of the page to add one." : "."}
            </p>
          )}

          {/* Saved pins */}
          {pins.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {pins.map((pin) => {
                const ranking = rankCleanersFrom(pin.lat, pin.lng, staffData);
                const nearest = ranking[0];
                return (
                  <div
                    key={pin.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer"
                    onClick={() => {
                      const marker = markersRef.current.get(`pin-${pin.id}`);
                      if (marker && mapRef.current) {
                        mapRef.current.panTo(marker.position);
                        if (mapRef.current.getZoom() < 13) mapRef.current.setZoom(13);
                        infoWindowRef.current?.setContent(marker.__popup);
                        infoWindowRef.current?.open({ map: mapRef.current, anchor: marker });
                        mapCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }
                    }}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: "#7C3AED22" }}>
                      🏡
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{pin.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {nearest
                          ? <>Closest: <span className="font-medium">{nearest.name}</span> · {nearest.km.toFixed(1)} km</>
                          : pin.address ?? "No cleaner locations yet"}
                      </p>
                    </div>
                    {isDispatcher && (
                      <button
                        className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                        title="Remove pin"
                        onClick={(e) => { e.stopPropagation(); deletePin(pin.id); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
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
                      mapRef.current.panTo(marker.position);
                      mapRef.current.setZoom(14);
                      infoWindowRef.current?.setContent(marker.__popup);
                      infoWindowRef.current?.open({ map: mapRef.current, anchor: marker });
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
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]" style={{ background: "#7C3AED", border: "1.5px solid white", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>🏡</div>
          Homeowner pin · tap for cleaner distances
        </div>
        <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Refreshes every 30s</div>
      </div>
    </div>
  );
}
