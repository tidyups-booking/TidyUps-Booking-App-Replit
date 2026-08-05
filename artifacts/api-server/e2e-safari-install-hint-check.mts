/**
 * Verifies the Safari install hint suppression logic:
 *  - never shows when the app runs standalone (installed via Dock or Home Screen)
 *  - never shows after dismissal
 *  - never shows in non-Safari browsers (Chrome/Edge/Firefox on macOS/iOS included)
 *  - shows in real macOS Safari and iOS Safari otherwise
 *  - iOS detection picks Share-sheet wording (incl. iPadOS reporting a Mac UA)
 */
import {
  shouldShowSafariInstallHint,
  isIOSUA,
} from "../booking-app/src/components/safari-install-hint-logic";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1";
const IOS_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15";
const MAC_EDGE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

let failures = 0;
function check(name: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name} (expected ${expected}, got ${actual})`);
}

const base = {
  displayModeStandalone: false,
  navigatorStandalone: false,
  dismissed: false,
};

// Shows in real Safari browsers
check("macOS Safari, fresh visit → shows", shouldShowSafariInstallHint({ ...base, userAgent: MAC_SAFARI }), true);
check("iOS Safari, fresh visit → shows", shouldShowSafariInstallHint({ ...base, userAgent: IOS_SAFARI }), true);

// Suppression path 1: installed / standalone
check("macOS Dock app (display-mode: standalone) → hidden", shouldShowSafariInstallHint({ ...base, userAgent: MAC_SAFARI, displayModeStandalone: true }), false);
check("iOS Home Screen (navigator.standalone) → hidden", shouldShowSafariInstallHint({ ...base, userAgent: IOS_SAFARI, navigatorStandalone: true }), false);
check("iOS Home Screen (both flags) → hidden", shouldShowSafariInstallHint({ ...base, userAgent: IOS_SAFARI, displayModeStandalone: true, navigatorStandalone: true }), false);

// Suppression path 2: dismissed (persisted in localStorage across reloads)
check("macOS Safari, previously dismissed → hidden", shouldShowSafariInstallHint({ ...base, userAgent: MAC_SAFARI, dismissed: true }), false);
check("iOS Safari, previously dismissed → hidden", shouldShowSafariInstallHint({ ...base, userAgent: IOS_SAFARI, dismissed: true }), false);

// Suppression path 3: non-Safari browsers (UA contains "Safari" token)
check("Chrome on macOS → hidden", shouldShowSafariInstallHint({ ...base, userAgent: MAC_CHROME }), false);
check("Chrome on iOS (CriOS) → hidden", shouldShowSafariInstallHint({ ...base, userAgent: IOS_CHROME }), false);
check("Firefox on iOS (FxiOS) → hidden", shouldShowSafariInstallHint({ ...base, userAgent: IOS_FIREFOX }), false);
check("Edge on macOS (Edg) → hidden", shouldShowSafariInstallHint({ ...base, userAgent: MAC_EDGE }), false);

// Wording: iOS gets Share-sheet copy, macOS gets Add to Dock
check("iPhone UA → Share-sheet wording", isIOSUA(IOS_SAFARI, 5), true);
check("iPadOS w/ Mac UA + touch → Share-sheet wording", isIOSUA(MAC_SAFARI, 5), true);
check("real Mac (no touch) → Add to Dock wording", isIOSUA(MAC_SAFARI, 0), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Safari install hint checks passed.");
