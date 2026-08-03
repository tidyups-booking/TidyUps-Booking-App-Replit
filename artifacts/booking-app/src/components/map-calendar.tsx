/**
 * Calendar view components for the Live Map page.
 * Exports: MonthCalendar, ColumnCalendar (handles both week and 3-day)
 */
import React from "react";
import { format, addDays, subDays } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface CalendarBooking {
  id: number;
  firstName: string;
  lastName: string;
  scheduledTime: string | null;
  staffId: number | null;
  status?: string;
  serviceType?: string;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Parse a time string to a fractional hour (e.g. 9.5 = 9:30).
 * Handles both 24-hour "HH:mm" (used by local bookings and Jobber imports)
 * and 12-hour "h:mm AM/PM" (legacy format).
 */
export function parseTimeToHour(timeStr: string | null): number {
  if (!timeStr) return 9;

  // 24-hour: "09:00", "14:30", "8:00"
  const h24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const hour = parseInt(h24[1], 10);
    const min = parseInt(h24[2], 10);
    return hour + min / 60;
  }

  // 12-hour: "9:00 AM", "2:30 PM"
  const h12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (h12) {
    let hour = parseInt(h12[1], 10);
    const min = parseInt(h12[2], 10);
    const ampm = h12[3].toUpperCase();
    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return hour + min / 60;
  }

  return 9; // fallback
}

const CLEANER_COLORS = [
  "#EE3FCE", "#8870C4", "#3B82F6", "#10B981",
  "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];
export function calendarCleanerColor(id: number) {
  return CLEANER_COLORS[id % CLEANER_COLORS.length];
}

// ── Month Calendar ────────────────────────────────────────────────────────────

interface MonthCalendarProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  counts: Record<string, number>;
  currentMonth: Date;
  onMonthChange: (delta: number) => void;
}

export function MonthCalendar({
  selectedDate, onDateSelect, counts, currentMonth, onMonthChange,
}: MonthCalendarProps) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = format(new Date(), "yyyy-MM-dd");
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Grid starts on the Monday of the week containing the 1st
  const firstOfMonth = new Date(year, month, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = subDays(firstOfMonth, mondayOffset);

  const lastOfMonth = new Date(year, month + 1, 0);
  const lastSundayOffset = (7 - ((lastOfMonth.getDay() + 6) % 7 + 1)) % 7;
  const gridEnd = addDays(lastOfMonth, lastSundayOffset);

  const allDays: Date[] = [];
  let cur = new Date(gridStart);
  while (cur <= gridEnd) {
    allDays.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => onMonthChange(-1)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="font-semibold text-base">{format(currentMonth, "MMMM yyyy")}</h3>
          <button
            onClick={() => onMonthChange(1)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0.5 mb-0.5">
            {week.map(d => {
              const ds = format(d, "yyyy-MM-dd");
              const inMonth = d.getMonth() === month;
              const isSel = ds === selectedDate;
              const isTd = ds === today;
              const cnt = counts[ds] ?? 0;
              return (
                <button
                  key={ds}
                  onClick={() => onDateSelect(ds)}
                  className={cn(
                    "flex flex-col items-center pt-1.5 pb-1 rounded-lg transition-all min-h-[52px]",
                    isSel
                      ? "brand-gradient text-white shadow-md shadow-primary/20"
                      : isTd
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : !inMonth
                      ? "opacity-30"
                      : "hover:bg-muted"
                  )}
                >
                  <span className="text-sm font-semibold leading-none">{format(d, "d")}</span>
                  {cnt > 0 && (
                    <span
                      className={cn(
                        "mt-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                        isSel ? "bg-white/25 text-white" : "bg-primary/15 text-primary"
                      )}
                    >
                      {cnt}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        <p className="text-xs text-muted-foreground mt-2 text-center">
          Numbers = bookings · click any date to see it on the map
        </p>
      </CardContent>
    </Card>
  );
}

// ── Column Calendar (Week / 3-Day) ────────────────────────────────────────────

const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const HOUR_HEIGHT_PX = 52;
const GRID_HOURS = GRID_END_HOUR - GRID_START_HOUR;

interface ColumnCalendarProps {
  dates: Date[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
  bookingsByDate: Record<string, CalendarBooking[]>;
}

export function ColumnCalendar({
  dates, selectedDate, onDateSelect, bookingsByDate,
}: ColumnCalendarProps) {
  const HOURS = Array.from({ length: GRID_HOURS }, (_, i) => GRID_START_HOUR + i);
  const today = format(new Date(), "yyyy-MM-dd");
  const totalH = GRID_HOURS * HOUR_HEIGHT_PX;

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div
            className="flex min-w-0"
            style={{ minWidth: dates.length > 3 ? `${dates.length * 130 + 48}px` : undefined }}
          >
            {/* Time gutter */}
            <div className="w-12 flex-shrink-0 border-r bg-muted/30">
              <div className="h-[58px] border-b" />
              {HOURS.map(h => (
                <div
                  key={h}
                  className="flex items-start justify-end pr-2 pt-1 border-b border-border/40"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                >
                  <span className="text-[10px] text-muted-foreground leading-none">
                    {h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {dates.map(d => {
              const ds = format(d, "yyyy-MM-dd");
              const isSel = ds === selectedDate;
              const isTd = ds === today;
              const dayBookings = bookingsByDate[ds] ?? [];

              return (
                <div
                  key={ds}
                  className={cn(
                    "flex-1 min-w-[100px] border-r last:border-r-0",
                    isSel && "bg-primary/5"
                  )}
                >
                  {/* Column header */}
                  <button
                    onClick={() => onDateSelect(ds)}
                    className={cn(
                      "w-full h-[58px] flex flex-col items-center justify-center border-b transition-colors",
                      isSel ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider",
                        isTd ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {format(d, "EEE")}
                    </span>
                    <span
                      className={cn(
                        "text-lg font-bold w-8 h-8 flex items-center justify-center rounded-full mt-0.5",
                        isSel
                          ? "brand-gradient text-white"
                          : isTd
                          ? "bg-primary text-white"
                          : "text-foreground"
                      )}
                    >
                      {format(d, "d")}
                    </span>
                  </button>

                  {/* Time body */}
                  <div className="relative bg-background" style={{ height: `${totalH}px` }}>
                    {/* Hour grid lines */}
                    {HOURS.map((_, i) => (
                      <div
                        key={i}
                        className="absolute w-full border-b border-border/25"
                        style={{ top: `${i * HOUR_HEIGHT_PX}px` }}
                      />
                    ))}

                    {/* Booking blocks */}
                    {dayBookings.map(b => {
                      const hour = parseTimeToHour(b.scheduledTime);
                      const clampedHour = Math.max(GRID_START_HOUR, Math.min(GRID_END_HOUR - 0.75, hour));
                      const topPx = (clampedHour - GRID_START_HOUR) * HOUR_HEIGHT_PX;
                      const color = b.staffId != null ? calendarCleanerColor(b.staffId) : "#6B7280";

                      return (
                        <div
                          key={b.id}
                          className="absolute left-0.5 right-0.5 rounded overflow-hidden cursor-pointer z-10 transition-all hover:z-20 hover:shadow-md"
                          style={{
                            top: `${topPx}px`,
                            minHeight: "38px",
                            backgroundColor: color + "22",
                            borderLeft: `3px solid ${color}`,
                          }}
                          onClick={() => onDateSelect(ds)}
                          title={`${b.firstName} ${b.lastName} — ${b.scheduledTime ?? "time TBD"}`}
                        >
                          <div className="px-1 py-0.5">
                            <p className="text-[10px] font-semibold leading-tight" style={{ color }}>
                              {b.scheduledTime ?? "—"}
                            </p>
                            <p className="text-[10px] leading-tight text-foreground/75 truncate">
                              {b.firstName} {b.lastName}
                            </p>
                          </div>
                        </div>
                      );
                    })}

                    {dayBookings.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-xs text-muted-foreground/35 select-none">free</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
