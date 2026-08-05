import { describe, it, expect } from "vitest";
import { buildCustomerPrefill } from "./customer-prefill";
import type { CustomerRecord } from "@/components/customer-autocomplete";

// Full record as returned by GET /api/bookings/customers/search
const fullCustomer: CustomerRecord = {
  bookingCount: 12,
  firstName: "Loyalta",
  lastName: "Zqxrepeat",
  phone: "780-555-1234",
  email: "loyalta@example.com",
  address: "999 Latest Address Blvd NW",
  city: "St. Albert",
  province: "AB",
  postalCode: "T8N 1A1",
  addressLat: 53.63,
  addressLng: -113.63,
  bedrooms: 4,
  bathrooms: 3,
  serviceType: "deep_clean",
  frequency: "weekly",
  lastBookingDate: "2026-08-01",
};

function toMap(entries: { field: string; value: unknown }[]) {
  return new Map(entries.map((e) => [e.field, e.value]));
}

describe("buildCustomerPrefill", () => {
  it("maps every field from a full suggestion onto the form", () => {
    const { entries, highlighted } = buildCustomerPrefill(fullCustomer);
    const m = toMap(entries);
    expect(m.get("firstName")).toBe("Loyalta");
    expect(m.get("lastName")).toBe("Zqxrepeat");
    expect(m.get("phone")).toBe("780-555-1234");
    expect(m.get("email")).toBe("loyalta@example.com");
    expect(m.get("address")).toBe("999 Latest Address Blvd NW");
    expect(m.get("city")).toBe("St. Albert");
    expect(m.get("province")).toBe("AB");
    expect(m.get("postalCode")).toBe("T8N 1A1");
    expect(m.get("addressLat")).toBe(53.63);
    expect(m.get("addressLng")).toBe(-113.63);
    expect(m.get("bedrooms")).toBe(4);
    expect(m.get("bathrooms")).toBe(3);
    expect(m.get("serviceType")).toBe("deep_clean");
    expect(m.get("frequency")).toBe("weekly");
    // every form field the API can pre-fill is flagged for the green flash
    for (const f of ["firstName", "lastName", "phone", "email", "address", "city", "province", "postalCode", "bedrooms", "bathrooms", "serviceType", "frequency"]) {
      expect(highlighted).toContain(f);
    }
  });

  it("handles null/optional fields (no email, no coords, no postal code) without writing them", () => {
    const sparse: CustomerRecord = {
      ...fullCustomer,
      email: null,
      postalCode: null,
      addressLat: null,
      addressLng: null,
    };
    const { entries } = buildCustomerPrefill(sparse);
    const m = toMap(entries);
    // Optional fields must be skipped, not written as null/undefined
    expect(m.has("email")).toBe(false);
    expect(m.has("postalCode")).toBe(false);
    expect(m.has("addressLat")).toBe(false);
    expect(m.has("addressLng")).toBe(false);
    // ...while required fields still land
    expect(m.get("firstName")).toBe("Loyalta");
    expect(m.get("address")).toBe("999 Latest Address Blvd NW");
    expect(m.get("bedrooms")).toBe(4);
  });

  it("defaults blank province to AB and skips legacy/unknown service types and frequencies", () => {
    const legacy: CustomerRecord = {
      ...fullCustomer,
      province: "",
      serviceType: "move_in_out",
      frequency: "every_leap_year",
    };
    const m = toMap(buildCustomerPrefill(legacy).entries);
    expect(m.get("province")).toBe("AB");
    expect(m.has("serviceType")).toBe(false);
    expect(m.has("frequency")).toBe(false);
  });

  it("validates the user-typed identity/address fields on fill", () => {
    const byField = new Map(buildCustomerPrefill(fullCustomer).entries.map((e) => [e.field, e.validate]));
    for (const f of ["firstName", "lastName", "phone", "address", "city"]) {
      expect(byField.get(f), f).toBe(true);
    }
  });
});
