/**
 * Jobber connection status widget — used on the dashboard.
 * Shows a "Connect Jobber" banner when not connected, or a green pill when connected.
 * When disconnected, also fetches + displays the current redirect URI so it can be
 * copy-pasted into the Jobber developer portal without any guesswork.
 */
import React, { useEffect, useState } from "react";
import { ExternalLink, CheckCircle2, AlertCircle, RefreshCw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  baseUrl: string;
}

type Status = "loading" | "connected" | "disconnected" | "error";

export function JobberStatus({ baseUrl }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const check = async () => {
    setStatus("loading");
    try {
      const res = await fetch(`${baseUrl}api/jobber/status`, { credentials: "include" });
      const data = await res.json();
      setStatus(data.connected ? "connected" : "disconnected");
    } catch {
      setStatus("error");
    }
  };

  // When disconnected, grab the current redirect URI to show it
  useEffect(() => {
    if (status !== "disconnected" && status !== "error") return;
    fetch(`${baseUrl}api/jobber/redirect-uri`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRedirectUri(d.redirectUri ?? null))
      .catch(() => {});
  }, [status, baseUrl]);

  useEffect(() => { check(); }, [baseUrl]);

  // Check for ?jobber= redirect from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobberParam = params.get("jobber");
    if (jobberParam === "connected") {
      setStatus("connected");
      const url = new URL(window.location.href);
      url.searchParams.delete("jobber");
      window.history.replaceState({}, "", url.toString());
    } else if (jobberParam === "error") {
      setStatus("disconnected");
    }
  }, []);

  const handleConnect = () => {
    // Open in a new tab — Jobber's OAuth page blocks iframe embedding (X-Frame-Options),
    // which causes "refused to connect" when running inside the Replit preview pane.
    window.open(`${baseUrl}api/jobber/auth`, "_blank", "noopener");
  };

  const handleCopy = async () => {
    if (!redirectUri) return;
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback: select text */
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-sm animate-pulse">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        Checking Jobber…
      </div>
    );
  }

  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium border border-green-200 dark:border-green-800">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Jobber Connected
      </div>
    );
  }

  // disconnected or error — show connect prompt + redirect URI helper
  return (
    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <span className="text-sm text-amber-800 dark:text-amber-300 font-medium flex-1">
          Jobber not connected
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 shrink-0"
          onClick={handleConnect}
        >
          <ExternalLink className="w-3 h-3 mr-1" />
          Connect
        </Button>
      </div>

      {redirectUri && (
        <div className="space-y-1">
          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            Step 1 — add this Redirect URI to your{" "}
            <a
              href="https://developer.getjobber.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-900"
            >
              Jobber developer app
            </a>
            , then click Connect:
          </p>
          <div className="flex items-center gap-1.5 bg-white dark:bg-black/30 rounded-lg border border-amber-200 dark:border-amber-700 px-2.5 py-1.5">
            <code className="text-xs text-amber-900 dark:text-amber-200 flex-1 break-all font-mono select-all">
              {redirectUri}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
              title="Copy to clipboard"
            >
              {copied
                ? <Check className="w-3.5 h-3.5 text-green-500" />
                : <Copy className="w-3.5 h-3.5 text-amber-500" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
