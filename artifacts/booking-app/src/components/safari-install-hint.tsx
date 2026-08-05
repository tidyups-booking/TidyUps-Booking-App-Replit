import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MonitorDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DISMISS_KEY = "safari-install-hint-dismissed";

/** True only for real Safari (desktop or iOS), not Chrome/Edge/Firefox on
 *  macOS/iOS which also include "Safari" in their UA string. */
function isSafari(): boolean {
  const ua = navigator.userAgent;
  return (
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|FxiOS|Firefox/i.test(ua)
  );
}

/** iOS/iPadOS installs via the Share sheet; macOS via File → Add to Dock.
 *  Modern iPads report a Mac UA, so check for touch support too. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Safari never fires `beforeinstallprompt`, so the one-click install button
 * can't appear there. Instead, show a subtle "Install app" affordance that
 * opens a short how-to (Add to Dock on macOS, Add to Home Screen on iOS).
 * Dismissal is remembered in localStorage so it never nags.
 */
export function SafariInstallHint({ className }: { className?: string }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Already installed / running standalone — nothing to suggest.
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if ((navigator as { standalone?: boolean }).standalone) return; // iOS Safari
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage unavailable (private mode edge cases) — still show
    }
    if (isSafari()) setShow(true);
  }, []);

  if (!show) return null;

  const ios = isIOS();

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // best effort — worst case the hint reappears next visit
    }
    setOpen(false);
    setShow(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)}>
          <MonitorDown className="w-4 h-4" />
          Install app
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">
            {ios ? "Add to Home Screen" : "Add to Dock"}
          </p>
          <button
            onClick={dismiss}
            aria-label="Dismiss install hint"
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 text-muted-foreground">
          {ios ? (
            <>
              Tap the <span className="font-medium text-foreground">Share</span>{" "}
              button, then choose{" "}
              <span className="font-medium text-foreground">
                Add to Home Screen
              </span>{" "}
              to install this app.
            </>
          ) : (
            <>
              In Safari's menu bar, choose{" "}
              <span className="font-medium text-foreground">
                File → Add to Dock
              </span>{" "}
              to install this app on your Mac.
            </>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-muted-foreground"
          onClick={dismiss}
        >
          Don't show again
        </Button>
      </PopoverContent>
    </Popover>
  );
}
