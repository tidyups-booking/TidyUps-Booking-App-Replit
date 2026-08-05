import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MonitorDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Chrome/Edge fire `beforeinstallprompt` when the app qualifies for
 * installation (manifest + icons). Not in TypeScript's DOM lib yet.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app" button — appears only in browsers that offer PWA install
 * (Chrome/Edge on desktop and Android) and hides once installed or when
 * already running as the installed app. Safari users install via the
 * browser menu instead, so no button is shown there.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already running as the installed app — nothing to offer.
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the mini-infobar from appearing on mobile
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!installEvent) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={() => {
        // prompt() is single-use: clear state synchronously so a rapid
        // double-click can never invoke it twice.
        const evt = installEvent;
        setInstallEvent(null);
        evt.prompt().catch(() => {
          // Browser refused (e.g. prompt already spent) — nothing to do.
        });
      }}
    >
      <MonitorDown className="w-4 h-4" />
      Install app
    </Button>
  );
}
