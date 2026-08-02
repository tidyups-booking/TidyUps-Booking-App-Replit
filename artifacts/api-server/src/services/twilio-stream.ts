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

// ── Whisper transcription ───────────────────────────────────────────────────

async function transcribeWav(wav: Buffer): Promise<string> {
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.replace(/\/$/, "");
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!base || !key) return "";

  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "call.wav");
  form.append("model", "whisper-1");
  form.append("language", "en");

  try {
    const res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Whisper transcription failed");
      return "";
    }
    const json = (await res.json()) as { text?: string };
    return json.text?.trim() ?? "";
  } catch (err) {
    logger.warn({ err }, "Whisper transcription error");
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
