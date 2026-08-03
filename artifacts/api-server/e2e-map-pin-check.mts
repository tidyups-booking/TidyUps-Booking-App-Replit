/**
 * Ad-hoc end-to-end check for Task: staff pins appear on the Live Map after
 * a geocoded address is saved. Mounts the real map router against the dev DB.
 * Run: npx tsx e2e-map-pin-check.mts  (from artifacts/api-server)
 */
import express from "express";
import { clerkMiddleware } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, staffTable } from "@workspace/db";

// Load app.js first so the app.js ↔ routes circular imports resolve in the
// same order as production, then grab the map router.
await import("./src/app.js");
const mapRouter = (await import("./src/routes/map.js")).default;

const app = express();
app.use(express.json());
app.use(clerkMiddleware());
app.use(mapRouter);

const server = app.listen(0);
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// 1. Simulate what the Staff page save does after a Places-autocomplete pick:
//    a staff record with homeAddress + homeLat/homeLng.
const [created] = await db
  .insert(staffTable)
  .values({
    name: "E2E Pin Check",
    role: "cleaner",
    active: true,
    homeAddress: "10230 Jasper Ave NW, Edmonton",
    homeLat: 53.5407,
    homeLng: -113.4977,
  })
  .returning();

try {
  const today = new Date().toISOString().split("T")[0];

  // 2. /map/data is what the Live Map polls every 30s — the new staff member
  //    must appear with coordinates without any reload.
  const res = await fetch(`${base}/map/data?date=${today}`);
  check("/map/data responds 200", res.status === 200, `status=${res.status}`);
  const data = await res.json();
  const entry = (data.staff as any[]).find((s) => s.id === created.id);
  check("new staff appears in /map/data", !!entry);
  check("homeLat/homeLng returned", entry?.homeLat === 53.5407 && entry?.homeLng === -113.4977);
  check(
    "effective position falls back to home coords",
    entry?.position?.source === "home" &&
      entry?.position?.lat === 53.5407 &&
      entry?.position?.lng === -113.4977,
  );

  // Map page renders a home pin whenever homeLat/homeLng are non-null — same
  // condition as the API response above.
  check("home-pin render condition met", entry?.homeLat != null && entry?.homeLng != null);

  // Staff page "Not geocoded" badge condition: homeAddress && homeLat == null.
  check("'Not geocoded' badge absent for this record", !(entry?.homeAddress && entry?.homeLat == null));

  // 3. /map/counts is behind requireAuth — unauthenticated should get a clean
  //    401 (not a 500 crash). The undefined-variable fix is verified by tsc.
  const counts = await fetch(`${base}/map/counts?startDate=${today}&endDate=${today}`);
  check("/map/counts guarded without crashing", counts.status === 401, `status=${counts.status}`);
} finally {
  await db.delete(staffTable).where(eq(staffTable.id, created.id));
  server.close();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
