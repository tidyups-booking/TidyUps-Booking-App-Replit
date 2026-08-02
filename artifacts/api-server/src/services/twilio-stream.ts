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
import { logger } from "../lib/logger.js";
import { speechToText } from "@workspace/integrations-openai-ai-server/audio";

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
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.replace(/\/$/, "");
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!base || !key) return null;

  const today = new Date().toISOString().split("T")[0];

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 512,
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
  "serviceType": "standard_clean" | "deep_clean" | "move_in_out" | "post_construction",
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
- "moving", "move in", "move out" → move_in_out
- "construction", "renovation", "builder" → post_construction`,
          },
          {
            role: "user",
            content: `Extract booking info from this call transcript:\n\n${transcript}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Booking extraction failed");
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content || "{}";
    const fields = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(fields).length > 0 ? fields : null;
  } catch (err) {
    logger.warn({ err }, "Booking extraction error");
    return null;
  }
}

// ── Transcription (gpt-4o-mini-transcribe via Replit OpenAI proxy) ───────────

async function transcribeWav(wav: Buffer): Promise<string> {
  try {
    const text = await speechToText(wav, "wav");
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

function broadcast(event: object) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of sseClients) {
    try {
      c.res.write(line);
    } catch {
      sseClients.delete(c);
    }
  }
}

// ── Active call state (one call at a time) ──────────────────────────────────

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
  if (text) {
    fullTranscript = (fullTranscript + " " + text).trim();
    broadcast({ type: "transcript", chunk: text, full: fullTranscript });
    logger.info({ chars: text.length }, "Transcription chunk broadcast");

    // Run AI extraction and broadcast results — fire-and-forget so audio pipeline isn't blocked
    const transcriptSnapshot = fullTranscript;
    extractBookingFields(transcriptSnapshot)
      .then((fields) => {
        if (fields) {
          broadcast({ type: "extracted_fields", fields });
          logger.info({ fieldCount: Object.keys(fields).length }, "Extracted booking fields broadcast");
        }
      })
      .catch(() => {});
  }
}

export function getCallState() {
  return { active: activeCallSid !== null, transcript: fullTranscript };
}

// ── WebSocket server (attached to the HTTP server via `upgrade` event) ──────

export function createTwilioWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket) => {
    logger.info("Twilio Media Stream WebSocket connected");

    ws.on("message", async (rawMsg) => {
      try {
        const msg = JSON.parse(rawMsg.toString()) as {
          event: string;
          streamSid?: string;
          callSid?: string;
          media?: { payload: string; track?: string };
        };

        if (msg.event === "start") {
          activeCallSid = msg.callSid ?? msg.streamSid ?? "unknown";
          audioChunks = [];
          fullTranscript = "";
          broadcast({ type: "call_started" });
          logger.info({ callSid: activeCallSid }, "Twilio call started");
        } else if (msg.event === "media") {
          const payload = msg.media?.payload;
          if (!payload) return;
          const chunk = Buffer.from(payload, "base64");
          for (const b of chunk) audioChunks.push(b);
          await flushAudio();
        } else if (msg.event === "stop") {
          await flushAudio(true);
          broadcast({ type: "call_ended", full: fullTranscript });
          logger.info({ callSid: activeCallSid }, "Twilio call ended");
          activeCallSid = null;
        }
      } catch (err) {
        logger.warn({ err }, "Error processing Twilio WS message");
      }
    });

    ws.on("close", async () => {
      if (activeCallSid) {
        await flushAudio(true);
        broadcast({ type: "call_ended", full: fullTranscript });
        activeCallSid = null;
      }
      logger.info("Twilio Media Stream WebSocket disconnected");
    });

    ws.on("error", (err) => logger.warn({ err }, "Twilio WebSocket error"));
  });

  return wss;
}
