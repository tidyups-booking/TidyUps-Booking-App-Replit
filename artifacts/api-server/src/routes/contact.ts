import { Router, type IRouter } from "express";
import { db, contactMessagesTable } from "@workspace/db";
import {
  SubmitContactMessageBody,
  SubmitContactMessageResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// POST /contact — public (no auth): contact form on the public Contact page.
// Messages are captured server-side only; no email delivery for now.
router.post("/contact", async (req, res): Promise<void> => {
  const parsed = SubmitContactMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim();
  const message = parsed.data.message.trim();
  const phone = parsed.data.phone?.trim() || null;

  if (!name || !message) {
    res.status(400).json({ error: "Name and message are required" });
    return;
  }

  const [row] = await db
    .insert(contactMessagesTable)
    .values({ name, email, phone, message })
    .returning();

  res.status(201).json(SubmitContactMessageResponse.parse(row));
});

export default router;
