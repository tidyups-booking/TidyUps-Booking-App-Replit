---
name: Workflow slots are capped at 10
description: configureWorkflow fails silently-looking (success:false) at 10 workflows; consolidate e2e checks instead of adding more.
---

**Rule:** The project can hold at most 10 workflows. When adding a new e2e check workflow, expect `configureWorkflow` to return `success:false` ("Workflow limit exceeded") — free a slot by chaining related e2e scripts (`a.mts && b.mts`) into one workflow.

**Why:** Adding the cleaner-app bundle check (2026-08-05) hit the cap; dispatcher access + bootstrap checks were merged into one workflow to make room.

**How to apply:** Validation-registered workflows (e.g. dispatcher-access-e2e) can't be changed via `configureWorkflow` — use `setValidationCommand` (upsert) instead. Always check the returned `success` flag.
