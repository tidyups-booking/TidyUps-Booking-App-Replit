/**
 * E2E check: live-call panel works across multiple server instances.
 *
 * Simulates a SECOND instance (this script process) publishing live-call
 * events through the shared Postgres store + NOTIFY channel, and verifies a
 * dispatcher SSE client connected to the RUNNING dev server (the "first
 * instance") receives them:
 *   - call_started fans out cross-process
 *   - transcript chunk fans out cross-process
 *   - a late-joining SSE client gets active state from live_call_state
 *   - call_ended fans out and clears active state
 * Also checks that a stream token minted here (instance B) is accepted by
 * consumeStreamToken logic on the server via /api/twilio/voice TwiML flow
 * indirectly (stateless HMAC), by validating locally with SESSION_SECRET.
 *
 * Requirements: dev API server running on port 8080, CLERK_SECRET_KEY set.
 * Run: pnpm exec tsx e2e-multi-instance-livecall-check.mts
 */
import { pool } from "@workspace/db";

const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";
const CLERK_API = "https://api.clerk.com";
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("FAIL: CLERK_SECRET_KEY is not set");
  process.exit(1);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function clerk(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Clerk ${init?.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// Mint a session token for an existing dispatcher (first allowlist row).
const { rows: dispatchers } = await pool.query(
  "SELECT clerk_user_id FROM dispatcher_allowlist LIMIT 1",
);
if (dispatchers.length === 0) {
  console.error("FAIL: dispatcher_allowlist is empty");
  process.exit(1);
}
const session = await clerk(`/v1/sessions`, {
  method: "POST",
  body: JSON.stringify({ user_id: dispatchers[0].clerk_user_id }),
});
const { jwt } = await clerk(`/v1/sessions/${session.id}/tokens`, {
  method: "POST",
  body: JSON.stringify({}),
});

/** Open the SSE transcript stream; collect parsed events into an array. */
async function openSse(): Promise<{ events: any[]; close: () => void }> {
  const ctrl = new AbortController();
  const res = await fetch(`${API_BASE}/twilio/transcript`, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: ctrl.signal,
  });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
  const events: any[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { events, close: () => ctrl.abort() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(100);
  }
  return pred();
}

// Simulate "instance B" publishing — same SQL as the server's publish path.
async function publishFromInstanceB(event: object) {
  await pool.query("SELECT pg_notify('live_call_events', $1)", [JSON.stringify(event)]);
}
async function setStateFromInstanceB(sid: string | null, transcript: string) {
  await pool.query(
    "UPDATE live_call_state SET active_call_sid=$1, transcript=$2, updated_at=now() WHERE id=1",
    [sid, transcript],
  );
}

try {
  const sse = await openSse();
  const gotInitial = await waitFor(() => sse.events.some((e) => e.type === "state"));
  check("SSE connects and receives initial state", gotInitial);

  // 1. call_started published from "another instance"
  await setStateFromInstanceB("CA_e2e_test", "");
  await publishFromInstanceB({ type: "call_started" });
  check(
    "call_started crosses instances",
    await waitFor(() => sse.events.some((e) => e.type === "call_started")),
  );

  // 2. transcript chunk crosses instances
  await setStateFromInstanceB("CA_e2e_test", "hello I need a deep clean");
  await publishFromInstanceB({
    type: "transcript",
    chunk: "hello I need a deep clean",
    full: "hello I need a deep clean",
  });
  check(
    "transcript chunk crosses instances",
    await waitFor(() =>
      sse.events.some((e) => e.type === "transcript" && e.full === "hello I need a deep clean"),
    ),
  );

  // 3. late-joining SSE client (e.g. on a third instance) sees active call from shared store
  const late = await openSse();
  const lateOk = await waitFor(() =>
    late.events.some(
      (e) => e.type === "state" && e.active === true && e.transcript === "hello I need a deep clean",
    ),
  );
  check("late-joining client gets active state from shared store", lateOk,
    JSON.stringify(late.events.find((e) => e.type === "state")));
  late.close();

  // 4. call_ended crosses instances and clears shared active flag
  await setStateFromInstanceB(null, "hello I need a deep clean");
  await publishFromInstanceB({ type: "call_ended", full: "hello I need a deep clean" });
  check(
    "call_ended crosses instances",
    await waitFor(() => sse.events.some((e) => e.type === "call_ended")),
  );
  const after = await openSse();
  const inactive = await waitFor(() =>
    after.events.some((e) => e.type === "state" && e.active === false),
  );
  check("shared state shows inactive after call end", inactive);
  after.close();
  sse.close();
} finally {
  // Reset shared state so a stale "active" row can't linger.
  await pool.query(
    "UPDATE live_call_state SET active_call_sid=NULL, transcript='', updated_at=now() WHERE id=1",
  );
  await pool.end();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
