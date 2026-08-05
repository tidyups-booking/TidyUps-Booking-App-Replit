import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { History } from "lucide-react";

// Returning-customer autocomplete. Wraps a plain input; as the dispatcher
// types a name or phone number, previous customers appear in a dropdown.
// Picking one hands the full customer record back so the whole form
// (name, phone, email, address, beds/baths, service) can be pre-filled.

export interface CustomerRecord {
  bookingCount?: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  province: string;
  postalCode: string | null;
  addressLat: number | null;
  addressLng: number | null;
  bedrooms: number;
  bathrooms: number;
  serviceType: string;
  frequency: string;
  lastBookingDate: string;
}

interface Props extends Omit<React.ComponentProps<typeof Input>, "onChange" | "value" | "onSelect"> {
  value: string;
  onChange: (value: string) => void;
  onSelectCustomer: (customer: CustomerRecord) => void;
  /** API base URL ending with a slash (e.g. from getBaseUrl()) */
  baseUrl: string;
}

export function CustomerAutocomplete({ value, onChange, onSelectCustomer, baseUrl, ...rest }: Props) {
  const [results, setResults] = useState<CustomerRecord[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = value?.trim() ?? "";
    if (timerRef.current) clearTimeout(timerRef.current);
    const gen = ++genRef.current;
    if (q.length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${baseUrl}api/bookings/customers/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (gen !== genRef.current || !res.ok) return;
        const data = await res.json();
        if (gen !== genRef.current) return;
        setResults(data.customers ?? []);
      } catch { /* ignore */ }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, baseUrl]);

  return (
    <div className="relative">
      <Input
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
        {...rest}
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg border bg-popover shadow-lg overflow-hidden">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50">
            Returning customers
          </div>
          {results.map((c, i) => (
            <button
              type="button"
              key={i}
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); setResults([]); onSelectCustomer(c); }}
              className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground transition-colors flex items-start gap-2"
            >
              <History className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{c.firstName} {c.lastName} · {c.phone}</span>
                <span className="block text-xs text-muted-foreground truncate">{c.address}, {c.city}</span>
              </span>
              {typeof c.bookingCount === "number" && c.bookingCount > 0 && (
                <span
                  data-testid="booking-count-badge"
                  className="ml-auto mt-0.5 flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400"
                >
                  {c.bookingCount} booking{c.bookingCount === 1 ? "" : "s"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
