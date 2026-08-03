import { Router, type IRouter } from "express";
import { db, socialLinksTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { guardDispatcher } from "../lib/callerRole.js";

/** Public router: the footer fetches links without a session. */
const router: IRouter = Router();

/** Protected router: dispatchers manage links from the Settings page. */
export const socialLinksAdminRouter: IRouter = Router();

function badUrl(url: string): boolean {
  // Empty is allowed (hides the link); otherwise require an absolute http(s) URL.
  return url !== "" && !/^https?:\/\/\S+$/i.test(url);
}

/** Turn a display label into a stable machine key, e.g. "X (Twitter)" -> "x-twitter". */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// GET /social-links — public: footer icons on all pages.
router.get("/social-links", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(socialLinksTable)
    .orderBy(asc(socialLinksTable.sortOrder), asc(socialLinksTable.id));
  res.json(rows);
});

// POST /social-links — add a new link.
socialLinksAdminRouter.post("/social-links", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const body = req.body ?? {};
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!label) {
    res.status(400).json({ error: "Label is required" });
    return;
  }
  if (badUrl(url)) {
    res.status(400).json({ error: "URL must start with http:// or https://" });
    return;
  }

  const platform =
    typeof body.platform === "string" && body.platform.trim() !== ""
      ? slugify(body.platform)
      : slugify(label);

  let sortOrder = Number(body.sortOrder);
  if (!Number.isInteger(sortOrder)) {
    // Default to the end of the list.
    const rows = await db.select({ s: socialLinksTable.sortOrder }).from(socialLinksTable);
    sortOrder = rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.s)) + 1;
  }

  const [row] = await db
    .insert(socialLinksTable)
    .values({ platform, label, url, sortOrder })
    .returning();
  res.status(201).json(row);
});

// PATCH /social-links/:id — update label/url/order.
socialLinksAdminRouter.patch("/social-links/:id", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid link id" });
    return;
  }

  const body = req.body ?? {};
  const updates: Partial<{ label: string; platform: string; url: string; sortOrder: number }> = {};

  if (body.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) {
      res.status(400).json({ error: "Label cannot be empty" });
      return;
    }
    updates.label = label;
    updates.platform = slugify(label);
  }
  if (body.url !== undefined) {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (badUrl(url)) {
      res.status(400).json({ error: "URL must start with http:// or https://" });
      return;
    }
    updates.url = url;
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) {
      res.status(400).json({ error: "sortOrder must be an integer" });
      return;
    }
    updates.sortOrder = sortOrder;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db
    .update(socialLinksTable)
    .set(updates)
    .where(eq(socialLinksTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  res.json(row);
});

// DELETE /social-links/:id — remove a link.
socialLinksAdminRouter.delete("/social-links/:id", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid link id" });
    return;
  }

  const [row] = await db
    .delete(socialLinksTable)
    .where(eq(socialLinksTable.id, id))
    .returning({ id: socialLinksTable.id });

  if (!row) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  res.status(204).end();
});

export default router;
