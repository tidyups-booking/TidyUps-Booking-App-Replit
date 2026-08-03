// Simulates REAL Twilio <Stream> behavior against the dev server:
// - strips the query string from the wss URL (Twilio does this)
// - passes the token only via the start message's customParameters
// Also verifies an unauthenticated socket gets closed.
import crypto from "crypto";
import WebSocket from "ws";
import { pool as db } from "@workspace/db";

const secret = process.env.SESSION_SECRET!;
const domain = process.env.REPLIT_DEV_DOMAIN!;
const sig = crypto.createHmac("sha256", secret).update("twilio-webhook-auth-v1").digest("hex");
const fails: string[] = [];
const check = (name: string, ok: boolean, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${extra ? " — " + extra : ""}`) && (ok || fails.push(name));

// 1. Get TwiML
const res = await fetch(`https://${domain}/api/twilio/voice?sig=${sig}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "CallSid=TWILIO-SIM-CALL&From=%2B15550001111",
});
const twiml = await res.text();
const urlMatch = twiml.match(/url="(wss:[^"]+)"/);
const paramMatch = twiml.match(/<Parameter name="token" value="([^"]+)"/);
check("voice returns TwiML with wss url", res.status === 200 && !!urlMatch);
check("TwiML includes token <Parameter>", !!paramMatch);
if (!urlMatch || !paramMatch) process.exit(1);

// 2. Connect the way Twilio does: query string STRIPPED
const strippedUrl = urlMatch[1].split("?")[0];
const token = paramMatch[1];
const ws = new WebSocket(strippedUrl);
await new Promise<void>((ok, bad) => { ws.on("open", () => ok()); ws.on("error", bad); });
ws.send(JSON.stringify({
  event: "start", sequenceNumber: "1", streamSid: "MZSIM123",
  start: { callSid: "TWILIO-SIM-CALL", streamSid: "MZSIM123", customParameters: { token } },
}));
await new Promise((r) => setTimeout(r, 1500));
const during = await db.query("SELECT active_call_sid FROM live_call_state WHERE id=1");
check("call becomes active with real-Twilio start shape", during.rows[0]?.active_call_sid === "TWILIO-SIM-CALL",
  `sid=${during.rows[0]?.active_call_sid}`);

// 2b. Duplicate stream for the SAME CallSid (e.g. retried webhook) must be
// rejected while the first stream is live — and must not disturb it.
const resDup = await fetch(`https://${domain}/api/twilio/voice?sig=${sig}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "CallSid=TWILIO-SIM-CALL",
});
const dupToken = (await resDup.text()).match(/<Parameter name="token" value="([^"]+)"/)?.[1];
const dupWs = new WebSocket(strippedUrl);
await new Promise<void>((ok, bad) => { dupWs.on("open", () => ok()); dupWs.on("error", bad); });
dupWs.send(JSON.stringify({
  event: "start", streamSid: "MZDUP",
  start: { callSid: "TWILIO-SIM-CALL", streamSid: "MZDUP", customParameters: { token: dupToken } },
}));
const dupClosed = await new Promise<boolean>((r) => {
  const t = setTimeout(() => r(false), 4000);
  dupWs.on("close", () => { clearTimeout(t); r(true); });
});
check("duplicate same-CallSid stream is rejected while call is live", dupClosed);
const dupState = await db.query("SELECT active_call_sid FROM live_call_state WHERE id=1");
check("live call survives the duplicate stream", dupState.rows[0]?.active_call_sid === "TWILIO-SIM-CALL");

const silence = Buffer.alloc(1600, 0xff).toString("base64");
ws.send(JSON.stringify({ event: "media", media: { payload: silence, track: "inbound" } }));
ws.send(JSON.stringify({ event: "stop" }));
await new Promise((r) => setTimeout(r, 1500));
const after = await db.query("SELECT active_call_sid FROM live_call_state WHERE id=1");
check("call ends cleanly on stop", after.rows[0]?.active_call_sid === null);
ws.close();

// 3. Replay: the SAME token must be rejected on a second use
const replayWs = new WebSocket(strippedUrl);
await new Promise<void>((ok, bad) => { replayWs.on("open", () => ok()); replayWs.on("error", bad); });
replayWs.send(JSON.stringify({
  event: "start", streamSid: "MZREPLAY",
  start: { callSid: "REPLAY-CALL", streamSid: "MZREPLAY", customParameters: { token } },
}));
const replayClosed = await new Promise<boolean>((r) => {
  const t = setTimeout(() => r(false), 4000);
  replayWs.on("close", () => { clearTimeout(t); r(true); });
});
check("replayed token gets socket closed", replayClosed);
const replayState = await db.query("SELECT active_call_sid FROM live_call_state WHERE id=1");
check("replayed token does not activate a call", replayState.rows[0]?.active_call_sid !== "REPLAY-CALL");

// 4. Cross-instance ownership: while ANOTHER instance owns a live call
// (simulated via the shared DB lease), a second valid stream must back off
// and must NOT overwrite or end the live call.
await db.query("UPDATE live_call_state SET active_call_sid='OTHER-INSTANCE-CALL', transcript='in progress', updated_at=now() WHERE id=1");
const res2 = await fetch(`https://${domain}/api/twilio/voice?sig=${sig}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "CallSid=SECOND-CALL",
});
const token2 = (await res2.text()).match(/<Parameter name="token" value="([^"]+)"/)?.[1];
const ws2 = new WebSocket(strippedUrl);
await new Promise<void>((ok, bad) => { ws2.on("open", () => ok()); ws2.on("error", bad); });
ws2.send(JSON.stringify({
  event: "start", streamSid: "MZ2",
  start: { callSid: "SECOND-CALL", streamSid: "MZ2", customParameters: { token: token2 } },
}));
const ws2Closed = await new Promise<boolean>((r) => {
  const t = setTimeout(() => r(false), 4000);
  ws2.on("close", () => { clearTimeout(t); r(true); });
});
const leaseState = await db.query("SELECT active_call_sid, transcript FROM live_call_state WHERE id=1");
check("second stream backs off while another instance owns the call", ws2Closed);
check("live call is not overwritten by the second stream",
  leaseState.rows[0]?.active_call_sid === "OTHER-INSTANCE-CALL" && leaseState.rows[0]?.transcript === "in progress");
await db.query("UPDATE live_call_state SET active_call_sid=NULL, transcript='', updated_at=now() WHERE id=1");

// 5. Unauthenticated socket: start without token must be closed by server
const badWs = new WebSocket(strippedUrl);
await new Promise<void>((ok, bad) => { badWs.on("open", () => ok()); badWs.on("error", bad); });
badWs.send(JSON.stringify({ event: "start", streamSid: "MZBAD", start: { callSid: "BAD-CALL", customParameters: {} } }));
const closed = await new Promise<boolean>((r) => {
  const t = setTimeout(() => r(false), 4000);
  badWs.on("close", () => { clearTimeout(t); r(true); });
});
check("unauthenticated start gets socket closed", closed);
const badState = await db.query("SELECT active_call_sid FROM live_call_state WHERE id=1");
check("unauthenticated start does not activate a call", badState.rows[0]?.active_call_sid !== "BAD-CALL");

// 6. Per-IP provisional flood: a single source holding many tokenless sockets
// must hit the per-IP cap — the excess connection is closed immediately.
const flood: WebSocket[] = [];
for (let i = 0; i < 5; i++) {
  const w = new WebSocket(strippedUrl);
  w.on("error", () => {});
  await new Promise<void>((ok) => { w.on("open", () => ok()); w.on("close", () => ok()); });
  flood.push(w);
}
const extra = new WebSocket(strippedUrl);
extra.on("error", () => {});
const extraClosedFast = await new Promise<boolean>((r) => {
  const t = setTimeout(() => r(false), 2000);
  extra.on("close", () => { clearTimeout(t); r(true); });
});
check("per-IP cap closes excess unauthenticated sockets immediately", extraClosedFast);
for (const w of flood) w.close();

db.end?.();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
