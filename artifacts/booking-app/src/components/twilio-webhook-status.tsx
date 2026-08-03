/**
 * Twilio phone-webhook health widget — used on the dashboard.
 *
 * Checks (via the api-server) whether the Twilio number's voice webhook still
 * points at the live production site. If it has drifted (e.g. re-pointed at a
 * temporary dev preview URL), incoming calls silently stop popping the live
 * call panel — this widget surfaces that with a clear warning and a one-click
 * "Fix" button that re-points the webhook at production.
 *
 * Renders a compact green pill when healthy, an amber warning card on drift.
 */
import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, PhoneCall, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  baseUrl: string;
}

interface WebhookHealth {
  ok: boolean;
  reason?: "mismatch" | "number_not_found" | "twilio_error" | "not_configured";
  phoneNumber: string;
  configuredUrl: string | null;
  expectedUrl: string | null;
  checkedAt: string;
  error?: string;
}

type State =
  | { kind: "loading" }
  | { kind: "healthy"; health: WebhookHealth }
  | { kind: "unhealthy"; health: WebhookHealth }
  | { kind: "error" };

const REASON_TEXT: Record<NonNullable<WebhookHealth["reason"]>, string> = {
  mismatch:
    "The Twilio number's voice webhook is not pointing at the live site — incoming calls won't reach the live call panel.",
  number_not_found:
    "The Twilio phone number could not be found on the connected Twilio account.",
  twilio_error: "Could not read the webhook configuration from Twilio.",
  not_configured: "The server is missing configuration needed to verify the webhook.",
};

export function TwilioWebhookStatus({ baseUrl }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}api/twilio/webhook-health`, {
        credentials: "include",
      });
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const health: WebhookHealth = await res.json();
      setState(health.ok ? { kind: "healthy", health } : { kind: "unhealthy", health });
    } catch {
      setState({ kind: "error" });
    }
  }, [baseUrl]);

  useEffect(() => {
    check();
  }, [check]);

  const handleFix = async () => {
    setFixing(true);
    setFixError(null);
    try {
      const res = await fetch(`${baseUrl}api/twilio/webhook-health/fix`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFixError(data?.error ?? "Failed to update the webhook");
        return;
      }
      const health: WebhookHealth = data;
      setState(health.ok ? { kind: "healthy", health } : { kind: "unhealthy", health });
      if (!health.ok) setFixError("Webhook updated, but the check still fails — try again.");
    } catch {
      setFixError("Failed to update the webhook");
    } finally {
      setFixing(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-sm animate-pulse">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        Checking phone…
      </div>
    );
  }

  if (state.kind === "healthy") {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium border border-green-200 dark:border-green-800"
        title={`Voice webhook on ${state.health.phoneNumber} points at the live site (checked ${new Date(state.health.checkedAt).toLocaleTimeString()})`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Phone Connected
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-sm border border-border">
        <PhoneCall className="w-3.5 h-3.5" />
        Phone check unavailable
        <button onClick={check} className="ml-1 underline hover:text-foreground" title="Retry">
          Retry
        </button>
      </div>
    );
  }

  // unhealthy — clear warning + one-click fix
  const { health } = state;
  const canFix = health.reason === "mismatch";
  return (
    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <span className="text-sm text-amber-800 dark:text-amber-300 font-medium flex-1">
          Phone system not pointing at the live site
        </span>
        {canFix && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 shrink-0"
            onClick={handleFix}
            disabled={fixing}
          >
            {fixing ? (
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Wrench className="w-3 h-3 mr-1" />
            )}
            {fixing ? "Fixing…" : "Fix it"}
          </Button>
        )}
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        {REASON_TEXT[health.reason ?? "twilio_error"]}
        {health.error ? ` (${health.error})` : ""}
      </p>
      {health.reason === "mismatch" && health.configuredUrl && (
        <p className="text-xs text-amber-700 dark:text-amber-400 break-all">
          Currently set to: <code className="font-mono">{health.configuredUrl}</code>
        </p>
      )}
      {fixError && <p className="text-xs text-red-600 dark:text-red-400">{fixError}</p>}
    </div>
  );
}
