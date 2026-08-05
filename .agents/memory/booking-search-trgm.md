---
name: Booking search trigram indexes
description: How booking ILIKE search stays indexed; pitfalls that reintroduce seq scans
---

Booking search (`ILIKE '%term%'` across address/city/name/phone) is backed by pg_trgm GIN indexes, including expression indexes on `(first_name || ' ' || last_name)` and `regexp_replace(phone, '\D', '', 'g')`.

**Why:** substring ILIKE can't use btree; and an interleaved digit pattern like `%4%0%3%5%…` has no usable trigrams, so it forced a full seq scan (~143ms at 50k rows) even with indexes present. Normalized-digits ILIKE against the regexp_replace expression is index-backed (~1.5ms).

**How to apply:** any new ILIKE search condition must have a matching trgm index on the *exact same expression*; never build per-character wildcard patterns. Searches under 3 chars can't use trigrams (acceptable fallback).
