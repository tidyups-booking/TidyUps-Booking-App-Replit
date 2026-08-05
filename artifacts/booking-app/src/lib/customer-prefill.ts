import type { CustomerRecord } from "@/components/customer-autocomplete";

// Maps a returning-customer suggestion (GET /api/bookings/customers/search)
// onto New Booking form values. Kept as a pure function so the mapping can be
// unit-tested — a typo here would silently drop a pre-fill field.

export interface PrefillEntry {
  field: string;
  value: unknown;
  /** whether form.setValue should run validation for this field */
  validate: boolean;
}

const SERVICE_TYPES = ["standard_clean", "deep_clean", "move_in", "move_out", "post_construction"];
const FREQUENCIES = ["one_time", "weekly", "biweekly", "monthly"];

export function buildCustomerPrefill(c: CustomerRecord): {
  entries: PrefillEntry[];
  /** fields to flash green after the fill */
  highlighted: string[];
} {
  const entries: PrefillEntry[] = [
    { field: "firstName", value: c.firstName, validate: true },
    { field: "lastName", value: c.lastName, validate: true },
    { field: "phone", value: c.phone, validate: true },
  ];
  if (c.email) entries.push({ field: "email", value: c.email, validate: false });
  entries.push(
    { field: "address", value: c.address, validate: true },
    { field: "city", value: c.city, validate: true },
    { field: "province", value: c.province || "AB", validate: false },
  );
  if (c.postalCode) entries.push({ field: "postalCode", value: c.postalCode, validate: false });
  if (c.addressLat != null && c.addressLng != null) {
    entries.push(
      { field: "addressLat", value: c.addressLat, validate: false },
      { field: "addressLng", value: c.addressLng, validate: false },
    );
  }
  entries.push(
    { field: "bedrooms", value: c.bedrooms, validate: false },
    { field: "bathrooms", value: c.bathrooms, validate: false },
  );
  // Legacy service types (e.g. move_in_out) are no longer offered on new bookings
  if (c.serviceType && SERVICE_TYPES.includes(c.serviceType)) {
    entries.push({ field: "serviceType", value: c.serviceType, validate: false });
  }
  if (c.frequency && FREQUENCIES.includes(c.frequency)) {
    entries.push({ field: "frequency", value: c.frequency, validate: false });
  }

  return {
    entries,
    highlighted: ["firstName", "lastName", "phone", "email", "address", "city", "province", "postalCode", "bedrooms", "bathrooms", "serviceType", "frequency"],
  };
}
