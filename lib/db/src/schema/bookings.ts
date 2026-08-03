import {
  pgTable,
  serial,
  text,
  real,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffTable } from "./staff";

export const serviceTypeEnum = pgEnum("service_type", [
  "standard_clean",
  "deep_clean",
  "move_in_out", // legacy — kept for old rows; new bookings use move_in / move_out
  "move_in",
  "move_out",
  "post_construction",
]);

export const frequencyEnum = pgEnum("frequency", [
  "one_time",
  "weekly",
  "biweekly",
  "monthly",
]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
]);

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  province: text("province").notNull().default("AB"),
  postalCode: text("postal_code"),
  serviceType: serviceTypeEnum("service_type").notNull(),
  bedrooms: real("bedrooms").notNull().default(2),
  bathrooms: real("bathrooms").notNull().default(1),
  extras: text("extras").array().notNull().default([]),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  frequency: frequencyEnum("frequency").notNull().default("one_time"),
  estimatedPrice: real("estimated_price"),
  // Itemized quote breakdown (hours, rate, discounts, fuel surcharge)
  // recorded when a dispatcher creates the booking. Null for older bookings.
  priceBreakdown: jsonb("price_breakdown").$type<{
    hours?: number;
    hourlyRate?: number;
    baseAmount?: number;
    manualPrice?: number;
    leadSource?: string | null;
    leadDiscount?: number;
    quickDiscountTens?: number;
    quickDiscountTwenties?: number;
    loyaltyDiscount?: number;
    fuelSurcharge?: number;
    total?: number;
  } | null>(),
  notes: text("notes"),
  staffId: integer("staff_id").references(() => staffTable.id, {
    onDelete: "set null",
  }),
  status: bookingStatusEnum("status").notNull().default("pending"),
  addressLat: real("address_lat"),
  addressLng: real("address_lng"),
  // Stores the Jobber REQUEST ID returned by requestCreate (outbound booking sync).
  // Never used for calendar-sync job IDs — see jobberSyncedJobId below.
  jobberJobId: text("jobber_job_id"),
  jobberSyncStatus: text("jobber_sync_status")
    .notNull()
    .default("not_started"),
  jobberSyncError: text("jobber_sync_error"),
  // Stores the Jobber JOB ID imported by calendar sync (POST /jobber/sync-calendar).
  // Kept separate from jobberJobId to avoid identity collisions between Jobber
  // request IDs and Jobber job IDs, which are distinct namespaces.
  jobberSyncedJobId: text("jobber_synced_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  // Unique index on jobberSyncedJobId prevents duplicate calendar imports.
  // PostgreSQL allows multiple NULLs in a non-partial unique index.
  jobberSyncedJobIdUnique: uniqueIndex("bookings_jobber_synced_job_id_unique")
    .on(table.jobberSyncedJobId),
}));

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
