/**
 * End-to-end regression check for the cleaner-app Metro bundles.
 *
 * Background: adding react-native-maps once broke the ENTIRE cleaner-app web
 * bundle (every screen errored on load), because the lib imports native-only
 * React Native internals and expo-router bundles all routes together. This
 * class of breakage is invisible to typecheck and only appears when Metro
 * bundles. See .agents/memory/expo-web-maps.md.
 *
 * Rule: react-native-maps must ONLY be imported from
 * artifacts/cleaner-app/components/JobMap.tsx (native). Web resolves
 * components/JobMap.web.tsx, which must never import react-native-maps.
 *
 * This check asks the running Expo dev server (Metro, port 22790) for both
 * bundles and fails loudly if either does not compile:
 *   - web:    GET <entry>.bundle?platform=web...  must return 200
 *   - native: GET <entry>.bundle?platform=ios...  must return 200
 *
 * Requirements: the cleaner-app Expo dev server must be running
 * (workflow "artifacts/cleaner-app: expo").
 * Run: pnpm exec tsx e2e-cleaner-app-bundle-check.mts  (from artifacts/api-server)
 */
import { createRequire } from "node:module";
import path from "node:path";

const METRO_BASE = process.env.E2E_METRO_BASE ?? "http://127.0.0.1:22790";
const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const APP_DIR = path.join(WORKSPACE_ROOT, "artifacts/cleaner-app");

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Resolve the Expo Router entry file the same way Metro does, then convert it
// to the URL path Metro serves it under (workspace-root-relative, no .js ext).
const require_ = createRequire(path.join(APP_DIR, "package.json"));
const entryFile = require_.resolve("expo-router/entry");
const entryPath = "/" + path.relative(WORKSPACE_ROOT, entryFile).replace(/\.js$/, "");

async function checkBundle(platform: "web" | "ios") {
  const url =
    `${METRO_BASE}${entryPath}.bundle` +
    `?platform=${platform}&dev=true&hot=false&lazy=false&transform.engine=hermes&transform.routerRoot=app`;
  try {
    const res = await fetch(url);
    const ok = res.status === 200;
    let detail = `HTTP ${res.status}`;
    if (!ok) {
      const body = await res.text().catch(() => "");
      // Metro returns a JSON error payload on bundling failures; surface it.
      try {
        const parsed = JSON.parse(body);
        detail += `: ${parsed.message ?? body.slice(0, 500)}`;
      } catch {
        detail += `: ${body.slice(0, 500)}`;
      }
    }
    check(`${platform} bundle compiles (${entryPath}.bundle?platform=${platform})`, ok, detail);
  } catch (err: any) {
    check(`${platform} bundle compiles`, false, `fetch failed: ${err?.message ?? err} — is the cleaner-app Expo dev server running on ${METRO_BASE}?`);
  }
}

console.log(`Entry: ${entryPath}`);
await checkBundle("web");
await checkBundle("ios");

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll cleaner-app bundle checks passed.");
