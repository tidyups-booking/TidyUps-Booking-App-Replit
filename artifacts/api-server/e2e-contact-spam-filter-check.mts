/**
 * End-to-end regression check for the public contact form spam filter
 * (routes/contact.ts): per-IP rate limiting + hidden honeypot field.
 *
 * Verifies against the running dev server:
 *   - a legit submission returns 201 and a row is inserted
 *   - the 6th submission within the 10-minute window from the same IP → 429
 *     (submissions 1–5 succeed)
 *   - a different IP is NOT affected by another IP's rate limit
 *   - a honeypot-filled submission returns a fake 201 but inserts NO row
 *
 * The server sets `trust proxy`, so each scenario uses a unique
 * X-Forwarded-For address — the checks never pollute a real visitor's
 * rate-limit bucket and repeated runs don't collide with each other.
 *
 * Cleanup: every row this script inserts (tagged with a unique run marker in
 * the message) is deleted in `finally`.
 *
 * Requirements: dev API server running on port 8080.
 * Run: npx tsx e2e-contact-spam-filter-check.mts  (from artifacts/api-server)
 */
import { like } from "drizzle-orm";
import { db, contactMessagesTable } from "@workspace/db";

const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";

// Unique marker so we can find and delete exactly the rows we created,
// and unique fake IPs so reruns never hit a still-warm rate-limit bucket.
const RUN_ID = `contact-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const MARKER = `[${RUN_ID}]`;
const ipOctet = () => 1 + Math.floor(Math.random() * 250);
const IP_A = `10.${ipOctet()}.${ipOctet()}.${ipOctet()}`; // rate-limit scenario
const IP_B = `10.${ipOctet()}.${ipOctet()}.${ipOctet()}`; // unaffected bystander
const IP_C = `10.${ipOctet()}.${ipOctet()}.${ipOctet()}`; // honeypot scenario

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function submit(
  ip: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_BASE}/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function legitBody(label: string): Record<string, unknown> {
  return {
    name: "Contact E2E Check",
    email: "contact-e2e@example.com",
    message: `${MARKER} ${label} — automated spam-filter regression check`,
  };
}

async function countRows(): Promise<number> {
  const rows = await db
    .select({ id: contactMessagesTable.id })
    .from(contactMessagesTable)
    .where(like(contactMessagesTable.message, `%${MARKER}%`));
  return rows.length;
}

try {
  // Sanity: server reachable and honoring X-Forwarded-For
  // 1. Legit submission succeeds and persists.
  const first = await submit(IP_A, legitBody("legit #1"));
  check("legit submission returns 201", first.status === 201, `status=${first.status}`);
  check(
    "legit submission persisted a row",
    (await countRows()) === 1,
    "expected exactly 1 marked row",
  );
  check(
    "response echoes a real row id",
    typeof first.json?.id === "number" && first.json.id > 0,
    `id=${first.json?.id}`,
  );

  // 2. Submissions 2–5 from the same IP still succeed.
  for (let i = 2; i <= 5; i++) {
    const res = await submit(IP_A, legitBody(`legit #${i}`));
    check(`submission #${i} from same IP returns 201`, res.status === 201, `status=${res.status}`);
  }

  // 3. The 6th within the window is rejected with a clear 429.
  const sixth = await submit(IP_A, legitBody("legit #6 (should be blocked)"));
  check("6th submission from same IP returns 429", sixth.status === 429, `status=${sixth.status}`);
  check(
    "429 body carries a human-readable error",
    typeof sixth.json?.error === "string" && sixth.json.error.length > 0,
    JSON.stringify(sixth.json),
  );
  check(
    "rate-limited submission was NOT persisted",
    (await countRows()) === 5,
    "expected exactly 5 marked rows",
  );

  // 4. A different IP is not affected by IP_A's rate limit.
  const bystander = await submit(IP_B, legitBody("bystander"));
  check(
    "different IP still gets 201 while another IP is rate-limited",
    bystander.status === 201,
    `status=${bystander.status}`,
  );

  // 5. Honeypot: filled "website" field → fake 201, no row inserted.
  const before = await countRows();
  const bot = await submit(IP_C, {
    ...legitBody("honeypot bot"),
    website: "https://spam.example.com",
  });
  check("honeypot submission gets a fake 201", bot.status === 201, `status=${bot.status}`);
  check(
    "honeypot response looks like success (id present)",
    bot.json != null && "id" in bot.json,
    JSON.stringify(bot.json),
  );
  check(
    "honeypot submission inserted NO row",
    (await countRows()) === before,
    `rows before=${before}, after=${await countRows()}`,
  );
} finally {
  const deleted = await db
    .delete(contactMessagesTable)
    .where(like(contactMessagesTable.message, `%${MARKER}%`))
    .returning({ id: contactMessagesTable.id });
  console.log(`Cleanup: removed ${deleted.length} test row(s)`);
  check("all test rows cleaned up", (await countRows()) === 0);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
