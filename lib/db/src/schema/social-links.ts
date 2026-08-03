import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";

/**
 * Social media links shown in the site footer.
 * Managed by dispatchers from the Settings page. Links with an empty URL
 * are hidden from the public footer but stay editable in Settings.
 */
export const socialLinksTable = pgTable("social_links", {
  id: serial("id").primaryKey(),
  /** Machine key used to pick the icon, e.g. "facebook", "tiktok". */
  platform: text("platform").notNull(),
  /** Display name, e.g. "Facebook". */
  label: text("label").notNull(),
  url: text("url").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type SocialLinkRow = typeof socialLinksTable.$inferSelect;
