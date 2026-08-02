import React, { useState } from "react";
import { useListStaff, useCreateStaff, useUpdateStaff } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListStaffQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Users, Plus, Phone, Pencil, CheckCircle2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Staff } from "@workspace/api-client-react";

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
  return (
    <Card
      className={cn(
        "shadow-sm transition-all",
        !staff.active && "opacity-60 border-dashed"
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
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{staff.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
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
            </div>
            {staff.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" />
                {staff.phone}
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
  active: boolean;
}

const EMPTY_FORM: StaffFormData = {
  name: "",
  role: "cleaner",
  phone: "",
  active: true,
};

export default function StaffManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffFormData>(EMPTY_FORM);
  const [showInactive, setShowInactive] = useState(false);

  // Always fetch all staff so we can show the inactive count without an extra request
  const { data: allStaffData = [], isLoading } = useListStaff({ activeOnly: false });

  const activeStaff = allStaffData.filter((s) => s.active);
  const inactiveStaff = allStaffData.filter((s) => !s.active);
  const inactiveCount = inactiveStaff.length;
  const displayStaff = showInactive ? allStaffData : activeStaff;

  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();

  const invalidateStaff = () => {
    queryClient.invalidateQueries({ queryKey: getListStaffQueryKey({ activeOnly: false }) });
    queryClient.invalidateQueries({ queryKey: getListStaffQueryKey({ activeOnly: true }) });
  };

  const openCreate = () => {
    setEditingStaff(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (staff: Staff) => {
    setEditingStaff(staff);
    setForm({
      name: staff.name,
      role: staff.role,
      phone: staff.phone ?? "",
      active: staff.active,
    });
    setShowForm(true);
  };

  const handleSave = () => {
    const payload = {
      name: form.name.trim(),
      role: form.role as "cleaner" | "lead_cleaner" | "supervisor",
      phone: form.phone.trim() || undefined,
      active: form.active,
    };

    if (!payload.name) {
      toast({ title: "Name required", description: "Please enter the staff member's name.", variant: "destructive" });
      return;
    }

    if (editingStaff) {
      updateStaff.mutate(
        { id: editingStaff.id, data: payload },
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
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: "Staff added", description: `${payload.name} has been added to the team.` });
            invalidateStaff();
            setShowForm(false);
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight brand-gradient-text">Staff</h1>
          <p className="text-muted-foreground">Manage your cleaning team.</p>
        </div>
        <Button onClick={openCreate} className="brand-gradient text-white shadow-md shadow-primary/20">
          <Plus className="w-4 h-4 mr-2" />
          Add Staff
        </Button>
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
    </div>
  );
}
