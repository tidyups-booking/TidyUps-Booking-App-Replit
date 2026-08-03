import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { guardDispatcher } from "../lib/callerRole.js";

const router: IRouter = Router();

// POST /ai/extract-booking — dispatcher only
router.post("/ai/extract-booking", async (req, res): Promise<void> => {
  if (await guardDispatcher(req, res)) return;

  try {
    const { transcript } = req.body as { transcript: string };

    if (!transcript || transcript.trim().length < 3) {
      res.json({});
      return;
    }

    const today = new Date().toISOString().split("T")[0];

    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `You are a booking assistant for 833 Tidyups, an Edmonton home cleaning service.
Extract booking information from a phone call transcript and return a JSON object.
Only include fields you are confident about from what was said. Do not guess or invent details.
Today's date is ${today}.

Return ONLY a valid JSON object with these optional fields (omit any field not clearly mentioned):
{
  "firstName": string,
  "lastName": string,
  "phone": string (Canadian format e.g. 780-555-1234),
  "email": string,
  "address": string (street address only, no city),
  "city": string (default "Edmonton" if the caller is local and city not mentioned),
  "postalCode": string,
  "serviceType": "standard_clean" | "deep_clean" | "move_in_out" | "post_construction",
  "bedrooms": number (integer),
  "bathrooms": number (can be 0.5 increments),
  "scheduledDate": string (YYYY-MM-DD, interpret relative dates like "next Tuesday" using today's date),
  "scheduledTime": string (HH:MM 24h format, e.g. "09:00"),
  "frequency": "one_time" | "weekly" | "biweekly" | "monthly",
  "notes": string (anything special: entry instructions, pets, parking, etc.),
  "extras": array of strings from: ["Oven","Fridge","Windows","Laundry","Garage","Basement","Inside Cabinets"]
}

Service type clues:
- "standard" or "regular" → standard_clean
- "deep" or "thorough" → deep_clean
- "moving", "move in", "move out" → move_in_out
- "construction", "renovation", "builder" → post_construction`,
        },
        {
          role: "user",
          content: `Extract booking info from this call transcript:\n\n${transcript}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const extracted = JSON.parse(raw);
    res.json(extracted);
  } catch (err: any) {
    console.error("extract-booking error", err);
    res.status(500).json({ error: "Failed to extract booking info" });
  }
});

export default router;
