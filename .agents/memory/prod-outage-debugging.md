---
name: Prod outage debugging
description: How to investigate bookcleaning.app downtime reports; log-retention and monitor quirks that bite during outage forensics
---

# Prod outage debugging

- **Republishing wipes the evidence.** `fetchDeploymentLogs` / deployment log drains only cover the CURRENT deployment build. A new publish replaces the log stream, so fetch outage-window logs BEFORE the user republishes. If a publish already happened, the old instance's record is unrecoverable — say so honestly instead of inferring from gaps.
- **Why:** Aug 2026 outage (22:33 MDT): user published ~2h after the outage; the previous build's logs were gone by investigation time.
- **Monitor fingerprint:** Replit's uptime monitor pings `GET /api` every ~1-2 min and bypasses the privacy shield; the app answering 401 in ms = healthy. Silence of those pings in-instance = requests not reaching any instance.
- **Privacy check is step one:** anonymous `curl -s -o /dev/null -w "%{http_code}" https://bookcleaning.app/` returning **307** (to replit.com/__replshield) means visibility is Private — customers see a Replit sign-in wall. Check this before deep-diving; a "site down" report can be a visibility slip from a recent publish.
- **Prod DB churn is normal-ish:** managed Postgres kills the live-call LISTEN connection every ~75s ("terminating connection due to administrator command", 57P01); app reconnects in ~3s (WARN + reconnect INFO pairs). Handled — not an outage signal by itself. A DB maintenance restart right before an outage window IS a plausible trigger for wedging an old instance.
- **/api/healthz is DB-free by design** (static ok response) — keep it that way so DB blips can't fail startup health checks.

# Dev e2e workflow false failures

- The e2e check workflows share the dev api-server on port 8080. After task merges, the platform restarts ALL workflows at once — e2e runs race the api-server rebuild and die with ECONNREFUSED. Same thing happens when several e2e workflows are restarted in parallel.
- **How to apply:** treat post-merge e2e failures as suspect until re-run one-at-a-time after the api-server settles. Don't debug "regressions" from a parallel run.
- Workflow log files in /tmp/logs are only written when logs are refreshed — `ls -t` right after a restart shows STALE files from the previous run; refresh logs before reading verdicts.
