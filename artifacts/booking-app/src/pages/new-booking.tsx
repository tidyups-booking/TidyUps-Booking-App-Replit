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
import { Phone, User, Home, MapPin, CalendarClock, DollarSign, CheckCircle2, Users, Navigation } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { LiveCallPanel } from "@/components/live-call-panel";

const bookingSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(7, "Phone number is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  province: z.string().default("AB"),
  postalCode: z.string().optional().or(z.literal("")),
  serviceType: z.enum(["standard_clean", "deep_clean", "move_in_out", "post_construction"]),
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

  // Track which fields were auto-filled so we can flash them
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set());

  // Nearest cleaner suggestion
  const [nearestCleaner, setNearestCleaner] = useState<{ name: string; km: number; id: number } | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    },
  });

  // Watch address + city and suggest nearest cleaner
  const address = form.watch("address");
  const city = form.watch("city");

  useEffect(() => {
    if (!address || address.length < 5 || !city) {
      setNearestCleaner(null);
      return;
    }
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(async () => {
      const coords = await geocodeAddress(address, city);
      if (!coords) return;
      // Fetch cleaner locations
      try {
        const res = await fetch(`${getBaseUrl()}api/map/data?date=${new Date().toISOString().split("T")[0]}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        let best: { name: string; km: number; id: number } | null = null;
        for (const s of data.staff) {
          if (!s.location) continue;
          const km = haversineKm(coords[0], coords[1], s.location.lat, s.location.lng);
          if (!best || km < best.km) best = { name: s.name, km, id: s.id };
        }
        setNearestCleaner(best);
      } catch { /* ignore */ }
    }, 1200);
    return () => { if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current); };
  }, [address, city]);

  // Called by LiveCallPanel when AI extracts fields
  const handleFieldsExtracted = useCallback(
    (fields: Record<string, any>, newKeys: string[]) => {
      // Fill each extracted field into the form
      for (const key of Object.keys(fields)) {
        const val = fields[key];
        if (val === undefined || val === null || val === "") continue;
        if (Array.isArray(val) && val.length === 0) continue;
        form.setValue(key as any, val, { shouldValidate: false, shouldDirty: true });
      }

      // Flash-highlight newly filled fields
      setHighlightedFields(new Set(newKeys));
      setTimeout(() => setHighlightedFields(new Set()), 2000);
    },
    [form]
  );

  const onSubmit = (data: BookingFormValues) => {
    const submitData = { ...data };
    if (isNaN(submitData.estimatedPrice as any)) submitData.estimatedPrice = undefined;
    if (submitData.email === "") submitData.email = undefined;
    if (submitData.postalCode === "") submitData.postalCode = undefined;
    if (!submitData.staffId) submitData.staffId = undefined;

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

  // Helper: CSS class to highlight auto-filled fields
  const fieldClass = (name: string) =>
    cn(
      "bg-muted/30 focus:bg-background transition-all duration-300",
      highlightedFields.has(name) && "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30"
    );

  return (
    <div className="max-w-4xl mx-auto animate-in slide-in-from-bottom-4 duration-500 pb-24">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">New Booking</h1>
        <p className="text-muted-foreground">Capture appointment details quickly while on the phone.</p>
      </div>

      {/* Live Call Panel */}
      <div className="mb-6">
        <LiveCallPanel onFieldsExtracted={handleFieldsExtracted} baseUrl={getBaseUrl()} />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          <div className="grid md:grid-cols-2 gap-6">
            {/* Customer Details */}
            <Card className="border-t-4 border-t-primary shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><User className="w-5 h-5 text-primary" /> Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="firstName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane" {...field} className={fieldClass("firstName")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="lastName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} className={fieldClass("lastName")} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
                          <Input type="tel" placeholder="(780) 555-1234" className={cn("pl-9", fieldClass("phone"))} {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="jane@example.com" className={fieldClass("email")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>

            {/* Location Details */}
            <Card className="border-t-4 border-t-secondary shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><MapPin className="w-5 h-5 text-secondary" /> Location</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St NW" className={fieldClass("address")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="Edmonton" className={fieldClass("city")} {...field} />
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
                      <FormLabel>Postal</FormLabel>
                      <FormControl>
                        <Input placeholder="T5J" className={cn(fieldClass("postalCode"), "uppercase")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Job Details */}
            <Card className="shadow-md">
              <CardHeader className="pb-4 border-b">
                <CardTitle className="text-lg flex items-center gap-2"><Home className="w-5 h-5 text-foreground" /> Job Scope</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <FormField control={form.control} name="serviceType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Type</FormLabel>
                    <FormControl>
                      <NativeSelect
                        {...field}
                        className={cn("h-12 text-base font-medium", highlightedFields.has("serviceType") && "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30")}
                      >
                        <option value="standard_clean">Standard Clean</option>
                        <option value="deep_clean">Deep Clean</option>
                        <option value="move_in_out">Move In/Out</option>
                        <option value="post_construction">Post-Construction</option>
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="bedrooms" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bedrooms</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" max="10" className={cn("text-center font-bold text-lg", fieldClass("bedrooms"))} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bathrooms" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bathrooms</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" max="10" step="0.5" className={cn("text-center font-bold text-lg", fieldClass("bathrooms"))} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="extras" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Extras</FormLabel>
                    <FormControl>
                      <div className={cn("flex flex-wrap gap-2 pt-1 rounded-lg transition-all duration-300 p-1", highlightedFields.has("extras") && "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30")}>
                        {EXTRAS_OPTIONS.map(extra => {
                          const isSelected = field.value.includes(extra);
                          return (
                            <button
                              type="button"
                              key={extra}
                              onClick={() => {
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

            {/* Schedule & Price */}
            <div className="space-y-6">
              <Card className="shadow-md">
                <CardHeader className="pb-4 border-b">
                  <CardTitle className="text-lg flex items-center gap-2"><CalendarClock className="w-5 h-5 text-foreground" /> Scheduling</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="scheduledDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input type="date" className={cn("font-medium", fieldClass("scheduledDate"))} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="scheduledTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Time</FormLabel>
                        <FormControl>
                          <Input type="time" className={cn("font-medium", fieldClass("scheduledTime"))} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="frequency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          className={cn(highlightedFields.has("frequency") && "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30")}
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
                          className={cn(highlightedFields.has("staffId") && "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30")}
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
                            <Input type="number" placeholder="150.00" className="pl-10 text-xl font-bold border-primary/30 focus-visible:ring-primary" {...field} />
                          </div>
                        </FormControl>
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
                  <FormLabel>Internal Notes / Entry Instructions</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. Key under mat, dog in backyard..."
                      className={cn("min-h-[100px]", fieldClass("notes"))}
                      {...field}
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
