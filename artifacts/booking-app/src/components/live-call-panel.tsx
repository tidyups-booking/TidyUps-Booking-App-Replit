import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Sparkles, ChevronDown, ChevronUp, X,
  Radio, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

interface ExtractedFields {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  serviceType?: string;
  bedrooms?: number;
  bathrooms?: number;
  scheduledDate?: string;
  scheduledTime?: string;
  frequency?: string;
  notes?: string;
  extras?: string[];
}

interface LiveCallPanelProps {
  onFieldsExtracted: (fields: ExtractedFields, newKeys: string[]) => void;
  baseUrl: string;
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  postalCode: "Postal code",
  serviceType: "Service type",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  scheduledDate: "Date",
  scheduledTime: "Time",
  frequency: "Frequency",
  notes: "Notes",
  extras: "Extras",
};

type Mode = "mic" | "phone";
type CallStatus = "idle" | "active" | "ended";

export function LiveCallPanel({ onFieldsExtracted, baseUrl }: LiveCallPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("phone");
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [lastExtracted, setLastExtracted] = useState<ExtractedFields>({});
  const [filledCount, setFilledCount] = useState(0);
  const [micSupported, setMicSupported] = useState(true);

  // Phone / Twilio mode
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [copied, setCopied] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webhookUrl = `${window.location.origin}/api/twilio/voice`;

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setMicSupported(!!SR);
  }, []);

  // ── Extraction ──────────────────────────────────────────────────────────────

  const extractFromTranscript = useCallback(
    async (text: string) => {
      if (text.trim().length < 5) return;
      setIsExtracting(true);
      try {
        const resp = await fetch(`${baseUrl}api/ai/extract-booking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
        if (!resp.ok) return;
        const fields: ExtractedFields = await resp.json();

        const newKeys = Object.keys(fields).filter((k) => {
          const prev = (lastExtracted as any)[k];
          const curr = (fields as any)[k];
          if (Array.isArray(curr)) return curr.length > 0 && JSON.stringify(curr) !== JSON.stringify(prev);
          return curr !== undefined && curr !== "" && curr !== prev;
        });

        if (newKeys.length > 0) {
          setLastExtracted(fields);
          setFilledCount((n) => n + newKeys.length);
          onFieldsExtracted(fields, newKeys);
        }
      } catch {
        // silently ignore
      } finally {
        setIsExtracting(false);
      }
    },
    [lastExtracted, onFieldsExtracted, baseUrl],
  );

  useEffect(() => {
    if (!transcript.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => extractFromTranscript(transcript), 1400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [transcript, extractFromTranscript]);

  // ── SSE connection for Twilio mode ──────────────────────────────────────────

  const connectSse = useCallback(() => {
    if (sseRef.current) return; // already connected
    const es = new EventSource(`${baseUrl}api/twilio/transcript`);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          chunk?: string;
          full?: string;
          active?: boolean;
          transcript?: string;
        };

        if (msg.type === "state") {
          if (msg.active) {
            setCallStatus("active");
            if (msg.transcript) setTranscript(msg.transcript);
          }
        } else if (msg.type === "call_started") {
          setCallStatus("active");
          setTranscript("");
          setLastExtracted({});
          setFilledCount(0);
        } else if (msg.type === "transcript") {
          if (msg.full) setTranscript(msg.full);
        } else if (msg.type === "call_ended") {
          setCallStatus("ended");
          if (msg.full) setTranscript(msg.full);
        }
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect; just log silently
    };

    sseRef.current = es;
  }, [baseUrl]);

  const disconnectSse = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;
  }, []);

  // Connect SSE when panel is open in phone mode
  useEffect(() => {
    if (isOpen && mode === "phone") {
      connectSse();
    } else {
      disconnectSse();
    }
    return disconnectSse;
  }, [isOpen, mode, connectSse, disconnectSse]);

  // ── Mic mode ────────────────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-CA";

    let finalSoFar = transcript;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalSoFar += (finalSoFar ? " " : "") + event.results[i][0].transcript.trim();
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(finalSoFar + (interim ? " " + interim : ""));
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [transcript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const handleClear = () => {
    stopListening();
    setTranscript("");
    setLastExtracted({});
    setFilledCount(0);
    setCallStatus("idle");
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const filledFieldLabels = Object.keys(lastExtracted)
    .filter((k) => {
      const v = (lastExtracted as any)[k];
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
    })
    .map((k) => FIELD_LABELS[k] ?? k);

  const isPhoneActive = mode === "phone" && callStatus === "active";
  const isPulsing = isListening || isPhoneActive;

  return (
    <div
      className={cn(
        "rounded-2xl border-2 transition-all duration-300 overflow-hidden",
        isOpen
          ? "border-pink-400/60 bg-gradient-to-br from-pink-50/80 to-purple-50/80 dark:from-pink-950/30 dark:to-purple-950/30 shadow-lg shadow-pink-500/10"
          : "border-dashed border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10",
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
      >
        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
            isPulsing
              ? "bg-pink-500 shadow-lg shadow-pink-500/40 animate-pulse"
              : isOpen ? "bg-primary/15" : "bg-primary/10",
          )}
        >
          <Phone className={cn("w-4 h-4", isPulsing ? "text-white" : "text-primary")} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Live Call Mode
            {filledCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                <Sparkles className="w-3 h-3" />
                {filledCount} field{filledCount !== 1 ? "s" : ""} filled
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {isPhoneActive
              ? "Call in progress — transcribing…"
              : isListening
              ? "Listening… speak naturally"
              : isOpen
              ? mode === "phone" ? "Waiting for Twilio call…" : "Type what you hear, or tap the mic"
              : "Tap to open — AI fills the form as calls come in"}
          </p>
        </div>

        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="px-5 pb-5 space-y-4">
          {/* Mode switcher */}
          <div className="flex rounded-xl border border-border bg-muted/40 p-1 gap-1">
            <button
              type="button"
              onClick={() => setMode("phone")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all",
                mode === "phone"
                  ? "bg-white dark:bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Radio className="w-3.5 h-3.5" />
              Twilio Phone Call
            </button>
            <button
              type="button"
              onClick={() => setMode("mic")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all",
                mode === "mic"
                  ? "bg-white dark:bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Mic className="w-3.5 h-3.5" />
              Computer Mic
            </button>
          </div>

          {/* ── Phone mode ── */}
          {mode === "phone" && (
            <div className="space-y-3">
              {/* Call status badge */}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-2.5 h-2.5 rounded-full flex-shrink-0",
                    callStatus === "active" ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30",
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {callStatus === "idle" && "No call in progress — waiting for forwarded call"}
                  {callStatus === "active" && "Call active — transcribing in real time"}
                  {callStatus === "ended" && "Call ended — transcript below"}
                </span>
              </div>

              {/* Webhook URL */}
              {callStatus === "idle" && (
                <div className="rounded-xl bg-muted/60 px-4 py-3 space-y-1.5">
                  <p className="text-xs font-semibold text-foreground">Twilio webhook URL</p>
                  <p className="text-xs text-muted-foreground">
                    In your Twilio console → Phone Numbers → your number → set "A call comes in" to:
                  </p>
                  <div className="flex items-center gap-2 bg-background rounded-lg border px-3 py-2">
                    <code className="text-xs text-primary flex-1 break-all">{webhookUrl}</code>
                    <button
                      type="button"
                      onClick={copyWebhook}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    Forward your business phone to your Twilio number, then calls will transcribe here automatically.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Transcript area (shared by both modes) */}
          <div className="relative">
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={
                mode === "phone"
                  ? "Transcript will appear here as the caller speaks…"
                  : "Start typing what the customer says, or tap the mic…\n\ne.g. 'Hi my name is Sarah, I'm at 142 Oak Street, I'd like a deep clean next Friday at 10am'"
              }
              rows={5}
              className={cn(
                "w-full resize-none rounded-xl border bg-white/80 dark:bg-background/60 px-4 py-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all",
                (isListening || isPhoneActive) && "ring-2 ring-pink-400/60 border-pink-300",
              )}
            />
            {transcript && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-muted/70 hover:bg-muted flex items-center justify-center transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {mode === "mic" && (
              micSupported ? (
                <Button
                  type="button"
                  variant={isListening ? "destructive" : "default"}
                  size="sm"
                  onClick={isListening ? stopListening : startListening}
                  className={cn("gap-2 flex-shrink-0", isListening && "animate-pulse shadow-lg shadow-red-500/20")}
                >
                  {isListening ? <><MicOff className="w-4 h-4" />Stop Mic</> : <><Mic className="w-4 h-4" />Start Mic</>}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Mic not available — type above instead</p>
              )
            )}

            <div className="flex-1 min-w-0">
              {isExtracting && (
                <p className="text-xs text-primary flex items-center gap-1.5 animate-pulse">
                  <Sparkles className="w-3 h-3" /> Reading transcript…
                </p>
              )}
              {!isExtracting && filledFieldLabels.length > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 truncate">
                  ✓ Filled: {filledFieldLabels.join(", ")}
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => extractFromTranscript(transcript)}
              disabled={!transcript.trim() || isExtracting}
              className="flex-shrink-0 text-xs"
            >
              Re-scan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
