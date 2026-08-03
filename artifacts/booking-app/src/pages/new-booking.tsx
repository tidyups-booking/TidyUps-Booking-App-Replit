import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBooking, useListStaff, getListBookingsQueryKey, getGetUpcomingBookingsQueryKey, getGetBookingStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Phone, User, Home, MapPin, CalendarClock, DollarSign, CheckCircle2, Users, Navigation, Lock } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { LiveCallPanel } from "@/components/live-call-panel";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { BookingMiniMap } from "@/components/booking-mini-map";
import { EmailAutocomplete } from "@/components/email-autocomplete";
import { CustomerAutocomplete, type CustomerRecord } from "@/components/customer-autocomplete";

const bookingSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(7, "Phone number is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  province: z.string().default("AB"),
  postalCode: z.string().optional().or(z.literal("")),
  serviceType: z.enum(["standard_clean", "deep_clean", "move_in", "move_out", "post_construction"]),
  bedrooms: z.coerce.number().min(0).max(10).default(1),
  bathrooms: z.coerce.number().min(1).max(10).default(1),
  scheduledDate: z.string().min(1, "Date is required"),
  scheduledTime: z.string().min(1, "Time is required"),
  frequency: z.enum(["one_time", "weekly", "biweekly", "monthly"]).default("one_time"),
  estimatedPrice: z.coerce.number().optional(),
  notes: z.string().optional(),
  status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled"]).default("pending"),
  extras: z.array(z.string()).default([]),
  staffId: z.coerce.number().optional(),
  addressLat: z.number().optional(),
  addressLng: z.number().optional(),
});

type BookingFormValues = z.infer<typeof bookingSchema>;

const EXTRAS_OPTIONS = ["Oven", "Fridge", "Windows", "Laundry", "Garage", "Basement", "Inside Cabinets"];

// Derive the API base URL from the current page's base path
function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

// ── Nearest cleaner helper ────────────────────────────────────────────────────

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
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NewBooking() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Track which fields were auto-filled so we can flash them (2s green pulse)
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set());
  // Track AI-filled fields persistently — amber ring clears when dispatcher edits manually (task #19)
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());

  // Track fields the dispatcher has manually corrected after AI fill — locked from AI overwrite (task #20)
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  // Tracks which fields AI has ever filled (used by form.watch to detect subsequent manual edits)
  const aiFilledFieldsRef = useRef<Set<string>>(new Set());
  // True while handleFieldsExtracted is writing values — prevents watch from locking those changes
  const isAiFillingRef = useRef(false);

  // Track the live-call transcript so it can be saved with the booking
  const [callTranscript, setCallTranscript] = useState("");

  // Nearest cleaner suggestion
  const [nearestCleaner, setNearestCleaner] = useState<{ name: string; km: number; id: number } | null>(null);
  // Coords for the mini-map when the address was typed manually (no Places pick)
  const [geocodedCoords, setGeocodedCoords] = useState<[number, number] | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeGenRef = useRef(0);

  const createBooking = useCreateBooking();

  // Fetch active cleaners for assignment dropdown
  const { data: staff = [] } = useListStaff({ activeOnly: true });

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      province: "AB",
      postalCode: "",
      serviceType: "standard_clean",
      bedrooms: 1,
      bathrooms: 1,
      scheduledDate: new Date().toISOString().split("T")[0],
      scheduledTime: "09:00",
      frequency: "one_time",
      status: "pending",
      extras: [],
      notes: "",
      staffId: undefined,
      estimatedPrice: 105,
    },
  });

  // Subscribe to form changes to detect when dispatcher manually edits an AI-filled field → lock it
  useEffect(() => {
    const { unsubscribe } = form.watch((_values, { name, type }) => {
      if (!name || type !== "change") return;
      if (isAiFillingRef.current) return; // skip AI-triggered writes
      if (aiFilledFieldsRef.current.has(name)) {
        setLockedFields((prev) => {
          if (prev.has(name)) return prev;
          const next = new Set(prev);
          next.add(name);
          return next;
        });
      }
    });
    return () => unsubscribe();
  }, [form]);

  // Watch address + city and suggest nearest cleaner
  const address = form.watch("address");
  const city = form.watch("city");

  // Coordinates picked via Places autocomplete (exact) — preferred for the mini-map
  const addressLat = form.watch("addressLat");
  const addressLng = form.watch("addressLng");

  useEffect(() => {
    if (!address || address.length < 5 || !city) {
      setNearestCleaner(null);
      setGeocodedCoords(null);
      return;
    }
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    const gen = ++geocodeGenRef.current; // invalidates slow lookups from older inputs
    geocodeTimerRef.current = setTimeout(async () => {
      // Prefer exact Places coords; only geocode when they're missing
      const coords: [number, number] | null =
        addressLat != null && addressLng != null
          ? [addressLat, addressLng]
          : await geocodeAddress(address, city);
      if (gen !== geocodeGenRef.current) return;
      if (!coords) return;
      setGeocodedCoords(coords);
      // Fetch cleaner locations
      try {
        const res = await fetch(`${getBaseUrl()}api/map/data?date=${new Date().toISOString().split("T")[0]}`, { credentials: "include" });
        if (gen !== geocodeGenRef.current || !res.ok) return;
        const data = await res.json();
        if (gen !== geocodeGenRef.current) return;
        let best: { name: string; km: number; id: number } | null = null;
        for (const s of data.staff) {
          const pos = s.position ?? (s.homeLat != null && s.homeLng != null ? { lat: s.homeLat, lng: s.homeLng } : null);
          if (!pos) continue;
          const km = haversineKm(coords[0], coords[1], pos.lat, pos.lng);
          if (!best || km < best.km) best = { name: s.name, km, id: s.id };
        }
        setNearestCleaner(best);
      } catch { /* ignore */ }
    }, 1200);
    return () => { if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current); };
  }, [address, city, addressLat, addressLng]);

  // Mini-map coords: exact Places pick wins, otherwise the geocoded guess
  const miniMapCoords: [number, number] | null =
    addressLat != null && addressLng != null ? [addressLat, addressLng] : geocodedCoords;

  // Returning-customer detection: when the phone number matches a past customer
  // (and the dispatcher didn't already pick them from the dropdown), show a banner.
  const phoneValue = form.watch("phone");
  const [returningMatch, setReturningMatch] = useState<CustomerRecord | null>(null);
  // True once a returning customer was detected/filled — enables the loyalty discount button
  const [loyaltyEligible, setLoyaltyEligible] = useState(false);
  const [discountApplied, setDiscountApplied] = useState(false);
  const acknowledgedPhoneRef = useRef<string | null>(null); // digits already filled/dismissed
  const returningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returningGenRef = useRef(0);

  useEffect(() => {
    const digits = (phoneValue ?? "").replace(/\D/g, "");
    if (returningTimerRef.current) clearTimeout(returningTimerRef.current);
    const gen = ++returningGenRef.current;
    if (digits.length < 7 || digits === acknowledgedPhoneRef.current) {
      setReturningMatch(null);
      // A different (or cleared) number means this may be a brand-new caller —
      // withdraw the loyalty discount unless it's the acknowledged returning customer
      if (digits !== acknowledgedPhoneRef.current) {
        setLoyaltyEligible(false);
        setDiscountApplied(false);
      }
      return;
    }
    returningTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${getBaseUrl()}api/bookings/customers/search?q=${encodeURIComponent(digits)}`, { credentials: "include" });
        if (gen !== returningGenRef.current || !res.ok) return;
        const data = await res.json();
        if (gen !== returningGenRef.current) return;
        const match = (data.customers ?? []).find(
          (c: CustomerRecord) => c.phone.replace(/\D/g, "") === digits
        );
        setReturningMatch(match ?? null);
        setLoyaltyEligible(!!match);
        if (!match) setDiscountApplied(false);
      } catch { /* ignore */ }
    }, 400);
    return () => { if (returningTimerRef.current) clearTimeout(returningTimerRef.current); };
  }, [phoneValue]);

  // Called by LiveCallPanel when AI extracts fields
  const handleFieldsExtracted = useCallback(
    async (fields: Record<string, any>, newKeys: string[]) => {
      isAiFillingRef.current = true;
      try {
        for (const key of Object.keys(fields)) {
          // Skip fields the dispatcher has already manually corrected
          if (lockedFields.has(key)) continue;
          const val = fields[key];
          if (val === undefined || val === null || val === "") continue;
          if (Array.isArray(val) && val.length === 0) continue;
          form.setValue(key as any, val, { shouldValidate: false, shouldDirty: true });
          aiFilledFieldsRef.current.add(key);
        }
      } finally {
        isAiFillingRef.current = false;
      }

      // Only operate on keys that weren't locked
      const effectiveNewKeys = newKeys.filter((k) => !lockedFields.has(k));
      if (effectiveNewKeys.length > 0) {
        // Persist amber AI-filled indicator for newly filled fields
        setAiFilledFields((prev) => {
          const next = new Set(prev);
          effectiveNewKeys.forEach((k) => next.add(k));
          return next;
        });
        // Flash-highlight newly filled fields for 2 s (green pulse)
        setHighlightedFields(new Set(effectiveNewKeys));
        setTimeout(() => setHighlightedFields(new Set()), 2000);
      }

      // When AI fills an address, run it through Places API to get
      // city, province, postal code, and coordinates automatically.
      // Only fills fields the AI didn't already provide, and respects locks.
      if (effectiveNewKeys.includes("address") && fields.address) {
        try {
          const base = getBaseUrl();
          const query = fields.city
            ? `${fields.address}, ${fields.city}, AB`
            : fields.address;
          const acRes = await fetch(
            `${base}api/places/autocomplete?input=${encodeURIComponent(query)}`,
            { credentials: "include" }
          );
          if (acRes.ok) {
            const { predictions } = await acRes.json() as { predictions?: { placeId: string }[] };
            if (predictions && predictions.length > 0) {
              const detRes = await fetch(
                `${base}api/places/details?placeId=${encodeURIComponent(predictions[0].placeId)}`,
                { credentials: "include" }
              );
              if (detRes.ok) {
                const place = await detRes.json() as {
                  address?: string; city?: string; province?: string;
                  postalCode?: string; lat?: number; lng?: number;
                };
                // Prefer the Places-formatted street address (fixes abbreviations)
                if (place.address && !lockedFields.has("address")) form.setValue("address", place.address, { shouldValidate: true });
                // Only fill city/postal/province if AI didn't extract them and they aren't locked
                if (place.city && !fields.city && !lockedFields.has("city")) form.setValue("city", place.city, { shouldValidate: true });
                if (place.province && !fields.province && !lockedFields.has("province")) form.setValue("province", place.province);
                if (place.postalCode && !fields.postalCode && !lockedFields.has("postalCode")) form.setValue("postalCode", place.postalCode, { shouldValidate: true });
                // Always fill coordinates — AI never provides these
                if (place.lat && place.lng) {
                  form.setValue("addressLat", place.lat);
                  form.setValue("addressLng", place.lng);
                }
                // Flash-highlight the Places-backfilled fields green for 2 s
                const placesFilled: string[] = [];
                if (place.address && !lockedFields.has("address")) placesFilled.push("address");
                if (place.city && !fields.city && !lockedFields.has("city")) placesFilled.push("city");
                if (place.province && !fields.province && !lockedFields.has("province")) placesFilled.push("province");
                if (place.postalCode && !fields.postalCode && !lockedFields.has("postalCode")) placesFilled.push("postalCode");
                if (placesFilled.length > 0) {
                  setHighlightedFields((prev) => new Set([...prev, ...placesFilled]));
                  setTimeout(() => setHighlightedFields(new Set()), 2000);
                }
              }
            }
          }
        } catch { /* fail silently — plain address string is still in the form */ }
      }
    },
    [form, lockedFields]
  );

  // Fill the whole form from a returning customer's last booking
  const handleSelectCustomer = useCallback((c: CustomerRecord) => {
    form.setValue("firstName", c.firstName, { shouldValidate: true });
    form.setValue("lastName", c.lastName, { shouldValidate: true });
    form.setValue("phone", c.phone, { shouldValidate: true });
    if (c.email) form.setValue("email", c.email);
    form.setValue("address", c.address, { shouldValidate: true });
    form.setValue("city", c.city, { shouldValidate: true });
    form.setValue("province", c.province || "AB");
    if (c.postalCode) form.setValue("postalCode", c.postalCode);
    if (c.addressLat != null && c.addressLng != null) {
      form.setValue("addressLat", c.addressLat);
      form.setValue("addressLng", c.addressLng);
    }
    form.setValue("bedrooms", c.bedrooms);
    form.setValue("bathrooms", c.bathrooms);
    // Legacy service type is no longer offered on new bookings
    if (c.serviceType && c.serviceType !== "move_in_out") {
      form.setValue("serviceType", c.serviceType as any);
    }
    // Green flash on everything that was just filled
    const filled = ["firstName", "lastName", "phone", "email", "address", "city", "province", "postalCode", "bedrooms", "bathrooms", "serviceType"];
    setHighlightedFields(new Set(filled));
    setTimeout(() => setHighlightedFields(new Set()), 2000);
    // Their info is in the form now — no need to keep flagging the phone match
    acknowledgedPhoneRef.current = c.phone.replace(/\D/g, "");
    setReturningMatch(null);
    setLoyaltyEligible(true);
  }, [form]);

  // Clears the AI indicator for a field when the dispatcher edits it manually (visual only)
  const markEdited = useCallback((name: string) => {
    setAiFilledFields((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  // Clear field locks and AI indicators when a new call starts or transcript is cleared
  const handleNewCall = useCallback(() => {
    setLockedFields(new Set());
    setAiFilledFields(new Set());
    aiFilledFieldsRef.current = new Set();
  }, []);

  const handleCallClear = useCallback(() => {
    setLockedFields(new Set());
    setAiFilledFields(new Set());
    aiFilledFieldsRef.current = new Set();
  }, []);

  // Fuel surcharge: added to every quote by default ($12.50); editable for out-of-area jobs
  const [fuelSurcharge, setFuelSurcharge] = useState("12.50");

  // Where the customer heard about us — recorded on the booking notes
  const LEAD_SOURCES = ["Google", "Facebook", "Instagram", "TikTok", "Referral"] as const;
  const [leadSource, setLeadSource] = useState<string | null>(null);

  const onSubmit = (data: BookingFormValues) => {
    const submitData: Record<string, any> = { ...data };
    if (isNaN(submitData.estimatedPrice as any)) submitData.estimatedPrice = undefined;
    // Fold the fuel surcharge into the final quoted price
    if (submitData.estimatedPrice !== undefined) {
      const base = parseFloat(String(submitData.estimatedPrice));
      const fuel = parseFloat(fuelSurcharge);
      if (isFinite(base) && isFinite(fuel) && fuel > 0) {
        submitData.estimatedPrice = Math.round((base + fuel) * 100) / 100;
      }
    }
    if (submitData.email === "") submitData.email = undefined;
    if (submitData.postalCode === "") submitData.postalCode = undefined;
    if (!submitData.staffId) submitData.staffId = undefined;
    if (callTranscript.trim()) submitData.callTranscript = callTranscript.trim();
    if (leadSource) {
      submitData.notes = [`Lead source: ${leadSource}`, submitData.notes].filter(Boolean).join("\n");
    }

    createBooking.mutate({ data: submitData as any }, {
      onSuccess: () => {
        toast({ title: "Booking Created", description: "The appointment has been successfully scheduled." });
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUpcomingBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBookingStatsQueryKey() });
        setLocation("/");
      },
      onError: (error: any) => {
        toast({ title: "Error", description: error.error || "Failed to create booking", variant: "destructive" });
      }
    });
  };

  // Helper: CSS class to highlight auto-filled or dispatcher-locked fields
  // Priority: green flash (2s after AI fill) > locked amber > AI-filled amber
  const fieldClass = (name: string) =>
    cn(
      "bg-muted/30 focus:bg-background transition-all duration-300",
      highlightedFields.has(name)
        ? "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30"
        : (lockedFields.has(name) || aiFilledFields.has(name))
          && "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/30"
    );

  // Helper: renders a lock badge next to a field label when locked
  const LockedBadge = ({ name }: { name: string }) =>
    lockedFields.has(name) ? (
      <span
        title="You edited this field — AI won't overwrite it"
        className="inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-300 dark:border-amber-700"
      >
        <Lock className="w-2.5 h-2.5" />
        locked
      </span>
    ) : null;

  return (
    <div className="max-w-4xl mx-auto animate-in slide-in-from-bottom-4 duration-500 pb-24">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">New Booking</h1>
        <p className="text-muted-foreground">Capture appointment details quickly while on the phone.</p>
      </div>

      {/* Live Call Panel */}
      <div className="mb-6">
        <LiveCallPanel
          onFieldsExtracted={handleFieldsExtracted}
          onTranscriptChange={setCallTranscript}
          onNewCall={handleNewCall}
          onClear={handleCallClear}
          baseUrl={getBaseUrl()}
        />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          <div className="grid md:grid-cols-2 gap-6 items-start">
            {/* Left column: Customer Info + Job Scope */}
            <div className="space-y-6">
            {/* Customer Details */}
            <Card className="border-t-4 border-t-primary shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><User className="w-5 h-5 text-primary" /> Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="firstName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name<LockedBadge name="firstName" /></FormLabel>
                      <FormControl>
                        <CustomerAutocomplete placeholder="Jane" value={field.value} onChange={(v) => { markEdited("firstName"); field.onChange(v); }} onSelectCustomer={handleSelectCustomer} baseUrl={getBaseUrl()} className={fieldClass("firstName")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="lastName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name<LockedBadge name="lastName" /></FormLabel>
                      <FormControl>
                        <CustomerAutocomplete placeholder="Doe" value={field.value} onChange={(v) => { markEdited("lastName"); field.onChange(v); }} onSelectCustomer={handleSelectCustomer} baseUrl={getBaseUrl()} className={fieldClass("lastName")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number<LockedBadge name="phone" /></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground z-10" />
                          <CustomerAutocomplete type="tel" placeholder="(780) 555-1234" className={cn("pl-9", fieldClass("phone"))} value={field.value} onChange={(v) => { markEdited("phone"); field.onChange(v); }} onSelectCustomer={handleSelectCustomer} baseUrl={getBaseUrl()} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email<LockedBadge name="email" /> <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <FormControl>
                        <EmailAutocomplete
                          placeholder="jane@example.com"
                          className={fieldClass("email")}
                          value={field.value ?? ""}
                          onChange={(v) => { markEdited("email"); field.onChange(v); }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Returning-customer banner: phone number matches a past booking */}
                {returningMatch && (
                  <div className="rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <span className="font-semibold text-green-800 dark:text-green-300">
                        Returning customer: {returningMatch.firstName} {returningMatch.lastName}
                      </span>
                    </div>
                    <p className="text-xs text-green-700 dark:text-green-400">
                      Last appointment {new Date(returningMatch.lastBookingDate).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} — consider offering a 10% loyalty discount.
                    </p>
                    <div className="flex gap-3 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleSelectCustomer(returningMatch)}
                        className="text-xs font-semibold text-green-700 dark:text-green-400 hover:underline"
                      >
                        Fill their info →
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          acknowledgedPhoneRef.current = returningMatch.phone.replace(/\D/g, "");
                          setReturningMatch(null);
                        }}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Job Details */}
            <Card className="shadow-md">
              <CardHeader className="pb-4 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><Home className="w-5 h-5 text-foreground" /> Job Scope</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <FormField control={form.control} name="serviceType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Type<LockedBadge name="serviceType" /></FormLabel>
                    <FormControl>
                      <NativeSelect
                        {...field}
                        onChange={(e) => { markEdited("serviceType"); field.onChange(e); }}
                        className={cn("h-12 text-base font-medium", fieldClass("serviceType"))}
                      >
                        <option value="standard_clean">Standard Clean</option>
                        <option value="deep_clean">Deep Clean</option>
                        <option value="move_in">Move-In Cleaning Service</option>
                        <option value="move_out">Move-Out Cleaning Service</option>
                        <option value="post_construction">Post-Construction</option>
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="bedrooms" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bedrooms<LockedBadge name="bedrooms" /></FormLabel>
                      <FormControl>
                        <Input type="number" min="0" max="10" className={cn("text-center font-bold text-lg", fieldClass("bedrooms"))} {...field} onChange={(e) => { markEdited("bedrooms"); field.onChange(e); }} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bathrooms" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bathrooms<LockedBadge name="bathrooms" /></FormLabel>
                      <FormControl>
                        <Input type="number" min="1" max="10" step="0.5" className={cn("text-center font-bold text-lg", fieldClass("bathrooms"))} {...field} onChange={(e) => { markEdited("bathrooms"); field.onChange(e); }} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="extras" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Extras<LockedBadge name="extras" /></FormLabel>
                    <FormControl>
                      <div className={cn(
                          "flex flex-wrap gap-2 pt-1 rounded-lg transition-all duration-300 p-1",
                          highlightedFields.has("extras")
                            ? "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30"
                            : (lockedFields.has("extras") || aiFilledFields.has("extras"))
                              && "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/30"
                        )}>
                        {EXTRAS_OPTIONS.map(extra => {
                          const isSelected = field.value.includes(extra);
                          return (
                            <button
                              type="button"
                              key={extra}
                              onClick={() => {
                                markEdited("extras");
                                const newValue = isSelected
                                  ? field.value.filter(v => v !== extra)
                                  : [...field.value, extra];
                                field.onChange(newValue);
                              }}
                              className={cn(
                                "px-3 py-1.5 rounded-full text-sm font-medium border transition-all duration-200 active:scale-95",
                                isSelected
                                  ? "bg-primary text-white border-primary shadow-sm shadow-primary/20"
                                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
                              )}
                            >
                              {extra}
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>
            </div>

            {/* Right column: Location + Scheduling + Price */}
            <div className="space-y-6">
            {/* Location Details */}
            <Card className="border-t-4 border-t-secondary shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><MapPin className="w-5 h-5 text-secondary" /> Location</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address<LockedBadge name="address" /></FormLabel>
                    <FormControl>
                      <AddressAutocomplete
                        value={field.value}
                        onChange={field.onChange}
                        onManualChange={() => {
                          markEdited("address");
                          // Manual typing invalidates the exact Places coordinates
                          form.setValue("addressLat", undefined);
                          form.setValue("addressLng", undefined);
                        }}
                        onPlaceSelect={(place) => {
                          form.setValue("address", place.address, { shouldValidate: true });
                          if (place.city) form.setValue("city", place.city, { shouldValidate: true });
                          if (place.province) form.setValue("province", place.province);
                          if (place.postalCode) form.setValue("postalCode", place.postalCode, { shouldValidate: true });
                          if (place.lat && place.lng) {
                            form.setValue("addressLat", place.lat);
                            form.setValue("addressLng", place.lng);
                          }
                          // Flash-highlight the auto-filled location fields green for 2 s
                          const placeFilled: string[] = ["address"];
                          if (place.city) placeFilled.push("city");
                          if (place.province) placeFilled.push("province");
                          if (place.postalCode) placeFilled.push("postalCode");
                          setHighlightedFields(new Set(placeFilled));
                          setTimeout(() => setHighlightedFields(new Set()), 2000);
                        }}
                        placeholder="123 Main St NW"
                        className={fieldClass("address")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>City<LockedBadge name="city" /></FormLabel>
                      <FormControl>
                        <Input placeholder="Edmonton" className={fieldClass("city")} {...field} onChange={(e) => { markEdited("city"); field.onChange(e); }} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="province" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prov</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} className="bg-muted/30 focus:bg-background transition-colors">
                          <option value="AB">AB</option>
                          <option value="BC">BC</option>
                          <option value="SK">SK</option>
                          <option value="ON">ON</option>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="postalCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postal<LockedBadge name="postalCode" /></FormLabel>
                      <FormControl>
                        <Input placeholder="T5J" className={cn(fieldClass("postalCode"), "uppercase")} {...field} onChange={(e) => { markEdited("postalCode"); field.onChange(e); }} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Live mini-map: caller's location vs cleaners, while on the phone */}
                {miniMapCoords && (
                  <BookingMiniMap
                    lat={miniMapCoords[0]}
                    lng={miniMapCoords[1]}
                    baseUrl={getBaseUrl().replace(/\/$/, "")}
                  />
                )}
              </CardContent>
            </Card>

              <Card className="shadow-md">
                <CardHeader className="pb-4 border-b">
                  <CardTitle className="text-lg flex items-center gap-2"><CalendarClock className="w-5 h-5 text-foreground" /> Scheduling</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="scheduledDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date<LockedBadge name="scheduledDate" /></FormLabel>
                        <FormControl>
                          <Input type="date" className={cn("font-medium", fieldClass("scheduledDate"))} {...field} onChange={(e) => { markEdited("scheduledDate"); field.onChange(e); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="scheduledTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Time<LockedBadge name="scheduledTime" /></FormLabel>
                        <FormControl>
                          <Input type="time" className={cn("font-medium", fieldClass("scheduledTime"))} {...field} onChange={(e) => { markEdited("scheduledTime"); field.onChange(e); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="frequency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency<LockedBadge name="frequency" /></FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          onChange={(e) => { markEdited("frequency"); field.onChange(e); }}
                          className={cn(fieldClass("frequency"))}
                        >
                          <option value="one_time">One Time</option>
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Bi-Weekly</option>
                          <option value="monthly">Monthly</option>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Cleaner assignment */}
                  <FormField control={form.control} name="staffId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Users className="w-4 h-4" />
                        Assign Cleaner <span className="text-muted-foreground font-normal">(Optional)</span>
                      </FormLabel>
                      {nearestCleaner && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-sm">
                          <Navigation className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                          <span className="text-green-700 dark:text-green-400 font-medium">
                            Closest available: {nearestCleaner.name}
                          </span>
                          <span className="text-green-600/70 dark:text-green-500/70">
                            {nearestCleaner.km.toFixed(1)} km away
                          </span>
                          <button
                            type="button"
                            onClick={() => field.onChange(nearestCleaner.id)}
                            className="ml-auto text-xs font-semibold text-green-700 dark:text-green-400 hover:underline"
                          >
                            Assign →
                          </button>
                        </div>
                      )}
                      <FormControl>
                        <NativeSelect
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                          className={cn(fieldClass("staffId"))}
                        >
                          <option value="">Unassigned</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.role === "lead_cleaner" ? "Lead" : s.role === "supervisor" ? "Supervisor" : "Cleaner"})
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card className="shadow-md border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    <FormField control={form.control} name="estimatedPrice" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel className="text-primary-foreground/70 dark:text-primary">Quoted Price ($)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <DollarSign className="w-5 h-5 absolute left-3 top-3 text-primary" />
                            <Input
                              type="number"
                              placeholder="150.00"
                              className="pl-10 text-xl font-bold border-primary/30 focus-visible:ring-primary"
                              {...field}
                              onChange={(e) => { setDiscountApplied(false); field.onChange(e); }}
                            />
                          </div>
                        </FormControl>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">How did they hear about us?</p>
                          <div className="flex flex-wrap gap-1.5">
                            {LEAD_SOURCES.map((src) => (
                              <button
                                key={src}
                                type="button"
                                onClick={() => setLeadSource(leadSource === src ? null : src)}
                                className={cn(
                                  "text-xs font-medium rounded-full px-3 py-1 border transition-colors",
                                  leadSource === src
                                    ? "bg-primary text-white border-primary"
                                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                                )}
                              >
                                {src}
                              </button>
                            ))}
                          </div>
                          {leadSource && (
                            <p className="text-xs text-green-700 dark:text-green-400">
                              Thanks-for-sharing discount? Tap −$10 or −$20 below.
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {[10, 20].map((off) => (
                            <button
                              key={off}
                              type="button"
                              onClick={() => {
                                const current = parseFloat(String(field.value));
                                if (!isFinite(current) || current <= 0) {
                                  toast({ title: "Enter a price first", description: "Type the quoted price, then apply the discount." });
                                  return;
                                }
                                field.onChange((Math.round(Math.max(0, current - off) * 100) / 100).toString());
                              }}
                              className="text-xs font-semibold text-primary border border-primary/30 bg-background rounded-full px-3 py-1 hover:bg-primary/10 transition-colors"
                            >
                              −${off} off
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">+ Fuel surcharge $</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={fuelSurcharge}
                            onChange={(e) => setFuelSurcharge(e.target.value)}
                            className="h-8 w-24 text-sm font-semibold border-primary/30"
                          />
                          {(() => {
                            const base = parseFloat(String(field.value));
                            const fuel = parseFloat(fuelSurcharge) || 0;
                            return isFinite(base) && base > 0 ? (
                              <span className="ml-auto font-bold text-primary">
                                Total: ${(Math.round((base + fuel) * 100) / 100).toFixed(2)}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        {loyaltyEligible && (
                          discountApplied ? (
                            <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> 10% loyalty discount applied
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const current = parseFloat(String(field.value));
                                if (!isFinite(current) || current <= 0) {
                                  toast({ title: "Enter a price first", description: "Type the quoted price, then apply the discount." });
                                  return;
                                }
                                field.onChange((Math.round(current * 0.9 * 100) / 100).toString());
                                setDiscountApplied(true);
                              }}
                              className="text-xs font-semibold text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 rounded-full px-3 py-1 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                            >
                              Apply 10% loyalty discount
                            </button>
                          )
                        )}
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="status" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel className="text-primary-foreground/70 dark:text-primary">Initial Status</FormLabel>
                        <FormControl>
                          <NativeSelect {...field} className="border-primary/30 font-medium">
                            <option value="pending">Pending</option>
                            <option value="confirmed">Confirmed</option>
                          </NativeSelect>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="shadow-md">
            <CardContent className="p-4">
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal Notes / Entry Instructions<LockedBadge name="notes" /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. Key under mat, dog in backyard..."
                      className={cn("min-h-[100px]", fieldClass("notes"))}
                      {...field}
                      onChange={(e) => { markEdited("notes"); field.onChange(e); }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Sticky Footer */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-md border-t shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-40 md:relative md:bg-transparent md:border-0 md:shadow-none md:p-0 md:backdrop-blur-none">
            <Button
              type="submit"
              size="lg"
              className="w-full text-xl shadow-xl shadow-primary/20 h-16 rounded-xl animate-in zoom-in-95 duration-300"
              isLoading={createBooking.isPending}
            >
              <CheckCircle2 className="w-6 h-6 mr-2" />
              Book Appointment
            </Button>
          </div>

        </form>
      </Form>
    </div>
  );
}
