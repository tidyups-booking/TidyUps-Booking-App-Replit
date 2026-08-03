// Synthetic end-to-end live-call test against PRODUCTION.
// Mimics exactly what Twilio does: POST /voice with sig → parse TwiML → open WS
// → send start/media/stop. Never prints the sig or token.
import crypto from "crypto";
import WebSocket from "ws";

const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET missing");
const sig = crypto.createHmac("sha256", secret).update("twilio-webhook-auth-v1").digest("hex");

const res = await fetch(`https://bookcleaning.app/api/twilio/voice?sig=${sig}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "CallSid=SYNTHETIC-TEST-CALL&From=%2B15550001111&To=%2B18255334317",
});
console.log("voice POST status:", res.status);
const twiml = await res.text();
const m = twiml.match(/url="(wss:[^"]+)"/);
if (!m) { console.log("NO wss URL in TwiML:", twiml.slice(0, 300)); process.exit(1); }
const wsUrl = m[1];
console.log("TwiML ok, wss host:", new URL(wsUrl.replace("wss:", "https:")).host);

const ws = new WebSocket(wsUrl);
ws.on("open", () => {
  console.log("WS OPEN — sending start event");
  ws.send(JSON.stringify({ event: "start", callSid: "SYNTHETIC-TEST-CALL", streamSid: "SYNTH-STREAM" }));
  // ~1s of mulaw silence (0xFF) split into a few media frames
  const silence = Buffer.alloc(1600, 0xff).toString("base64");
  let i = 0;
  const iv = setInterval(() => {
    ws.send(JSON.stringify({ event: "media", media: { payload: silence, track: "inbound_track" } }));
    if (++i >= 5) clearInterval(iv);
  }, 400);
  setTimeout(() => {
    console.log("sending stop event");
    ws.send(JSON.stringify({ event: "stop" }));
    setTimeout(() => { ws.close(); console.log("DONE"); process.exit(0); }, 1500);
  }, 12000);
});
ws.on("unexpected-response", (_q, r) => { console.log("WS REJECTED, HTTP", r.statusCode); process.exit(1); });
ws.on("error", (e) => { console.log("WS ERROR:", e.message); process.exit(1); });
