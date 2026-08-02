import {
  pgTable,
  serial,
  integer,
  doublePrecision,
  real,
  timestamp,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";

export const cleanerLocationsTable = pgTable("cleaner_locations", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staffTable.id, { onDelete: "cascade" })
    .unique(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracy: real("accuracy"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CleanerLocation = typeof cleanerLocationsTable.$inferSelect;
