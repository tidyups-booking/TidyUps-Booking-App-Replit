/** Pure decision logic for the Safari install hint. Kept free of UI/alias
 *  imports so it can be unit-tested directly (see api-server e2e check). */

/** True only for real Safari (desktop or iOS), not Chrome/Edge/Firefox on
 *  macOS/iOS which also include "Safari" in their UA string. */
export function isSafariUA(ua: string): boolean {
  return (
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|FxiOS|Firefox/i.test(ua)
  );
}

/** iOS/iPadOS installs via the Share sheet; macOS via File → Add to Dock.
 *  Modern iPads report a Mac UA, so check for touch support too. */
export function isIOSUA(ua: string, maxTouchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && maxTouchPoints > 1)
  );
}

export interface InstallHintEnv {
  /** `(display-mode: standalone)` media query matches (installed PWA). */
  displayModeStandalone: boolean;
  /** iOS Safari's `navigator.standalone` (true when launched from Home Screen). */
  navigatorStandalone: boolean;
  /** Hint was previously dismissed (persisted in localStorage). */
  dismissed: boolean;
  userAgent: string;
}

/** Pure decision: show the hint only in real Safari, never when the app is
 *  already installed/standalone, and never after dismissal. */
export function shouldShowSafariInstallHint(env: InstallHintEnv): boolean {
  if (env.displayModeStandalone) return false;
  if (env.navigatorStandalone) return false;
  if (env.dismissed) return false;
  return isSafariUA(env.userAgent);
}
