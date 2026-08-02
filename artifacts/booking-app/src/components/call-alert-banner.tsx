import { Phone, X, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useLiveCall } from "@/contexts/live-call-context";

export function CallAlertBanner() {
  const { callStatus, bannerVisible, dismissBanner } = useLiveCall();
  const [, setLocation] = useLocation();

  if (!bannerVisible) return null;

  const isEnded = callStatus === "ended";

  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-[60] flex items-center gap-3 px-4 py-2.5 text-white text-sm font-medium shadow-lg transition-colors duration-300",
        isEnded
          ? "bg-slate-600"
          : "bg-pink-600",
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Pulsing phone icon */}
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
          isEnded ? "bg-white/20" : "bg-white/25 animate-pulse",
        )}
      >
        <Phone className="w-3.5 h-3.5" />
      </div>

      {/* Message */}
      <span className="flex-1 min-w-0 truncate">
        {isEnded
          ? "Call ended — review the transcript on New Booking"
          : "Incoming call — a Twilio call is being transcribed"}
      </span>

      {/* Go to New Booking CTA */}
      {!isEnded && (
        <button
          type="button"
          onClick={() => setLocation("/new")}
          className="flex-shrink-0 flex items-center gap-1 bg-white/20 hover:bg-white/30 transition-colors rounded-lg px-3 py-1 text-xs font-semibold"
        >
          Open New Booking
          <ArrowRight className="w-3 h-3" />
        </button>
      )}

      {/* Dismiss */}
      <button
        type="button"
        onClick={dismissBanner}
        aria-label="Dismiss"
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
