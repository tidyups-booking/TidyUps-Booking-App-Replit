import {
  pgTable,
  serial,
  text,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Homeowner pins — dispatcher-saved locations shown on the Live Map.
 * Added via address search or by dropping a pin directly on the map;
 * used to see distances between a home and each cleaner.
 */
export const homeownerPinsTable = pgTable("homeowner_pins", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type HomeownerPin = typeof homeownerPinsTable.$inferSelect;
