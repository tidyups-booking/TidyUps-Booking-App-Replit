import React, { useMemo, useState } from "react";
import { useGetDaySchedule, useListBookings, useCountBookings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, CalendarDays, User, Clock, MapPin, Search, X } from "lucide-react";
import { Link } from "wouter";
import { BookingMiniMap } from "@/components/booking-mini-map";
import { geocodeBooking } from "@/lib/geocode-booking";

// API base (artifact prefix, no trailing slash) — same base the mini map
// uses on the New Booking form.
const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

function hasCoords(b: { addressLat?: number | null; addressLng?: number | null }) {
  return b.addressLat != null && b.addressLng != null;
}

function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function offsetDate(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day + days);
  return d.toISOString().split("T")[0];
}

const SERVICE_LABELS: Record<string, string> = {
  standard_clean: "Standard",
  deep_clean: "Deep Clean",
  move_in_out: "Move In/Out",
  move_in: "Move-In Clean",
  move_out: "Move-Out Clean",
  post_construction: "Post-Construction",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  confirmed: "bg-blue-100 text-blue-800 border-blue-200",
  in_progress: "bg-purple-100 text-purple-800 border-purple-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

const ROLE_LABELS: Record<string, string> = {
  cleaner: "Cleaner",
  lead_cleaner: "Lead",
  supervisor: "Supervisor",
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
export default function Schedule() {
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: schedules, isLoading } = useGetDaySchedule({ date: selectedDate });

  // Address search across ALL bookings (any date), matched server-side so
  // results stay complete no matter how large the booking history grows.
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 250);
  const searching = query.length >= 2;
  // Cast: the generated option type demands a queryKey, but we must NOT
  // override it (the generated hook derives a properly scoped key itself).
  const { data: matches, isLoading: searchLoading } = useListBookings(
    { q: query, limit: 200 },
    { query: { enabled: searching } as Parameters<typeof useListBookings>[1] extends { query?: infer Q } ? Q : never }
  );
  // Total match count so dispatchers know when results are capped/truncated.
  const { data: countData } = useCountBookings(
    { q: query },
    { query: { enabled: searching } as Parameters<typeof useCountBookings>[1] extends { query?: infer Q } ? Q : never }
  );
  const totalMatches = countData?.total;
  const results = useMemo(() => {
    if (!searching || !matches) return [];
    // Upcoming jobs first (soonest on top), then past jobs (most recent first).
    const upcoming = matches
      .filter((b) => b.scheduledDate >= today)
      .sort(
        (a, b) =>
          a.scheduledDate.localeCompare(b.scheduledDate) ||
          a.scheduledTime.localeCompare(b.scheduledTime)
      );
    const past = matches
      .filter((b) => b.scheduledDate < today)
      .sort(
        (a, b) =>
          b.scheduledDate.localeCompare(a.scheduledDate) ||
          b.scheduledTime.localeCompare(a.scheduledTime)
      );
    return [...upcoming, ...past].slice(0, 25);
  }, [searching, matches, today]);

  // Which result is shown on the mini map. Defaults to the first result
  // that has a saved location; clicking a result row switches the map.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  React.useEffect(() => setSelectedId(null), [query]);
  const selected = useMemo(() => {
    return results.find((b) => b.id === selectedId) ?? results.find(hasCoords) ?? null;
  }, [results, selectedId]);

  // On-demand geocode for results without stored coords (older/past bookings
  // the upcoming-only backfill never touched). The server geocodes once and
  // persists to the booking, so later visits get the pin instantly.
  // resolvedCoords[id]: coords on success, null = definitively unresolvable,
  // undefined = not looked up yet.
  const [resolvedCoords, setResolvedCoords] = useState<
    Record<number, [number, number] | null>
  >({});
  const [geocodePending, setGeocodePending] = useState(false);
  React.useEffect(() => {
    if (!selected || hasCoords(selected)) return;
    if (resolvedCoords[selected.id] !== undefined) return;
    let cancelled = false;
    const id = selected.id;
    setGeocodePending(true);
    geocodeBooking(API_BASE, id).then((coords) => {
      if (cancelled) return;
      setResolvedCoords((prev) => ({ ...prev, [id]: coords }));
      setGeocodePending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, resolvedCoords]);

  // Coordinates to show for the selected booking: stored ones win; otherwise
  // the on-demand lookup result (if it succeeded).
  const selectedCoords: [number, number] | null = selected
    ? hasCoords(selected)
      ? [selected.addressLat!, selected.addressLng!]
      : resolvedCoords[selected.id] ?? null
    : null;


  return (
    <div className="max-w-7xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">Day Schedule</h1>
          <p className="text-muted-foreground">See who's working and what's assigned.</p>
        </div>
        <Link href="/staff">
          <Button variant="outline" size="sm">
            <User className="w-4 h-4 mr-2" />
            Manage Staff
          </Button>
        </Link>
      </div>

      {/* Address search — find any booking by address or client, any date */}
      <Card className="mb-6 shadow-sm">
        <CardContent className="px-4 py-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bookings by address or client name…"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {searching && (
        <Card className="mb-6 shadow-md border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              {searchLoading
                ? "Searching…"
                : totalMatches !== undefined && totalMatches > results.length
                  ? `Showing ${results.length} of ${totalMatches} matching bookings`
                  : `${results.length} matching booking${results.length !== 1 ? "s" : ""}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {!searchLoading && totalMatches !== undefined && totalMatches > results.length && (
              <p className="text-xs text-muted-foreground px-1 mb-2">
                Results truncated — refine your search to narrow the list.
              </p>
            )}
            {!searchLoading && results.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No bookings match "{search.trim()}".
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  {results.map((booking) => (
                    <div
                      key={booking.id}
                      className={cn(
                        "rounded-lg border p-2.5 flex items-start justify-between gap-2 hover:bg-muted/50 transition-colors",
                        selected?.id === booking.id &&
                          "border-primary/60 ring-1 ring-primary/30 bg-primary/5"
                      )}
                    >
                      {/* Selection is a real button so keyboard users can
                          pick a result (Enter/Space) and see it on the map */}
                      <button
                        type="button"
                        onClick={() => setSelectedId(booking.id)}
                        aria-pressed={selected?.id === booking.id}
                        aria-label={`Show ${booking.firstName} ${booking.lastName} on the map`}
                        className="flex-1 min-w-0 text-left cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <p className="text-sm font-medium truncate">
                          {booking.firstName} {booking.lastName}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <CalendarDays className="w-3 h-3 shrink-0" />
                          <span>{booking.scheduledDate}</span>
                          <Clock className="w-3 h-3 shrink-0 ml-1" />
                          <span>{booking.scheduledTime}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {booking.address}, {booking.city}
                          </span>
                        </div>
                      </button>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full border font-medium",
                            STATUS_COLORS[booking.status]
                          )}
                        >
                          {booking.status}
                        </span>
                        <Link
                          href={`/bookings/${booking.id}`}
                          aria-label="Open booking"
                          className="text-xs text-primary hover:underline flex items-center"
                        >
                          Open <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  {selected ? (
                    selectedCoords ? (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {selected.address}, {selected.city}
                          </span>
                        </p>
                        <BookingMiniMap
                          lat={selectedCoords[0]}
                          lng={selectedCoords[1]}
                          baseUrl={API_BASE}
                        />
                      </div>
                    ) : geocodePending ? (
                      <div className="h-full min-h-[160px] rounded-lg border border-dashed flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
                        Looking up this address on the map…
                      </div>
                    ) : (
                      <div className="h-full min-h-[160px] rounded-lg border border-dashed flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
                        This address couldn't be found on the map — check the
                        street address on the booking.
                      </div>
                    )
                  ) : (
                    <div className="h-full min-h-[160px] rounded-lg border border-dashed flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
                      Click a result to see it on the map.
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Date navigator */}
      <Card className="mb-6 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedDate(offsetDate(selectedDate, -1))}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 text-center">
              <p className="text-lg font-semibold">{formatDate(selectedDate)}</p>
              {selectedDate !== today && (
                <button
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => setSelectedDate(today)}
                >
                  Back to today
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedDate(offsetDate(selectedDate, 1))}
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40 hidden sm:block"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-5 w-32 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-16 bg-muted rounded" />
                  <div className="h-16 bg-muted rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !schedules || schedules.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <CalendarDays className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No active staff found.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add staff members to start scheduling.
            </p>
            <Link href="/staff">
              <Button className="mt-4" variant="outline">
                <User className="w-4 h-4 mr-2" /> Add Staff
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {schedules.map(({ staff, bookings }) => (
            <Card
              key={staff ? staff.id : "unassigned"}
              className={cn(
                "shadow-md transition-all",
                bookings.length === 0 && "border-dashed opacity-80",
                !staff && "border-amber-300 bg-amber-50/40"
              )}
            >
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0",
                          staff ? "brand-gradient" : "bg-amber-500"
                        )}
                      >
                        {staff
                          ? staff.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2)
                          : "?"}
                      </div>
                      {staff ? staff.name : "Unassigned"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5 ml-10">
                      {staff
                        ? (ROLE_LABELS[staff.role] ?? staff.role) +
                          (staff.phone ? ` · ${staff.phone}` : "")
                        : "Jobs with no assigned staff"}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      bookings.length > 0
                        ? "border-primary/30 text-primary bg-primary/5"
                        : "text-muted-foreground"
                    )}
                  >
                    {bookings.length} job{bookings.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {bookings.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    <p>Free all day</p>
                    <Link href={`/new`}>
                      <Button variant="ghost" size="sm" className="mt-1 text-xs h-7">
                        + Assign a job
                      </Button>
                    </Link>
                  </div>
                ) : (
                  bookings.map((booking) => (
                    <Link key={booking.id} href={`/bookings/${booking.id}`}>
                      <div className="rounded-lg border p-2.5 hover:bg-muted/50 transition-colors cursor-pointer">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {booking.firstName} {booking.lastName}
                            </p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>{booking.scheduledTime}</span>
                              <span>·</span>
                              <span>{SERVICE_LABELS[booking.serviceType] ?? booking.serviceType}</span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{booking.address}, {booking.city}</span>
                            </div>
                          </div>
                          <span
                            className={cn(
                              "text-xs px-2 py-0.5 rounded-full border font-medium shrink-0",
                              STATUS_COLORS[booking.status]
                            )}
                          >
                            {booking.status}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
