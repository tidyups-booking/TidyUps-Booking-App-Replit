import {
  useListStaff,
  useCreateStaff,
  useUpdateStaff,
  useListUnlinkedSignups,
  useConnectStaffAccount,
  getListUnlinkedSignupsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListStaffQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Users, Plus, Phone, Mail, Pencil, CheckCircle2, X, MapPin, AlertTriangle, Download, Upload, UserPlus, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Staff } from "@workspace/api-client-react";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useRef } from "react";
import { DispatcherAccess } from "@/components/dispatcher-access";

const ROLE_LABELS: Record<string, string> = {
  cleaner: "Cleaner",
  lead_cleaner: "Lead Cleaner",
  supervisor: "Supervisor",
};

function StaffCard({
  staff,
  onEdit,
}: {
  staff: Staff;
  onEdit: (staff: Staff) => void;
}) {
  const s = staff as any;
  const hasAddressNoCoords = s.homeAddress && s.homeLat == null;

  return (
    <Card
      className={cn(
        "shadow-sm transition-all",
        !staff.active && "opacity-60 border-dashed",
        hasAddressNoCoords && "border-yellow-400/60"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0",
              staff.active ? "brand-gradient" : "bg-muted text-muted-foreground"
            )}
          >
            {staff.name
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{staff.name}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge
                variant="outline"
                className="text-xs px-1.5 py-0"
              >
                {ROLE_LABELS[staff.role] ?? staff.role}
              </Badge>
              {!staff.active && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground border-muted">
                  Inactive
                </Badge>
              )}
              {hasAddressNoCoords && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="text-xs px-1.5 py-0 text-yellow-700 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400 cursor-default gap-1"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Not geocoded
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[220px] text-center">
                      Address saved but no coordinates — pin won't show on map. Edit and pick from the dropdown to fix.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {staff.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" />
                {staff.phone}
              </p>
            )}
            {s.email && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 min-w-0">
                <Mail className="w-3 h-3 shrink-0" />
                <span className="truncate">{s.email}</span>
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8"
            onClick={() => onEdit(staff)}
          >
            <Pencil className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface StaffFormData {
  name: string;
  role: string;
  phone: string;
  email: string;
  active: boolean;
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
}

const EMPTY_FORM: StaffFormData = {
  name: "",
  role: "cleaner",
  phone: "",
  email: "",
  active: true,
  homeAddress: "",
  homeLat: null,
  homeLng: null,
};

export default function StaffManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffFormData>(EMPTY_FORM);
  const [showInactive, setShowInactive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Always fetch all staff so we can show the inactive count without an extra request
  const { data: allStaffData = [], isLoading } = useListStaff({ activeOnly: false });

  const activeStaff = allStaffData.filter((s) => s.active);
  const inactiveStaff = allStaffData.filter((s) => !s.active);
  const inactiveCount = inactiveStaff.length;
  const displayStaff = showInactive ? allStaffData : activeStaff;

  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const connectAccount = useConnectStaffAccount();

  // Cleaner-app accounts waiting to be connected to a staff record
  const { data: waitingSignups = [] } = useListUnlinkedSignups();
  // Per-signup choice: staff id as string, or "new" to create a staff member
  const [signupChoice, setSignupChoice] = useState<Record<string, string>>({});
  // When creating a new staff member for a signup, connect after saving
  const [pendingClerkUserId, setPendingClerkUserId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const invalidateStaff = () => {
    queryClient.invalidateQueries({ queryKey: getListStaffQueryKey({ activeOnly: false }) });
    queryClient.invalidateQueries({ queryKey: getListStaffQueryKey({ activeOnly: true }) });
    queryClient.invalidateQueries({ queryKey: getListUnlinkedSignupsQueryKey() });
  };

  const unconnectedStaff = allStaffData.filter((s) => !(s as any).clerkUserId);

  const connectSignupTo = (clerkUserId: string, staffId: number, label: string) => {
    setConnectingId(clerkUserId);
    connectAccount.mutate(
      { id: staffId, data: { clerkUserId } },
      {
        onSuccess: () => {
          toast({
            title: "Account connected",
            description: `${label} can now open the cleaner app and see their schedule.`,
          });
          invalidateStaff();
          setConnectingId(null);
        },
        onError: (err: any) => {
          toast({
            title: "Couldn't connect account",
            description: err?.error ?? err?.message ?? "Please try again.",
            variant: "destructive",
          });
          invalidateStaff();
          setConnectingId(null);
        },
      }
    );
  };

  const handleSignupConnect = (signup: { clerkUserId: string; email: string; name?: string | null }) => {
    const choice = signupChoice[signup.clerkUserId] ?? "new";
    if (choice === "new") {
      // Open the create form prefilled; connect happens after saving
      setEditingStaff(null);
      setForm({ ...EMPTY_FORM, name: signup.name ?? "", email: signup.email });
      setPendingClerkUserId(signup.clerkUserId);
      setShowForm(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      const staffId = Number(choice);
      const target = allStaffData.find((s) => s.id === staffId);
      connectSignupTo(signup.clerkUserId, staffId, target?.name ?? signup.email);
    }
  };

  const handleExport = () => {
    const exportData = allStaffData.map((s) => ({
      name: s.name,
      role: s.role,
      phone: (s as any).phone ?? null,
      email: (s as any).email ?? null,
      active: s.active,
      homeAddress: (s as any).homeAddress ?? null,
      homeLat: (s as any).homeLat ?? null,
      homeLng: (s as any).homeLng ?? null,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `staff-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${exportData.length} staff records downloaded.` });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-imported if needed
    e.target.value = "";

    let records: unknown[];
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("File must contain a JSON array");
      records = parsed;
    } catch (err: any) {
      toast({ title: "Invalid file", description: err.message ?? "Could not parse JSON file.", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch("/api/staff/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `Server error ${res.status}`);
      }
      const result = await res.json() as { imported: number; created: number; updated: number };
      invalidateStaff();
      toast({
        title: "Import complete",
        description: `${result.imported} records processed — ${result.created} added, ${result.updated} updated.`,
      });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message ?? "Unknown error.", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const openCreate = () => {
    setEditingStaff(null);
    setForm(EMPTY_FORM);
    setPendingClerkUserId(null);
    setShowForm(true);
  };

  const openEdit = (staff: Staff) => {
    setEditingStaff(staff);
    setPendingClerkUserId(null);
    setForm({
      name: staff.name,
      role: staff.role,
      phone: staff.phone ?? "",
      email: (staff as any).email ?? "",
      active: staff.active,
      homeAddress: (staff as any).homeAddress ?? "",
      homeLat: (staff as any).homeLat ?? null,
      homeLng: (staff as any).homeLng ?? null,
    });
    setShowForm(true);
  };

  const handleSave = () => {
    const trimmedEmail = form.email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address, e.g. name@example.com.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      name: form.name.trim(),
      role: form.role as "cleaner" | "lead_cleaner" | "supervisor",
      phone: form.phone.trim() || undefined,
      active: form.active,
      homeAddress: form.homeAddress.trim() || undefined,
      homeLat: form.homeLat ?? undefined,
      homeLng: form.homeLng ?? undefined,
    };

    if (!payload.name) {
      toast({ title: "Name required", description: "Please enter the staff member's name.", variant: "destructive" });
      return;
    }

    // Warn if address typed but no coordinates selected from dropdown
    if (payload.homeAddress && !payload.homeLat) {
      toast({
        title: "Address not geocoded",
        description: "Pick an address from the autocomplete suggestions to save coordinates — otherwise this staff member won't appear as a pin on the map.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    if (editingStaff) {
      updateStaff.mutate(
        // Empty email on edit clears the saved value
        { id: editingStaff.id, data: { ...payload, email: trimmedEmail || null } as any },
        {
          onSuccess: () => {
            toast({ title: "Staff updated", description: `${payload.name} has been updated.` });
            invalidateStaff();
            setShowForm(false);
          },
          onError: () => {
            toast({ title: "Error", description: "Failed to update staff member.", variant: "destructive" });
          },
        }
      );
    } else {
      createStaff.mutate(
        { data: trimmedEmail ? { ...payload, email: trimmedEmail } : payload },
        {
          onSuccess: (created) => {
            toast({ title: "Staff added", description: `${payload.name} has been added to the team.` });
            setShowForm(false);
            // Created from a waiting signup — connect the account right away
            if (pendingClerkUserId) {
              connectSignupTo(pendingClerkUserId, created.id, payload.name);
              setPendingClerkUserId(null);
            } else {
              invalidateStaff();
            }
          },
          onError: () => {
            toast({ title: "Error", description: "Failed to add staff member.", variant: "destructive" });
          },
        }
      );
    }
  };

  const isSaving = createStaff.isPending || updateStaff.isPending;

  return (
    <div className="max-w-3xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">Staff</h1>
          <p className="text-muted-foreground">Manage your cleaning team.</p>
        </div>
        <div className="flex items-center gap-2">
          {allStaffData.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              title="Export all staff to JSON"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => importInputRef.current?.click()}
            isLoading={isImporting}
            title="Import staff from a previously exported JSON file"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button onClick={openCreate} className="brand-gradient text-white shadow-md shadow-primary/20">
            <Plus className="w-4 h-4 mr-2" />
            Add Staff
          </Button>
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <Card className="mb-6 border-primary/30 shadow-md">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {editingStaff ? `Edit ${editingStaff.name}` : "Add New Staff Member"}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowForm(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Full Name *</label>
                <Input
                  placeholder="e.g. Maria Torres"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Role</label>
                <NativeSelect
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="cleaner">Cleaner</option>
                  <option value="lead_cleaner">Lead Cleaner</option>
                  <option value="supervisor">Supervisor</option>
                </NativeSelect>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Phone <span className="text-muted-foreground font-normal">(Optional)</span></label>
                <Input
                  type="tel"
                  placeholder="(780) 555-1234"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Email <span className="text-muted-foreground font-normal">(Optional)</span></label>
                <Input
                  type="email"
                  placeholder="name@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {pendingClerkUserId
                    ? "This account will be connected as soon as you save."
                    : "They sign in to the cleaner app with this email — their account connects automatically."}
                </p>
              </div>
              {editingStaff && (
                <div className="flex items-center gap-3 pb-0.5">
                  <label className="text-sm font-medium">Status</label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, active: !form.active })}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
                      form.active ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200",
                        form.active ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                  <span className="text-sm text-muted-foreground">{form.active ? "Active" : "Inactive"}</span>
                </div>
              )}
            </div>
            {/* Home address for map */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                Home Address <span className="text-muted-foreground font-normal">(for map when off-duty)</span>
              </label>
              <AddressAutocomplete
                value={form.homeAddress}
                onChange={(v) => setForm({ ...form, homeAddress: v, homeLat: null, homeLng: null })}
                onPlaceSelect={(place) => {
                  const label = place.address && place.city
                    ? `${place.address}, ${place.city}`
                    : place.formattedAddress;
                  setForm((f) => ({
                    ...f,
                    homeAddress: label,
                    homeLat: place.lat,
                    homeLng: place.lng,
                  }));
                  toast({
                    title: "Address confirmed",
                    description: `Coordinates saved (${place.lat.toFixed(4)}, ${place.lng.toFixed(4)})`,
                  });
                }}
                placeholder="e.g. 456 Jasper Ave NW, Edmonton"
                className={cn(form.homeLat ? "border-green-400 bg-green-50 dark:bg-green-950/20" : "")}
              />
              {form.homeLat && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Coordinates saved — will appear on the map
                </p>
              )}
              {form.homeAddress && !form.homeLat && (
                <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1 font-medium">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Pick an address from the dropdown — typing won't save coordinates and the pin won't appear on the map.
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} isLoading={isSaving} className="flex-1 sm:flex-none">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {editingStaff ? "Save Changes" : "Add to Team"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1 sm:flex-none">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cleaner-app accounts waiting to be connected */}
      {waitingSignups.length > 0 && (
        <Card className="mb-6 border-yellow-400/50 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-yellow-600" />
              Waiting to connect
              <Badge variant="outline" className="text-xs px-1.5 py-0">{waitingSignups.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground font-normal">
              These people created a cleaner-app account but aren't connected to a staff member yet.
            </p>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {waitingSignups.map((signup) => (
              <div
                key={signup.clerkUserId}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{signup.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {signup.name ? `${signup.name} · ` : ""}
                    signed up {new Date(signup.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <NativeSelect
                    className="h-9 text-sm"
                    value={signupChoice[signup.clerkUserId] ?? "new"}
                    onChange={(e) =>
                      setSignupChoice({ ...signupChoice, [signup.clerkUserId]: e.target.value })
                    }
                  >
                    <option value="new">New staff member…</option>
                    {unconnectedStaff.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    onClick={() => handleSignupConnect(signup)}
                    isLoading={connectingId === signup.clerkUserId}
                  >
                    <Link2 className="w-4 h-4 mr-1.5" />
                    Connect
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Staff list */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-muted rounded" />
                    <div className="h-3 w-20 bg-muted rounded" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : displayStaff.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No staff yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add your first team member to get started.</p>
            <Button onClick={openCreate} className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Add First Staff Member
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {displayStaff.map((s) => (
              <StaffCard key={s.id} staff={s} onEdit={openEdit} />
            ))}
          </div>

          {/* Show inactive toggle */}
          {!showInactive && inactiveCount === 0 && allStaffData.length > 0 ? null : (
            <div className="mt-4 text-center">
              <button
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
                onClick={() => setShowInactive(!showInactive)}
              >
                {showInactive
                  ? "Hide inactive staff"
                  : `Show inactive staff`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Dispatcher access management */}
      <DispatcherAccess />
    </div>
  );
}
