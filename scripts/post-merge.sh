#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db migrate
# Rebuild compiled type declarations so TS project references (api-server) see fresh .d.ts
pnpm exec tsc --build lib/db lib/api-zod
