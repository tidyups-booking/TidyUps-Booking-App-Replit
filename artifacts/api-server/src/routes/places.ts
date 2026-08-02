import { Router } from "express";

const router = Router();

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// GET /api/places/autocomplete?input=...
router.get("/places/autocomplete", async (req, res) => {
  const input = (req.query.input as string) ?? "";
  if (input.length < 3) {
    return res.json({ predictions: [] });
  }
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: "Google Maps API key not configured" });
  }
  try {
    const params = new URLSearchParams({
      input,
      components: "country:ca",
      types: "address",
      key: GOOGLE_API_KEY,
    });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const data = await response.json() as any;
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Places autocomplete API error:", data.status, data.error_message);
      return res.status(502).json({ error: data.status });
    }
    const predictions = ((data.predictions ?? []) as any[]).map((p) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));
    res.json({ predictions });
  } catch (err) {
    console.error("Places autocomplete error:", err);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// GET /api/places/details?placeId=...
router.get("/places/details", async (req, res) => {
  const placeId = (req.query.placeId as string) ?? "";
  if (!placeId) {
    return res.status(400).json({ error: "placeId required" });
  }
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: "Google Maps API key not configured" });
  }
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "formatted_address,geometry,address_components",
      key: GOOGLE_API_KEY,
    });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const data = await response.json() as any;
    if (data.status !== "OK") {
      console.error("Place details API error:", data.status);
      return res.status(502).json({ error: data.status });
    }
    const result = data.result;
    // Build a flat map of component type → short_name / long_name
    const comp: Record<string, string> = {};
    for (const c of result.address_components ?? []) {
      for (const type of c.types as string[]) {
        comp[type] = c.short_name;
        comp[`${type}_long`] = c.long_name;
      }
    }
    const streetNumber = comp.street_number ?? "";
    const route = comp.route ?? "";
    const address = [streetNumber, route].filter(Boolean).join(" ");
    const city =
      comp.locality_long ??
      comp.sublocality_level_1_long ??
      comp.administrative_area_level_3_long ??
      "";
    const province = comp.administrative_area_level_1 ?? "";
    const postalCode = (comp.postal_code ?? "").replace(/\s+/g, "");

    res.json({
      formattedAddress: result.formatted_address,
      address,
      city,
      province,
      postalCode,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
    });
  } catch (err) {
    console.error("Place details error:", err);
    res.status(500).json({ error: "Failed to fetch place details" });
  }
});

export default router;
