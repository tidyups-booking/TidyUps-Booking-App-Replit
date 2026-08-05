#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db migrate
# Rebuild compiled type declarations so TS project references (api-server) see fresh .d.ts
pnpm exec tsc --build lib/db lib/api-zod

# Cleaner-app bundle regression check: asks the running Expo dev server (Metro)
# to compile the web + native bundles, catching Metro-only breakage (e.g. the
# react-native-maps web crash) right after a merge. Requires the
# "artifacts/cleaner-app: expo" workflow to be running; fails loudly otherwise.
# Give Metro up to 60s to come up (it may be restarting right after a merge).
for i in $(seq 1 30); do
  if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:22790/status; then break; fi
  sleep 2
done
(cd artifacts/api-server && pnpm exec tsx e2e-cleaner-app-bundle-check.mts)
