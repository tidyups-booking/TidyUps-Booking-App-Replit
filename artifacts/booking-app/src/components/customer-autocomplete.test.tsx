// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CustomerAutocomplete, type CustomerRecord } from "./customer-autocomplete";

const customer: CustomerRecord = {
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

function mockFetchWith(customers: CustomerRecord[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ customers }),
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CustomerAutocomplete", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function typeAndOpen(onSelectCustomer: (c: CustomerRecord) => void) {
    render(
      <CustomerAutocomplete
        value="Loy"
        onChange={() => {}}
        onSelectCustomer={onSelectCustomer}
        baseUrl="/"
        placeholder="Jane"
      />,
    );
    const input = screen.getByPlaceholderText("Jane");
    fireEvent.focus(input);
    // fire the debounced search
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.getByText("Returning customers")).toBeTruthy());
    return input;
  }

  it("shows the suggestion with a booking-count loyalty badge", async () => {
    mockFetchWith([customer]);
    await typeAndOpen(() => {});
    expect(screen.getByText("Loyalta Zqxrepeat · 780-555-1234")).toBeTruthy();
    expect(screen.getByText("999 Latest Address Blvd NW, St. Albert")).toBeTruthy();
    const badge = screen.getByTestId("booking-count-badge");
    expect(badge.textContent).toBe("12 bookings");
  });

  it("hands the FULL customer record to onSelectCustomer on click", async () => {
    mockFetchWith([customer]);
    const onSelect = vi.fn();
    await typeAndOpen(onSelect);
    fireEvent.mouseDown(screen.getByText("Loyalta Zqxrepeat · 780-555-1234"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Every field the API returns must survive the click untouched —
    // this is the record the New Booking form pre-fills from.
    expect(onSelect).toHaveBeenCalledWith(customer);
  });

  it("renders suggestions with null optional fields and omits the badge when count is missing", async () => {
    const sparse: CustomerRecord = {
      ...customer,
      bookingCount: undefined,
      email: null,
      postalCode: null,
      addressLat: null,
      addressLng: null,
    };
    mockFetchWith([sparse]);
    const onSelect = vi.fn();
    await typeAndOpen(onSelect);
    expect(screen.queryByTestId("booking-count-badge")).toBeNull();
    fireEvent.mouseDown(screen.getByText("Loyalta Zqxrepeat · 780-555-1234"));
    expect(onSelect).toHaveBeenCalledWith(sparse);
  });
});
