import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type GlobalCallStatus = "idle" | "active" | "ended";

interface LiveCallContextValue {
  callStatus: GlobalCallStatus;
  /** True while a call is active and the banner has not been manually dismissed */
  bannerVisible: boolean;
  dismissBanner: () => void;
}

const LiveCallContext = createContext<LiveCallContextValue>({
  callStatus: "idle",
  bannerVisible: false,
  dismissBanner: () => {},
});

function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function LiveCallProvider({ children }: { children: React.ReactNode }) {
  const [callStatus, setCallStatus] = useState<GlobalCallStatus>("idle");
  const [manuallyDismissed, setManuallyDismissed] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  // Tracks the auto-dismiss timer so it can be cancelled if a new call starts
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEndTimer = useCallback(() => {
    if (endTimerRef.current !== null) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (sseRef.current) return;
    const es = new EventSource(`${getBaseUrl()}api/twilio/transcript`);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          active?: boolean;
        };

        if (msg.type === "state") {
          if (msg.active) {
            clearEndTimer();
            setCallStatus("active");
            setManuallyDismissed(false);
          }
        } else if (msg.type === "call_started") {
          // Cancel any pending end-dismiss timer from a previous call
          clearEndTimer();
          setCallStatus("active");
          setManuallyDismissed(false);
        } else if (msg.type === "call_ended") {
          setCallStatus("ended");
          // Auto-clear the banner after 8 s — but only if no new call starts first
          endTimerRef.current = setTimeout(() => {
            endTimerRef.current = null;
            setCallStatus("idle");
          }, 8_000);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE auto-reconnects; no action needed
    };

    sseRef.current = es;
  }, [clearEndTimer]);

  const disconnect = useCallback(() => {
    clearEndTimer();
    sseRef.current?.close();
    sseRef.current = null;
  }, [clearEndTimer]);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  const dismissBanner = useCallback(() => {
    setManuallyDismissed(true);
  }, []);

  const bannerVisible =
    (callStatus === "active" || callStatus === "ended") && !manuallyDismissed;

  return (
    <LiveCallContext.Provider value={{ callStatus, bannerVisible, dismissBanner }}>
      {children}
    </LiveCallContext.Provider>
  );
}

export function useLiveCall() {
  return useContext(LiveCallContext);
}
