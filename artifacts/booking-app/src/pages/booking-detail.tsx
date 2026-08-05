import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  useGetBooking, 
  useUpdateBooking, 
  useDeleteBooking,
  useListStaff,
  getGetBookingQueryKey,
  getListBookingsQueryKey,
  getGetUpcomingBookingsQueryKey,
  getGetBookingStatsQueryKey,
  type BookingUpdate,
  BookingUpdateServiceType,
  BookingUpdateFrequency,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, ServiceTypeBadge } from "@/components/badges";
import { formatDate, formatTime, formatCurrency, cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { 
  ArrowLeft, MapPin, Phone, Mail, Home, Clock, Calendar, 
  Edit3, Trash2, CheckCircle2, AlertCircle, FileText, 
  User, ChevronDown, ChevronUp, Mic, X, Save, Users, DollarSign
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { JobberSyncCard, type JobberSyncStatus } from "@/components/jobber-sync-card";
import { geocodeBooking } from "@/lib/geocode-booking";
import { BookingMiniMap } from "@/components/booking-mini-map";
import { PriceDiscountButtons } from "@/components/price-discount-buttons";

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

interface CallTranscriptRow {
  id: number;
  bookingId: number;
  transcript: string;
  callDurationSeconds: number | null;
  createdAt: string;
}

const EXTRAS_OPTIONS = ["Oven", "Fridge", "Windows", "Laundry", "Garage", "Basement", "Inside Cabinets"];

// Shown when a booking has an address but no saved coordinates (bookings created
// before Places autocomplete). Explains why the mini-map is missing and how to fix it.
function MissingCoordinatesHint({ mode }: { mode: "view" | "edit" }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <MapPin className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />
      <span>
        Map unavailable — this booking has no saved map coordinates.{" "}
        {mode === "edit"
          ? "Re-select the street address from the autocomplete suggestions to pin it on the map."
          : "Edit the booking and re-select the address from the autocomplete suggestions to pin it on the map."}
      </span>
    </div>
  );
}

const editSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(7, "Phone number is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  province: z.string().default("AB"),
  postalCode: z.string().optional().or(z.literal("")),
  serviceType: z.enum(["standard_clean", "deep_clean", "move_in_out", "move_in", "move_out", "post_construction"]),
  bedrooms: z.coerce.number().min(0).max(10),
  bathrooms: z.coerce.number().min(1).max(10),
  scheduledDate: z.string().min(1, "Date is required"),
  scheduledTime: z.string().min(1, "Time is required"),
  frequency: z.enum(["one_time", "weekly", "biweekly", "monthly"]),
  estimatedPrice: z.coerce.number().optional(),
  notes: z.string().optional(),
  extras: z.array(z.string()).default([]),
  staffId: z.coerce.number().optional(),
  addressLat: z.number().optional(),
  addressLng: z.number().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

export default function BookingDetail() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [jobberJobId, setJobberJobId] = useState<string | null | undefined>(undefined);
  const [jobberSyncStatus, setJobberSyncStatus] = useState<JobberSyncStatus | null | undefined>(undefined);
  const [jobberSyncError, setJobberSyncError] = useState<string | null | undefined>(undefined);

  const [transcripts, setTranscripts] = useState<CallTranscriptRow[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);

  // Quick-discount state (mirrors New Booking): loyalty button appears when the
  // customer has prior bookings besides this one.
  const [loyaltyEligible, setLoyaltyEligible] = useState(false);
  const [discountApplied, setDiscountApplied] = useState(false);
  // Dollar amount of the 10% loyalty discount when applied
  const [loyaltyAmount, setLoyaltyAmount] = useState(0);
  // Tap counters for the quick −$10/−$20 buttons (shared PriceDiscountButtons)
  const [tenCount, setTenCount] = useState(0);
  const [twentyCount, setTwentyCount] = useState(0);

  const { data: booking, isLoading, isError } = useGetBooking(id, {
    query: {
      enabled: !!id,
      queryKey: getGetBookingQueryKey(id),
      select: (data: any) => {
        // Sync jobber fields into local state on first load
        if (jobberJobId === undefined && data?.jobberJobId !== undefined) {
          setJobberJobId(data.jobberJobId);
        }
        if (jobberSyncStatus === undefined && data?.jobberSyncStatus !== undefined) {
          setJobberSyncStatus(data.jobberSyncStatus as JobberSyncStatus);
          setJobberSyncError(data.jobberSyncError ?? null);
        }
        return data;
      }
    }
  });

  // On-demand geocode for older bookings without saved coordinates (created
  // before Places autocomplete). Same shared helper as the Schedule/Map pages;
  // the server persists the result so later visits get the pin instantly.
  // Keyed by booking id so navigating between bookings never shows a stale pin.
  // resolvedCoordsById[id]: coords on success, null = definitively unresolvable,
  // undefined = not looked up yet.
  const [resolvedCoordsById, setResolvedCoordsById] = useState<
    Record<number, [number, number] | null>
  >({});
  const [geocodePendingId, setGeocodePendingId] = useState<number | null>(null);
  useEffect(() => {
    if (!booking || booking.addressLat != null || !booking.address) return;
    const bookingId = booking.id;
    if (resolvedCoordsById[bookingId] !== undefined) return;
    let cancelled = false;
    setGeocodePendingId(bookingId);
    geocodeBooking(getBaseUrl().replace(/\/$/, ""), bookingId).then((coords) => {
      if (cancelled) return;
      setResolvedCoordsById((prev) => ({ ...prev, [bookingId]: coords }));
      setGeocodePendingId((prev) => (prev === bookingId ? null : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [booking, resolvedCoordsById]);
  // Only the current booking's lookup result / pending state count.
  const resolvedCoords = booking ? resolvedCoordsById[booking.id] ?? null : null;
  const geocodePending = booking != null && geocodePendingId === booking.id;

  const updateBooking = useUpdateBooking();
  const deleteBooking = useDeleteBooking();
  const { data: staff = [] } = useListStaff({ activeOnly: true });

  // Edit form
  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
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
      scheduledDate: "",
      scheduledTime: "09:00",
      frequency: "one_time",
      extras: [],
      notes: "",
      staffId: undefined,
    },
  });

  // Populate form when booking loads or edit mode is entered
  const populateForm = useCallback((b: any) => {
    form.reset({
      firstName: b.firstName ?? "",
      lastName: b.lastName ?? "",
      phone: b.phone ?? "",
      email: b.email ?? "",
      address: b.address ?? "",
      city: b.city ?? "",
      province: b.province ?? "AB",
      postalCode: b.postalCode ?? "",
      serviceType: b.serviceType ?? "standard_clean",
      bedrooms: b.bedrooms ?? 1,
      bathrooms: b.bathrooms ?? 1,
      scheduledDate: b.scheduledDate ?? "",
      scheduledTime: b.scheduledTime ?? "09:00",
      frequency: b.frequency ?? "one_time",
      estimatedPrice: b.estimatedPrice ?? undefined,
      notes: b.notes ?? "",
      extras: b.extras ?? [],
      staffId: b.staffId ?? undefined,
      addressLat: b.addressLat ?? undefined,
      addressLng: b.addressLng ?? undefined,
    });
  }, [form]);

  const handleEnterEdit = () => {
    if (booking) populateForm(booking);
    setDiscountApplied(false);
    setLoyaltyAmount(0);
    setTenCount(0);
    setTwentyCount(0);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    form.reset();
  };

  // Loyalty-discount eligibility: customer has bookings other than this one.
  // Matches the New Booking returning-customer lookup by phone digits.
  useEffect(() => {
    const digits = (booking?.phone ?? "").replace(/\D/g, "");
    if (digits.length < 7) {
      setLoyaltyEligible(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBaseUrl()}api/bookings/customers/search?q=${encodeURIComponent(digits)}`, { credentials: "include" });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const match = (data.customers ?? []).find(
          (c: { phone: string; bookingCount?: number }) => c.phone.replace(/\D/g, "") === digits
        );
        // This booking itself counts as one — prior bookings means count > 1
        setLoyaltyEligible(!!match && (match.bookingCount ?? 1) > 1);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [booking?.phone]);

  // Fetch call transcript for this booking
  useEffect(() => {
    if (!id) return;
    fetch(`${getBaseUrl()}api/call-transcripts/${id}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((rows: CallTranscriptRow[]) => setTranscripts(rows))
      .catch(() => {});
  }, [id]);

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`${getBaseUrl()}api/call-transcripts/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: noteText.trim() }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      const newRow: CallTranscriptRow = await res.json();
      setTranscripts((prev) => [...prev, newRow]);
      setNoteText("");
      setAddNoteOpen(false);
      setTranscriptOpen(true);
      toast({ title: "Note saved", description: "Call note added to this booking." });
    } catch {
      toast({ title: "Error", description: "Failed to save call note.", variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  if (isError) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold">Booking Not Found</h2>
        <p className="text-muted-foreground mt-2">The booking you are looking for does not exist or was deleted.</p>
        <Button className="mt-6" variant="outline" onClick={() => setLocation("/bookings")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Bookings
        </Button>
      </div>
    );
  }

  const handleStatusChange = (newStatus: string) => {
    updateBooking.mutate({
      id,
      data: { status: newStatus as any }
    }, {
      onSuccess: (data) => {
        toast({ title: "Status Updated", description: `Booking marked as ${newStatus}` });
        queryClient.setQueryData(getGetBookingQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUpcomingBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBookingStatsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
      }
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to completely delete this booking? This action cannot be undone.")) {
      deleteBooking.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Booking Deleted" });
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetUpcomingBookingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBookingStatsQueryKey() });
          setLocation("/bookings");
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to delete booking", variant: "destructive" });
        }
      });
    }
  };

  const onSaveEdit = (data: EditFormValues) => {
    const payload: BookingUpdate = {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      // Nullable fields — send null to clear, not undefined (which is a no-op)
      email: data.email?.trim() || null,
      address: data.address,
      city: data.city,
      province: data.province,
      postalCode: data.postalCode?.trim() || null,
      serviceType: data.serviceType as (typeof BookingUpdateServiceType)[keyof typeof BookingUpdateServiceType],
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      extras: data.extras,
      scheduledDate: data.scheduledDate,
      scheduledTime: data.scheduledTime,
      frequency: data.frequency as (typeof BookingUpdateFrequency)[keyof typeof BookingUpdateFrequency],
      estimatedPrice: (data.estimatedPrice !== undefined && !isNaN(data.estimatedPrice)) ? data.estimatedPrice : null,
      // The saved itemized breakdown can't be reconstructed here — clear it
      // whenever the quoted price changes so it never contradicts the total.
      ...((((data.estimatedPrice !== undefined && !isNaN(data.estimatedPrice)) ? data.estimatedPrice : null) !==
        ((booking as any)?.estimatedPrice ?? null)) ? { priceBreakdown: null } : {}),
      notes: data.notes?.trim() || null,
      staffId: data.staffId || null,
      // Coordinates — send null when no autocomplete selection was made (address text unchanged)
      addressLat: data.addressLat ?? null,
      addressLng: data.addressLng ?? null,
    };

    updateBooking.mutate({ id, data: payload }, {
      onSuccess: (updated) => {
        toast({ title: "Booking Updated", description: "All changes have been saved." });
        queryClient.setQueryData(getGetBookingQueryKey(id), updated);
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUpcomingBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBookingStatsQueryKey() });
        setIsEditing(false);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
      }
    });
  };

  if (isLoading || !booking) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/4" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const apiBaseUrl = getBaseUrl().replace(/\/$/, "");

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (isEditing) {
    const extras = form.watch("extras") ?? [];
    const editLat = form.watch("addressLat");
    const editLng = form.watch("addressLng");
    const toggleExtra = (extra: string) => {
      const current = form.getValues("extras") ?? [];
      form.setValue(
        "extras",
        current.includes(extra) ? current.filter((e) => e !== extra) : [...current, extra],
        { shouldDirty: true }
      );
    };

    return (
      <div className="max-w-5xl mx-auto animate-in slide-in-from-bottom-4 duration-500 pb-10">
        {/* Edit Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <Button variant="ghost" onClick={handleCancelEdit} className="gap-2 -ml-4 hover:bg-transparent">
            <ArrowLeft className="w-4 h-4" /> Cancel
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Editing Booking #{id}</span>
            <Button
              variant="outline"
              onClick={handleCancelEdit}
              disabled={updateBooking.isPending}
              className="gap-2"
            >
              <X className="w-4 h-4" /> Discard
            </Button>
            <Button
              onClick={form.handleSubmit(onSaveEdit)}
              disabled={updateBooking.isPending}
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              {updateBooking.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSaveEdit)} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Customer Info */}
              <Card className="border-t-4 border-t-primary shadow-md">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" /> Customer Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="firstName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl><Input placeholder="Jane" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="lastName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl><Input placeholder="Doe" {...field} /></FormControl>
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
                            <Input type="tel" placeholder="(780) 555-1234" className="pl-9" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                        <FormControl><Input type="email" placeholder="jane@example.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>

              {/* Location */}
              <Card className="border-t-4 border-t-secondary shadow-md">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-secondary" /> Location
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <AddressAutocomplete
                          value={field.value}
                          onChange={field.onChange}
                          onPlaceSelect={(place) => {
                            form.setValue("address", place.address, { shouldValidate: true });
                            if (place.city) form.setValue("city", place.city, { shouldValidate: true });
                            if (place.province) form.setValue("province", place.province);
                            if (place.postalCode) form.setValue("postalCode", place.postalCode, { shouldValidate: true });
                            if (place.lat && place.lng) {
                              form.setValue("addressLat", place.lat);
                              form.setValue("addressLng", place.lng);
                            }
                          }}
                          placeholder="123 Main St NW"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
                    <FormField control={form.control} name="city" render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl><Input placeholder="Edmonton" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="province" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prov</FormLabel>
                        <FormControl>
                          <NativeSelect {...field}>
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
                        <FormControl><Input placeholder="T5J" className="uppercase" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  {editLat != null && editLng != null ? (
                    <BookingMiniMap lat={editLat} lng={editLng} baseUrl={apiBaseUrl} />
                  ) : form.watch("address") ? (
                    <MissingCoordinatesHint mode="edit" />
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Job Scope */}
              <Card className="shadow-md">
                <CardHeader className="pb-4 border-b">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Home className="w-5 h-5" /> Job Scope
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <FormField control={form.control} name="serviceType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Type</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} className="h-12 text-base font-medium">
                          <option value="standard_clean">Standard Clean</option>
                          <option value="deep_clean">Deep Clean</option>
                          <option value="move_in">Move-In Cleaning Service</option>
                          <option value="move_out">Move-Out Cleaning Service</option>
                          <option value="move_in_out">Move In/Out (legacy)</option>
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
                        <FormControl><Input type="number" min={0} max={10} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="bathrooms" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bathrooms</FormLabel>
                        <FormControl><Input type="number" min={1} max={10} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Extras</p>
                    <div className="flex flex-wrap gap-2">
                      {EXTRAS_OPTIONS.map((extra) => (
                        <button
                          key={extra}
                          type="button"
                          onClick={() => toggleExtra(extra)}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                            extras.includes(extra)
                              ? "bg-secondary text-secondary-foreground border-secondary"
                              : "bg-background text-muted-foreground border-muted hover:border-secondary/50"
                          )}
                        >
                          {extra}
                        </button>
                      ))}
                    </div>
                  </div>
                  <FormField control={form.control} name="estimatedPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Price ($)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-3 text-muted-foreground text-sm">$</span>
                          <Input type="number" min={0} step={5} placeholder="150" className="pl-7"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => { setDiscountApplied(false); setLoyaltyAmount(0); setTenCount(0); setTwentyCount(0); field.onChange(e.target.value === "" ? undefined : Number(e.target.value)); }}
                          />
                        </div>
                      </FormControl>
                      <PriceDiscountButtons
                        value={field.value}
                        onApply={(p) => field.onChange(p)}
                        counts={{ ten: tenCount, twenty: twentyCount }}
                        onCountsChange={(c) => { setTenCount(c.ten); setTwentyCount(c.twenty); }}
                        loyaltyEligible={loyaltyEligible}
                        loyalty={{ applied: discountApplied, amount: loyaltyAmount }}
                        onLoyaltyChange={(l) => { setDiscountApplied(l.applied); setLoyaltyAmount(l.amount); }}
                      />
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              {/* Schedule + Assignment */}
              <Card className="shadow-md">
                <CardHeader className="pb-4 border-b">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="w-5 h-5" /> Schedule & Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <FormField control={form.control} name="scheduledDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="scheduledTime" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time</FormLabel>
                      <FormControl><Input type="time" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="frequency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="one_time">One Time</option>
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Biweekly</option>
                          <option value="monthly">Monthly</option>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {staff.length > 0 && (
                    <FormField control={form.control} name="staffId" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1"><Users className="w-4 h-4" /> Assigned Cleaner</FormLabel>
                        <FormControl>
                          <NativeSelect
                            value={field.value?.toString() ?? ""}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                          >
                            <option value="">— Unassigned —</option>
                            {staff.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </NativeSelect>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Notes */}
            <Card className="shadow-md">
              <CardHeader className="pb-4 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5" /> Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Any important notes about this booking…"
                        className="min-h-[100px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Save bar */}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={handleCancelEdit} disabled={updateBooking.isPending}>
                Discard Changes
              </Button>
              <Button type="submit" disabled={updateBooking.isPending} className="gap-2 min-w-[140px]">
                <Save className="w-4 h-4" />
                {updateBooking.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    );
  }

  // ── Read-only view ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto animate-in slide-in-from-bottom-4 duration-500 pb-10">
      
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <Button variant="ghost" onClick={() => window.history.back()} className="gap-2 -ml-4 hover:bg-transparent">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleEnterEdit} className="gap-2">
            <Edit3 className="w-4 h-4" /> Edit Booking
          </Button>
          <div className="flex items-center gap-2 bg-muted/50 p-1.5 rounded-lg border">
            <span className="text-sm font-medium text-muted-foreground px-2">Update Status:</span>
            <NativeSelect 
              value={booking.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={updateBooking.isPending}
              className="h-8 text-sm py-1 font-semibold bg-background border-none shadow-sm min-w-[140px]"
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </NativeSelect>
          </div>
          <Button variant="destructive" size="icon" onClick={handleDelete} title="Delete Booking">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
        
        <div className="space-y-6">
          {/* Main Info Card */}
          <Card className="shadow-lg border-t-4 border-t-primary overflow-hidden">
            <div className="bg-primary/5 p-6 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h1 className="text-3xl font-bold font-serif mb-2">{booking.firstName} {booking.lastName}</h1>
                <div className="flex flex-wrap gap-2 items-center">
                  <StatusBadge status={booking.status} className="text-sm px-3 py-1" />
                  <ServiceTypeBadge type={booking.serviceType} className="text-sm px-3 py-1" />
                </div>
              </div>
              <div className="text-right bg-background p-4 rounded-xl shadow-sm border text-center min-w-[120px]">
                <div className="text-sm text-muted-foreground font-medium mb-1 uppercase tracking-wider">Estimated</div>
                <div className="text-2xl font-black text-primary">{formatCurrency(booking.estimatedPrice)}</div>
              </div>
            </div>

            <CardContent className="p-0">
              <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x">
                {/* Contact */}
                <div className="p-6 space-y-4">
                  <h3 className="font-semibold flex items-center gap-2 text-muted-foreground uppercase text-xs tracking-wider"><User className="w-4 h-4" /> Contact Details</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="font-medium text-lg">{booking.phone}</div>
                        <div className="text-sm text-muted-foreground">Mobile</div>
                      </div>
                    </div>
                    {booking.email && (
                      <div className="flex items-start gap-3">
                        <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <div className="font-medium">{booking.email}</div>
                          <div className="text-sm text-muted-foreground">Email</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Location */}
                <div className="p-6 space-y-4 bg-muted/10">
                  <h3 className="font-semibold flex items-center gap-2 text-muted-foreground uppercase text-xs tracking-wider"><MapPin className="w-4 h-4" /> Location</h3>
                  <div className="flex items-start gap-3">
                    <div className="bg-background border shadow-sm p-3 rounded-lg w-full">
                      <div className="font-bold text-lg mb-1">{booking.address}</div>
                      <div className="text-muted-foreground">
                        {booking.city}, {booking.province} {booking.postalCode}
                      </div>
                    </div>
                  </div>
                  {booking.addressLat != null && booking.addressLng != null ? (
                    <BookingMiniMap
                      lat={booking.addressLat}
                      lng={booking.addressLng}
                      baseUrl={apiBaseUrl}
                    />
                  ) : resolvedCoords ? (
                    <BookingMiniMap
                      lat={resolvedCoords[0]}
                      lng={resolvedCoords[1]}
                      baseUrl={apiBaseUrl}
                    />
                  ) : booking.address && geocodePending ? (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                      <MapPin className="w-4 h-4 shrink-0 opacity-60 animate-pulse" />
                      <span>Locating address on the map…</span>
                    </div>
                  ) : booking.address ? (
                    <MissingCoordinatesHint mode="view" />
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes Card */}
          {booking.notes && (
            <Card className="bg-amber-50/50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-900/30 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-amber-800 dark:text-amber-500">
                  <FileText className="w-5 h-5" /> Important Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-amber-900/80 dark:text-amber-200 leading-relaxed font-medium">
                  {booking.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Call Transcript Card */}
          <Card className="shadow-sm border-purple-200 dark:border-purple-900/40">
            <CardHeader className="pb-3 bg-purple-50/60 dark:bg-purple-950/20 rounded-t-xl border-b border-purple-100 dark:border-purple-900/30">
              <CardTitle className="text-base flex items-center justify-between gap-2 text-purple-800 dark:text-purple-400">
                <button
                  type="button"
                  className="flex items-center gap-2 flex-1 text-left"
                  onClick={() => transcripts.length > 0 && setTranscriptOpen((v) => !v)}
                >
                  <Mic className="w-4 h-4" />
                  Call Notes
                  {transcripts.length > 0 && (
                    <span className="text-xs font-normal bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full">
                      {transcripts.length}
                    </span>
                  )}
                  {transcripts.length > 0 && (
                    transcriptOpen ? (
                      <ChevronUp className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    )
                  )}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-purple-700 border-purple-300 hover:bg-purple-100 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-900/30 h-7 px-2.5 text-xs"
                  onClick={() => setAddNoteOpen((v) => !v)}
                >
                  {addNoteOpen ? "Cancel" : "+ Add Note"}
                </Button>
              </CardTitle>
            </CardHeader>

            {addNoteOpen && (
              <CardContent className="pt-4 pb-4 border-b border-purple-100 dark:border-purple-900/30">
                <textarea
                  className="w-full rounded-lg border border-purple-200 dark:border-purple-800 bg-background p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 min-h-[100px]"
                  placeholder="Enter call notes or transcript…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  disabled={savingNote}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setAddNoteOpen(false); setNoteText(""); }}
                    disabled={savingNote}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveNote}
                    disabled={savingNote || !noteText.trim()}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {savingNote ? "Saving…" : "Save Note"}
                  </Button>
                </div>
              </CardContent>
            )}

            {transcripts.length > 0 && transcriptOpen && (
              <CardContent className="pt-4 space-y-3">
                {transcripts.map((t) => (
                  <div key={t.id}>
                    <div className="text-xs text-purple-500 dark:text-purple-400 mb-1">
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-mono bg-muted/40 rounded-lg p-4 border">
                      {t.transcript}
                    </p>
                  </div>
                ))}
              </CardContent>
            )}

            {transcripts.length === 0 && !addNoteOpen && (
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-muted-foreground text-center py-2">No call notes yet.</p>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="shadow-md">
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2"><Calendar className="w-5 h-5" /> Schedule</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              
              <div className="flex items-center gap-4 bg-primary/10 p-4 rounded-xl border border-primary/20">
                 <div className="bg-background rounded-md shadow-sm w-14 h-14 flex flex-col items-center justify-center font-serif flex-shrink-0">
                   <div className="text-xs font-bold text-primary uppercase bg-primary/10 w-full text-center py-0.5 rounded-t-md">{new Date(booking.scheduledDate).toLocaleDateString('en-US', { month: 'short' })}</div>
                   <div className="text-xl font-black">{new Date(booking.scheduledDate).getDate()}</div>
                 </div>
                 <div>
                   <div className="font-bold text-lg">{formatDate(booking.scheduledDate)}</div>
                   <div className="text-muted-foreground flex items-center gap-1.5"><Clock className="w-4 h-4" /> {formatTime(booking.scheduledTime)}</div>
                 </div>
              </div>

              <div className="flex justify-between items-center py-3 border-b">
                <span className="text-muted-foreground">Frequency</span>
                <span className="font-semibold capitalize bg-muted px-2.5 py-1 rounded-md text-sm">{booking.frequency.replace('_', ' ')}</span>
              </div>
              
              <div className="flex justify-between items-center py-2">
                <span className="text-muted-foreground">Created</span>
                <span className="text-sm font-medium">{new Date(booking.createdAt).toLocaleDateString()}</span>
              </div>

            </CardContent>
          </Card>

          {/* Price breakdown */}
          {(() => {
            const pb = (booking as any).priceBreakdown as {
              hours?: number; hourlyRate?: number; baseAmount?: number; manualPrice?: number;
              leadSource?: string | null; leadDiscount?: number;
              quickDiscountTens?: number; quickDiscountTwenties?: number;
              loyaltyDiscount?: number; fuelSurcharge?: number; total?: number;
            } | null | undefined;
            if (!pb) return null;
            const row = (label: React.ReactNode, amount: number, opts?: { discount?: boolean }) => (
              <div className="flex justify-between items-center py-1.5 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className={cn("font-semibold tabular-nums", opts?.discount && "text-green-700 dark:text-green-400")}>
                  {opts?.discount ? "−" : ""}{formatCurrency(Math.abs(amount))}
                </span>
              </div>
            );
            return (
              <Card className="shadow-md">
                <CardHeader className="bg-muted/30 border-b pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <DollarSign className="w-5 h-5" /> Price Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="divide-y">
                    {pb.hours != null && pb.hourlyRate != null && pb.baseAmount != null &&
                      row(<>Cleaning — {pb.hours} hr{pb.hours !== 1 ? "s" : ""} × {formatCurrency(pb.hourlyRate)}/hr</>, pb.baseAmount)}
                    {pb.manualPrice != null &&
                      row("Quoted price (entered manually)", pb.manualPrice)}
                    {pb.leadDiscount != null && pb.leadDiscount > 0 &&
                      row(<>Thank-you discount{pb.leadSource ? ` (${pb.leadSource})` : ""}</>, pb.leadDiscount, { discount: true })}
                    {!!pb.quickDiscountTens &&
                      row(<>Quick discount −$10{pb.quickDiscountTens > 1 ? ` ×${pb.quickDiscountTens}` : ""}</>, pb.quickDiscountTens * 10, { discount: true })}
                    {!!pb.quickDiscountTwenties &&
                      row(<>Quick discount −$20{pb.quickDiscountTwenties > 1 ? ` ×${pb.quickDiscountTwenties}` : ""}</>, pb.quickDiscountTwenties * 20, { discount: true })}
                    {pb.loyaltyDiscount != null && pb.loyaltyDiscount > 0 &&
                      row("Loyalty discount (10%)", pb.loyaltyDiscount, { discount: true })}
                    {pb.fuelSurcharge != null && pb.fuelSurcharge > 0 &&
                      row("Fuel surcharge", pb.fuelSurcharge)}
                    {pb.total != null && (
                      <div className="flex justify-between items-center pt-3 mt-1">
                        <span className="font-bold">Total quoted</span>
                        <span className="font-black text-primary text-lg tabular-nums">{formatCurrency(pb.total)}</span>
                      </div>
                    )}
                  </div>
                  {pb.leadSource && (
                    <p className="text-xs text-muted-foreground mt-3">Heard about us via {pb.leadSource}</p>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Jobber sync */}
          <JobberSyncCard
            bookingId={id}
            jobberJobId={jobberJobId ?? booking?.jobberJobId}
            jobberSyncStatus={
              (jobberSyncStatus ?? (booking as any)?.jobberSyncStatus) as JobberSyncStatus | null | undefined
            }
            jobberSyncError={jobberSyncError ?? (booking as any)?.jobberSyncError}
            onSynced={(jid) => {
              setJobberJobId(jid);
              setJobberSyncStatus("synced");
              setJobberSyncError(null);
            }}
            onStatusChange={(status, error) => {
              setJobberSyncStatus(status);
              setJobberSyncError(error ?? null);
            }}
            baseUrl={getBaseUrl()}
          />

          <Card className="shadow-md">
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2"><Home className="w-5 h-5" /> Property Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-background border p-3 rounded-lg text-center shadow-sm">
                  <div className="text-2xl font-black text-foreground">{booking.bedrooms}</div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold mt-1">Bedrooms</div>
                </div>
                <div className="bg-background border p-3 rounded-lg text-center shadow-sm">
                  <div className="text-2xl font-black text-foreground">{booking.bathrooms}</div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold mt-1">Bathrooms</div>
                </div>
              </div>

              {booking.extras && booking.extras.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Included Extras</h4>
                  <div className="flex flex-wrap gap-2">
                    {booking.extras.map((extra: string) => (
                      <span key={extra} className="bg-secondary/10 text-secondary border border-secondary/20 px-2.5 py-1 rounded-full text-xs font-bold">
                        {extra}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
