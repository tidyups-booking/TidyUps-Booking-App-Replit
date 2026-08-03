import { pgTable, text, bigserial, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Per-IP throttle ledger for the public contact form rate limiter.
 * One row per accepted submission attempt; rows older than the rate-limit
 * window are pruned opportunistically.
 */
export const contactFormThrottleTable = pgTable(
  "contact_form_throttle",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("contact_form_throttle_ip_submitted_at_idx").on(t.ip, t.submittedAt)],
);
