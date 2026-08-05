#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db migrate
# Rebuild compiled type declarations so TS project references (api-server) see fresh .d.ts
pnpm exec tsc --build lib/db lib/api-zod

# Cleaner-app bundle regression check: asks the running Expo dev server (Metro)
# to compile the web + native bundles, catching Metro-only breakage (e.g. the
# react-native-maps web crash) right after a merge. The Expo preview workflow
# is OPTIONAL — if Metro isn't up, skip the check (with a loud warning) instead
# of stalling or failing the whole post-merge; the cleaner-app-bundle-e2e
# workflow still covers it when run explicitly. Brief wait only, in case Metro
# is mid-restart right after the merge.
metro_up=false
for i in $(seq 1 5); do
  if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:22790/status; then metro_up=true; break; fi
  sleep 1
done
if [ "$metro_up" = true ]; then
  (cd artifacts/api-server && pnpm exec tsx e2e-cleaner-app-bundle-check.mts)
else
  echo "WARNING: Expo dev server (Metro) not running — skipping cleaner-app bundle check (run the cleaner-app-bundle-e2e workflow to cover it)"
fi
