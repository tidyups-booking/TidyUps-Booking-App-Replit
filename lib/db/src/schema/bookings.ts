import {
  pgTable,
  serial,
  text,
  real,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffTable } from "./staff";

export const serviceTypeEnum = pgEnum("service_type", [
  "standard_clean",
  "deep_clean",
  "move_in_out",
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
  notes: text("notes"),
  staffId: integer("staff_id").references(() => staffTable.id, {
    onDelete: "set null",
  }),
  status: bookingStatusEnum("status").notNull().default("pending"),
  jobberJobId: text("jobber_job_id"),
  jobberSyncStatus: text("jobber_sync_status")
    .notNull()
    .default("not_started"),
  jobberSyncError: text("jobber_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
