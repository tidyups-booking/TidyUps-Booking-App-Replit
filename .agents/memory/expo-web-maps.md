---
name: react-native-maps breaks Expo web bundle
description: react-native-maps is NOT web-safe in this scaffold; importing it anywhere crashes the entire Expo web bundle. Platform-split with .web.tsx.
---

**Rule:** Never import `react-native-maps` from any file that web can reach. Metro's web bundle fails hard (500 on entry.bundle → blank app / "errors on app load") because the lib imports `react-native/Libraries/Utilities/codegenNativeCommands`, a native-only internal. There is no web alias/polyfill in this scaffold's `metro.config.js` (plain `getDefaultConfig`).

**Why:** Adding a Live Map tab to the cleaner app (2026-08-05) broke the whole web preview — not just the map screen — because expo-router's require.context pulls every route into the bundle.

**How to apply:** Put map rendering in a component pair: `Foo.tsx` (native, imports react-native-maps) + `Foo.web.tsx` (fallback UI, no maps import). Metro resolves `.web.tsx` automatically. Keep react-native-maps pinned at 1.18.0 for Expo Go (ignore Expo's "expected 1.20.1" warning per expo skill). Verify both bundles: web via Screenshot, native via `curl "http://localhost:22790$(node -e "console.log(require.resolve('expo-router/entry',{paths:['artifacts/cleaner-app']}).replace('/home/runner/workspace','').replace(/\.js$/,''))").bundle?platform=ios&dev=true..."` — HTTP 200 means it compiles.

Related: `customFetch` is exported from `@workspace/api-client-react` for endpoints not in the orval-generated client (e.g. /api/map/data); rebuild the lib (`tsc --build`) after touching it.
