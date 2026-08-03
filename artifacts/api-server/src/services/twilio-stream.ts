/**
 * Twilio Media Streams — live call audio → Whisper → SSE transcript
 *
 * Flow:
 *  1. Twilio POSTs to /api/twilio/voice → TwiML starts a <Stream> WebSocket
 *  2. This WebSocket handler receives raw mulaw audio chunks in real time
 *  3. Every ~2 s of audio is decoded to PCM, wrapped in WAV, sent to Whisper
 *  4. Transcription is broadcast to all connected SSE clients
 *  5. The browser Live Call Panel reads the SSE stream and auto-fills the form
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { Response } from "express";
import { pool } from "@workspace/db";

// Minimal structural type for a dedicated pg client (avoids a direct dep on "pg").
interface PoolClient {
  query(sql: string): Promise<unknown>;
  on(event: "notification", cb: (msg: { channel: string; payload?: string }) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  release(destroy?: boolean): void;
}
import { logger } from "../lib/logger.js";
import { consumeStreamToken } from "./stream-tokens.js";
import { speechToText } from "@workspace/integrations-openai-ai-server/audio";
import { openai } from "@workspace/integrations-openai-ai-server";

// ── G.711 u-law decode ──────────────────────────────────────────────────────

function mulawDecode(ulaw: number): number {
  ulaw = ~ulaw & 0xff;
  const sign = ulaw & 0x80;
  const exponent = (ulaw >> 4) & 0x07;
  const mantissa = ulaw & 0x0f;
  const magnitude = ((mantissa | 0x10) << (exponent + 3)) - 132;
  return sign ? -magnitude : magnitude;
}

function mulawToPcm(mulaw: Buffer): Int16Array {
  const pcm = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    const s = mulawDecode(mulaw[i]);
    pcm[i] = Math.max(-32768, Math.min(32767, s));
  }
  return pcm;
}

function buildWav(pcm: Int16Array, sampleRate = 8000): Buffer {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);   // fmt chunk size
  buf.writeUInt16LE(1, 20);    // PCM
  buf.writeUInt16LE(1, 22);    // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);    // block align
  buf.writeUInt16LE(16, 34);   // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

// ── GPT booking-field extraction ────────────────────────────────────────────

async function extractBookingFields(transcript: string): Promise<Record<string, unknown> | null> {
  const today = new Date().toISOString().split("T")[0];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are a booking assistant for 833 Tidyups, an Edmonton home cleaning service.
Extract booking information from a phone call transcript and return a JSON object.
Only include fields you are confident about from what was said. Do not guess or invent details.
Today's date is ${today}.

Return ONLY a valid JSON object with these optional fields (omit any field not clearly mentioned):
{
  "firstName": string,
  "lastName": string,
  "phone": string (Canadian format e.g. 780-555-1234),
  "email": string,
  "address": string (street address only, no city),
  "city": string (default "Edmonton" if the caller is local and city not mentioned),
  "postalCode": string,
  "serviceType": "standard_clean" | "deep_clean" | "move_in" | "move_out" | "post_construction",
  "bedrooms": number (integer),
  "bathrooms": number (can be 0.5 increments),
  "scheduledDate": string (YYYY-MM-DD, interpret relative dates like "next Tuesday" using today's date),
  "scheduledTime": string (HH:MM 24h format, e.g. "09:00"),
  "frequency": "one_time" | "weekly" | "biweekly" | "monthly",
  "notes": string (anything special: entry instructions, pets, parking, etc.),
  "extras": array of strings from: ["Oven","Fridge","Windows","Laundry","Garage","Basement","Inside Cabinets"]
}

Service type clues:
- "standard" or "regular" → standard_clean
- "deep" or "thorough" → deep_clean
- "moving in", "move in" → move_in
- "moving out", "move out" → move_out
- "construction", "renovation", "builder" → post_construction`,
        },
        {
          role: "user",
          content: `Extract booking info from this call transcript:\n\n${transcript}`,
        },
      ],
    });

    const raw = response.choices?.[0]?.message?.content || "{}";
    // Strip markdown code fences if the model wrapped the JSON
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const fields = JSON.parse(cleaned) as Record<string, unknown>;
    return Object.keys(fields).length > 0 ? fields : null;
  } catch (err) {
    logger.warn({ err }, "Booking extraction error");
    return null;
  }
}

// ── Transcription (gpt-4o-mini-transcribe via Replit OpenAI proxy) ───────────

async function transcribeWav(wav: Buffer): Promise<string> {
  try {
    // Language pinned to English: all callers are English-speaking (Canada),
    // and without the pin the model occasionally mis-detects the language on
    // noisy phone audio and emits garbled non-English text.
    const text = await speechToText(wav, "wav", { language: "en" });
    return text.trim();
  } catch (err) {
    logger.warn({ err }, "Transcription error");
    return "";
  }
}

// ── SSE client registry ─────────────────────────────────────────────────────

interface SseClient {
  id: string;
  res: Response;
}

const sseClients = new Set<SseClient>();

export function addSseClient(client: SseClient) {
  sseClients.add(client);
}

export function removeSseClient(client: SseClient) {
  sseClients.delete(client);
}

/** Fan an event out to SSE clients connected to THIS instance. */
function fanOutLocal(event: object) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of sseClients) {
    try {
      c.res.write(line);
    } catch {
      sseClients.delete(c);
    }
  }
}

// ── Cross-instance pub/sub via Postgres LISTEN/NOTIFY ───────────────────────
//
// The production deployment is autoscale: the Twilio webhook/WebSocket and a
// dispatcher's SSE connection may land on DIFFERENT instances. Call state is
// therefore persisted in the single-row `live_call_state` table, and events
// are published with NOTIFY so every instance fans them out to its own SSE
// clients. The publishing instance does NOT fan out directly — it receives
// its own NOTIFY like everyone else, so delivery is uniform.

const NOTIFY_CHANNEL = "live_call_events";
// Postgres NOTIFY payloads are capped at ~8000 bytes; leave headroom.
const MAX_NOTIFY_PAYLOAD = 7000;

/** Persist call state, then publish the event to all instances. */
async function publish(event: Record<string, unknown>) {
  try {
    let payload = JSON.stringify(event);
    if (payload.length > MAX_NOTIFY_PAYLOAD) {
      // Too large for NOTIFY — drop bulky fields; listeners re-hydrate `full`
      // from live_call_state when it's missing.
      const { full: _full, chunk: _chunk, ...slim } = event;
      payload = JSON.stringify({ ...slim, needsHydration: true });
    }
    await pool.query("SELECT pg_notify($1, $2)", [NOTIFY_CHANNEL, payload]);
  } catch (err) {
    logger.error({ err, type: event.type }, "Failed to publish live-call event");
    // Fall back to local fan-out so at least same-instance clients see it.
    fanOutLocal(event);
  }
}

// ── Distributed call lease ──────────────────────────────────────────────────
// The single live_call_state row doubles as a cross-instance lease: claiming,
// transcript writes, and release are all CONDITIONAL updates keyed on the
// call SID, so a stream on one autoscale instance can never overwrite or end
// a live call owned by another instance.

/** Atomically claim the shared call slot. STRICT: succeeds only when the slot
 *  is free or stale (an instance died without releasing it). A duplicate
 *  stream for the SAME CallSid (e.g. a retried webhook) is rejected too —
 *  exactly one stream may own the slot at a time. */
async function claimCall(sid: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE live_call_state
        SET active_call_sid = $1, transcript = '', updated_at = now()
      WHERE id = 1
        AND (active_call_sid IS NULL
             OR updated_at < now() - interval '60 minutes')`,
    [sid],
  );
  return (rowCount ?? 0) > 0;
}

/** Persist the transcript only while this call still owns the slot. */
async function persistTranscript(sid: string, transcript: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE live_call_state SET transcript = $2, updated_at = now()
      WHERE id = 1 AND active_call_sid = $1`,
    [sid, transcript],
  );
  if ((rowCount ?? 0) === 0) {
    logger.warn({ sid }, "Live-call lease lost — transcript update skipped");
  }
}

/** Conditionally release the slot; returns false if another call owns it. */
async function releaseCall(sid: string, transcript: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE live_call_state SET active_call_sid = NULL, transcript = $2, updated_at = now()
      WHERE id = 1 AND active_call_sid = $1`,
    [sid, transcript],
  );
  return (rowCount ?? 0) > 0;
}

/** Read the shared call state (works regardless of which instance owns the call). */
export async function getCallState(): Promise<{ active: boolean; transcript: string }> {
  try {
    const { rows } = await pool.query(
      `SELECT active_call_sid, transcript FROM live_call_state WHERE id = 1`,
    );
    const row = rows[0];
    return {
      active: !!row?.active_call_sid,
      transcript: row?.transcript ?? "",
    };
  } catch (err) {
    logger.warn({ err }, "Failed to read live call state");
    return { active: false, transcript: "" };
  }
}

let listenerClient: PoolClient | null = null;
let listenerStopped = false;

/**
 * Start (and keep alive) the dedicated LISTEN connection that receives
 * live-call events published by any instance and fans them out to this
 * instance's SSE clients. Reconnects with backoff on connection loss.
 */
export function startLiveCallListener() {
  listenerStopped = false;
  void connectListener(0);
}

async function connectListener(attempt: number) {
  if (listenerStopped) return;
  try {
    const client = await pool.connect();
    listenerClient = client;

    client.on("notification", (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
      void handleNotification(msg.payload);
    });

    client.on("error", (err) => {
      logger.warn({ err }, "Live-call LISTEN connection error — reconnecting");
      scheduleReconnect(client);
    });

    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    logger.info("Live-call event listener connected (LISTEN live_call_events)");
  } catch (err) {
    logger.warn({ err, attempt }, "Failed to start live-call listener — retrying");
    setTimeout(() => void connectListener(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
  }
}

function scheduleReconnect(client: PoolClient) {
  if (listenerClient !== client) return; // already replaced
  listenerClient = null;
  try {
    client.release(true); // destroy the broken connection
  } catch {
    /* already released */
  }
  setTimeout(() => void connectListener(0), 1000);
}

async function handleNotification(payload: string) {
  try {
    const event = JSON.parse(payload) as Record<string, unknown> & { needsHydration?: boolean };
    if (event.needsHydration) {
      delete event.needsHydration;
      const state = await getCallState();
      if (event.type === "transcript" || event.type === "call_ended") {
        event.full = state.transcript;
      }
    }
    fanOutLocal(event);
  } catch (err) {
    logger.warn({ err }, "Failed to handle live-call notification");
  }
}

// ── Active call state (one call at a time) ──────────────────────────────────
// Audio buffering stays local: the Twilio WebSocket is pinned to one instance
// for the duration of the call. Only the derived state (active SID, running
// transcript) is shared via Postgres.

let activeCallSid: string | null = null;
let audioChunks: number[] = [];
let fullTranscript = "";

const FLUSH_BYTES = 8000 * 2; // 2 s of mulaw @ 8 kHz

async function flushAudio(force = false) {
  if (audioChunks.length < (force ? 800 : FLUSH_BYTES)) return;
  const raw = Buffer.from(audioChunks.splice(0, force ? audioChunks.length : FLUSH_BYTES));
  const pcm = mulawToPcm(raw);
  const wav = buildWav(pcm);
  const text = await transcribeWav(wav);
  if (text && activeCallSid) {
    fullTranscript = (fullTranscript + " " + text).trim();
    try {
      await persistTranscript(activeCallSid, fullTranscript);
    } catch (err) {
      logger.warn({ err }, "Failed to persist live call transcript");
    }
    await publish({ type: "transcript", chunk: text, full: fullTranscript });
    logger.info({ chars: text.length }, "Transcription chunk broadcast");

    // Run AI extraction and broadcast results — fire-and-forget so audio pipeline isn't blocked
    const transcriptSnapshot = fullTranscript;
    extractBookingFields(transcriptSnapshot)
      .then((fields) => {
        if (fields) {
          void publish({ type: "extracted_fields", fields });
          logger.info({ fieldCount: Object.keys(fields).length }, "Extracted booking fields broadcast");
        } else {
          logger.debug("Extraction returned no fields for this chunk");
        }
      })
      .catch((err) => logger.warn({ err }, "Extraction promise rejected"));
  }
}

/** Mark the call over: release the shared slot and publish call_ended.
 *  If the lease was lost (another instance's call owns the slot), skip the
 *  publish so we never end someone else's live call. */
async function endCall() {
  const sid = activeCallSid;
  activeCallSid = null;
  if (!sid) return;
  let released = false;
  try {
    released = await releaseCall(sid, fullTranscript);
  } catch (err) {
    logger.warn({ err }, "Failed to persist call end");
  }
  if (released) {
    await publish({ type: "call_ended", full: fullTranscript });
  } else {
    logger.warn({ sid }, "Call slot owned by another call — call_ended not published");
  }
}

// ── WebSocket server (attached to the HTTP server via `upgrade` event) ──────

// Twilio sends its "start" frame immediately after connecting, so a short
// window is plenty — and it shrinks how long anonymous sockets can squat.
const AUTH_TIMEOUT_MS = 5_000;
// Caps on concurrent unauthenticated (provisional) sockets: a global ceiling
// protects instance resources, and a small per-IP cap stops a single source
// from monopolizing the provisional pool and starving real Twilio streams
// (Twilio connects from many media IPs; abusers typically come from few).
const MAX_PENDING_SOCKETS = 50;
const MAX_PENDING_PER_IP = 5;
// Twilio start/media frames are well under 1 KB; anything huge is abuse.
const MAX_WS_PAYLOAD = 64 * 1024;

let pendingSockets = 0;
const pendingPerIp = new Map<string, number>();
// The single socket that owns the active call. Only this socket may mutate
// or end the shared call state — a stray/duplicate connection closing must
// never kill a live call.
let ownerSocket: WebSocket | null = null;

export function createTwilioWss() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

  wss.on("connection", (ws: WebSocket, req?: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }, auth?: { preauthed?: boolean }) => {
    // Query-token clients (e2e/synthetic) arrive pre-authenticated. Real Twilio
    // strips query strings from <Stream> URLs, so it must authenticate via the
    // "token" customParameter in its "start" message.
    let authenticated = auth?.preauthed === true;

    const fwd = req?.headers?.["x-forwarded-for"];
    const ip =
      (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() ||
      req?.socket?.remoteAddress ||
      "unknown";

    if (!authenticated) {
      const perIp = pendingPerIp.get(ip) ?? 0;
      if (pendingSockets >= MAX_PENDING_SOCKETS || perIp >= MAX_PENDING_PER_IP) {
        logger.warn({ ip, pendingSockets, perIp }, "Rejecting Twilio WS: pending unauthenticated socket limit");
        ws.close(1013, "try again later");
        return;
      }
      pendingSockets++;
      pendingPerIp.set(ip, perIp + 1);
    }
    let countedPending = !authenticated;
    const settlePending = () => {
      if (countedPending) {
        countedPending = false;
        pendingSockets--;
        const n = (pendingPerIp.get(ip) ?? 1) - 1;
        if (n <= 0) pendingPerIp.delete(ip);
        else pendingPerIp.set(ip, n);
      }
    };

    logger.info({ preauthed: authenticated }, "Twilio Media Stream WebSocket connected");

    const authTimer = authenticated
      ? null
      : setTimeout(() => {
          if (!authenticated) {
            logger.warn("Closing Twilio WS: no authenticated start message within timeout");
            ws.close(1008, "unauthorized");
          }
        }, AUTH_TIMEOUT_MS);

    ws.on("message", async (rawMsg) => {
      try {
        const msg = JSON.parse(rawMsg.toString()) as {
          event: string;
          streamSid?: string;
          callSid?: string;
          start?: {
            callSid?: string;
            streamSid?: string;
            customParameters?: Record<string, string>;
          };
          media?: { payload: string; track?: string };
        };

        if (msg.event === "start") {
          if (!authenticated) {
            const paramToken = msg.start?.customParameters?.token;
            if (!(await consumeStreamToken(paramToken))) {
              logger.warn("Twilio WS rejected: invalid or missing stream token (start customParameters)");
              ws.close(1008, "unauthorized");
              return;
            }
            authenticated = true;
            settlePending();
          }
          if (authTimer) clearTimeout(authTimer);

          // One call at a time — same instance fast path.
          if (ownerSocket && ownerSocket !== ws && ownerSocket.readyState === ownerSocket.OPEN) {
            logger.warn("Second concurrent Twilio stream rejected — a call is already active");
            ws.close(1013, "call in progress");
            return;
          }

          // Cross-instance guard: atomically claim the shared call slot in the
          // DB. If another autoscale instance owns a live call, back off.
          const sid = msg.start?.callSid ?? msg.callSid ?? msg.streamSid ?? "unknown";
          if (ownerSocket === ws && activeCallSid === sid) {
            // Duplicate start frame on our own live stream — idempotent no-op.
            return;
          }
          let claimed = false;
          try {
            claimed = await claimCall(sid);
          } catch (err) {
            logger.warn({ err }, "Failed to claim call slot");
          }
          if (!claimed) {
            logger.warn({ sid }, "Concurrent Twilio stream rejected — call slot owned by another instance");
            ws.close(1013, "call in progress");
            return;
          }

          ownerSocket = ws;
          activeCallSid = sid;
          audioChunks = [];
          fullTranscript = "";
          await publish({ type: "call_started" });
          logger.info({ callSid: activeCallSid }, "Twilio call started");
        } else if (!authenticated) {
          // Ignore anything else from unauthenticated sockets.
          return;
        } else if (msg.event === "media") {
          if (ownerSocket !== ws) return;
          const payload = msg.media?.payload;
          if (!payload) return;
          const chunk = Buffer.from(payload, "base64");
          for (const b of chunk) audioChunks.push(b);
          await flushAudio();
        } else if (msg.event === "stop") {
          if (ownerSocket !== ws) return;
          ownerSocket = null;
          await flushAudio(true);
          await endCall();
          logger.info("Twilio call ended");
        }
      } catch (err) {
        logger.warn({ err }, "Error processing Twilio WS message");
      }
    });

    ws.on("close", async () => {
      if (authTimer) clearTimeout(authTimer);
      settlePending();
      if (ownerSocket === ws) {
        ownerSocket = null;
        if (activeCallSid) {
          await flushAudio(true);
          await endCall();
        }
      }
      logger.info("Twilio Media Stream WebSocket disconnected");
    });

    ws.on("error", (err) => logger.warn({ err }, "Twilio WebSocket error"));
  });

  return wss;
}
