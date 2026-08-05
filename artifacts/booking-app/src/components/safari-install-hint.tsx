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

import {
  isIOSUA,
  shouldShowSafariInstallHint,
} from "./safari-install-hint-logic";

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
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // localStorage unavailable (private mode edge cases) — still show
    }
    setShow(
      shouldShowSafariInstallHint({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)")
          .matches,
        navigatorStandalone: Boolean(
          (navigator as { standalone?: boolean }).standalone,
        ),
        dismissed,
        userAgent: navigator.userAgent,
      }),
    );
  }, []);

  if (!show) return null;

  const ios = isIOSUA(navigator.userAgent, navigator.maxTouchPoints);

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
