-- Social media links shown in the site footer, managed from the Settings page.
-- Seeded with the four main platforms; URLs start empty and are hidden from
-- the public footer until a dispatcher fills them in.
CREATE TABLE IF NOT EXISTS social_links (
  id         SERIAL PRIMARY KEY,
  platform   TEXT NOT NULL,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO social_links (platform, label, url, sort_order)
SELECT v.platform, v.label, '', v.sort_order
FROM (VALUES
  ('facebook',  'Facebook',  0),
  ('instagram', 'Instagram', 1),
  ('tiktok',    'TikTok',    2),
  ('youtube',   'YouTube',   3)
) AS v(platform, label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM social_links);
