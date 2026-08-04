/**
 * End-to-end regression check for dispatcher invite emails
 * (routes/dispatchers.ts: sendInviteEmail / attachClerkInvitation /
 * revokeInviteEmail lifecycle).
 *
 * Exercises against the REAL Clerk backend API (dev instance, +clerk_test
 * email so no real mail is delivered) and the RUNNING dev API server:
 *   1. Helper level: send returns a pending Clerk invitation id; revoke
 *      marks it "revoked"; failures return false instead of throwing
 *   2. HTTP lifecycle: POST /api/dispatchers/invites stores the Clerk
 *      invitation id on the invite row; DELETE /api/dispatchers/invites/:id
 *      revokes the emailed link in Clerk
 *   3. Race: an invite deleted while the Clerk call is in flight (simulated
 *      by deleting the row before attachClerkInvitation runs) must cause the
 *      fresh Clerk invitation to be revoked, never left as a live orphan
 *
 * Requirements: dev API server on port 8080, CLERK_SECRET_KEY set, at least
 * one dispatcher in dispatcher_allowlist.
 * Run: npx tsx e2e-invite-email-check.mts  (from artifacts/api-server)
 */
import { eq, sql } from "drizzle-orm";
import { db, dispatcherAllowlistTable, dispatcherInvitesTable } from "@workspace/db";
import { clerkClient } from "@clerk/express";
import {
  sendInviteEmail,
  revokeInviteEmail,
  attachClerkInvitation,
} from "./src/routes/dispatchers.js";

const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080/api";
const CLERK_API = "https://api.clerk.com";
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("FAIL: CLERK_SECRET_KEY is not set");
  process.exit(1);
}

const HELPER_EMAIL = "invite-email-e2e+clerk_test@example.com";
const HTTP_EMAIL = "invite-email-http-e2e+clerk_test@example.com";
const RACE_EMAIL = "invite-email-race-e2e+clerk_test@example.com";
const ALL_EMAILS = [HELPER_EMAIL, HTTP_EMAIL, RACE_EMAIL];

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function clerkApi(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Clerk ${init?.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** Mint a fresh session JWT for a user via the Clerk backend API. */
async function mintToken(userId: string): Promise<string> {
  const session = await clerkApi(`/v1/sessions`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
  const token = await clerkApi(`/v1/sessions/${session.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return token.jwt;
}

async function api(method: string, path: string, jwt: string, body?: unknown) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function invitationStatus(invitationId: string): Promise<string | null> {
  for (const status of ["pending", "revoked", "accepted"] as const) {
    const { data } = await clerkClient.invitations.getInvitationList({ status });
    const found = data.find((i) => i.id === invitationId);
    if (found) return found.status;
  }
  return null;
}

async function cleanup() {
  // Remove test invite rows and revoke stray pending Clerk invitations.
  await db
    .delete(dispatcherInvitesTable)
    .where(sql`${dispatcherInvitesTable.email} = ANY(${sql.param(ALL_EMAILS)}::text[])`);
  const { data } = await clerkClient.invitations.getInvitationList({ status: "pending" });
  for (const inv of data.filter((i) => ALL_EMAILS.includes(i.emailAddress))) {
    await clerkClient.invitations.revokeInvitation(inv.id).catch(() => {});
  }
}

await cleanup();

try {
  // 1. Helper level -------------------------------------------------------
  console.log("1. Helper send/revoke:");
  const sent = await sendInviteEmail(HELPER_EMAIL);
  check("send succeeds", sent.sent === true);
  check(
    "returns a Clerk invitation id",
    typeof sent.invitationId === "string" && sent.invitationId.startsWith("inv_"),
    String(sent.invitationId),
  );
  if (sent.invitationId) {
    check(
      "invitation is pending in Clerk",
      (await invitationStatus(sent.invitationId)) === "pending",
    );
    const revoked = await revokeInviteEmail(sent.invitationId);
    check("revoke succeeds", revoked === true);
    check(
      "invitation is revoked in Clerk",
      (await invitationStatus(sent.invitationId)) === "revoked",
    );
  }

  console.log("\n2. Failures are non-fatal:");
  const bad = await sendInviteEmail("not-a-valid-email");
  check("send failure returns sent=false, no id", bad.sent === false && bad.invitationId === null);
  const badRevoke = await revokeInviteEmail("inv_nonexistent_0000");
  check("revoke failure returns false (does not throw)", badRevoke === false);

  // 3. HTTP lifecycle: POST → row has id → DELETE → Clerk revoked ----------
  console.log("\n3. HTTP POST/DELETE lifecycle:");
  const [admin] = await db.select().from(dispatcherAllowlistTable).limit(1);
  if (!admin) {
    check("a dispatcher exists to act as admin", false);
  } else {
    const jwt = await mintToken(admin.clerkUserId);
    const post = await api("POST", "/dispatchers/invites", jwt, {
      name: "Invite Email E2E",
      email: HTTP_EMAIL,
    });
    const postBody: any = await post.json().catch(() => null);
    check("POST /dispatchers/invites → 201", post.status === 201, `status=${post.status}`);
    check("POST reports emailSent=true", postBody?.emailSent === true);
    const [row] = await db
      .select()
      .from(dispatcherInvitesTable)
      .where(eq(dispatcherInvitesTable.email, HTTP_EMAIL));
    check(
      "invite row stores the Clerk invitation id",
      typeof row?.clerkInvitationId === "string" && row.clerkInvitationId.startsWith("inv_"),
      String(row?.clerkInvitationId),
    );
    if (row?.clerkInvitationId) {
      check(
        "invitation is pending in Clerk after POST",
        (await invitationStatus(row.clerkInvitationId)) === "pending",
      );
      const del = await api("DELETE", `/dispatchers/invites/${row.id}`, jwt);
      const delBody: any = await del.json().catch(() => null);
      check("DELETE invite → 200", del.status === 200, `status=${del.status}`);
      check("DELETE reports emailRevoked=true", delBody?.emailRevoked === true);
      check(
        "invitation is revoked in Clerk after DELETE (link cannot be accepted)",
        (await invitationStatus(row.clerkInvitationId)) === "revoked",
      );
    }
  }

  // 4. Race: invite deleted before the Clerk id could be attached ----------
  console.log("\n4. Deletion racing the Clerk call leaves no live orphan link:");
  const [raceInvite] = await db
    .insert(dispatcherInvitesTable)
    .values({ email: RACE_EMAIL, name: "Race E2E" })
    .returning();
  const raceSent = await sendInviteEmail(RACE_EMAIL);
  check("race: invitation created", raceSent.invitationId !== null);
  // Simulate a concurrent DELETE landing while the Clerk call was in flight:
  await db.delete(dispatcherInvitesTable).where(eq(dispatcherInvitesTable.id, raceInvite.id));
  if (raceSent.invitationId) {
    const attached = await attachClerkInvitation(raceInvite.id, raceSent.invitationId);
    check("race: attach reports failure (row gone)", attached === false);
    check(
      "race: orphaned invitation was revoked, not left live",
      (await invitationStatus(raceSent.invitationId)) === "revoked",
    );
  }
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
