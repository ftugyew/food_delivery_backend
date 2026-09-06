-- ============================================================
-- Tindo: SQL to fix empty Top / Featured restaurants (Postgres)
-- Run these in Supabase SQL Editor (or any Postgres client)
-- ============================================================

-- 1) Inspect current data
SELECT id, name, status FROM restaurants ORDER BY id;
SELECT * FROM top_restaurants ORDER BY position;
SELECT * FROM featured_restaurants ORDER BY position;

-- 2) Ensure tables exist (safe if already created)
CREATE TABLE IF NOT EXISTS top_restaurants (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS featured_restaurants (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) Seed ALL approved restaurants into top + featured
--    (skips restaurants already present)
INSERT INTO top_restaurants (restaurant_id, position, is_active)
SELECT r.id,
       ROW_NUMBER() OVER (ORDER BY r.id)::int,
       TRUE
FROM restaurants r
WHERE r.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM top_restaurants t WHERE t.restaurant_id = r.id
  );

INSERT INTO featured_restaurants (restaurant_id, position, is_active)
SELECT r.id,
       ROW_NUMBER() OVER (ORDER BY r.id)::int,
       TRUE
FROM restaurants r
WHERE r.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM featured_restaurants f WHERE f.restaurant_id = r.id
  );

-- 4) Optional: explicitly set the three known restaurants
-- INSERT INTO top_restaurants (restaurant_id, position, is_active) VALUES
--   (1, 1, TRUE), (2, 2, TRUE), (3, 3, TRUE)
-- ON CONFLICT DO NOTHING;
-- (Use only if you have a unique constraint on restaurant_id)

-- 5) Make sure restaurants are approved (if any are pending)
UPDATE restaurants SET status = 'approved'
WHERE id IN (1, 2, 3) AND status <> 'approved';

-- 6) Verify APIs will return data
SELECT tr.position, r.id, r.name, r.cuisine, tr.is_active
FROM top_restaurants tr
JOIN restaurants r ON r.id = tr.restaurant_id
ORDER BY tr.position;

SELECT fr.position, r.id, r.name, r.cuisine, fr.is_active
FROM featured_restaurants fr
JOIN restaurants r ON r.id = fr.restaurant_id
ORDER BY fr.position;

-- 7) OTP table (needed for phone login)
CREATE TABLE IF NOT EXISTS otps (
  phone VARCHAR(20) PRIMARY KEY,
  otp VARCHAR(6) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8) Banners table (homepage popup)
CREATE TABLE IF NOT EXISTS banners (
  id BIGSERIAL PRIMARY KEY,
  image_url VARCHAR(500) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9) Optional: clear and re-seed from scratch
-- DELETE FROM top_restaurants;
-- DELETE FROM featured_restaurants;
-- then re-run section 3
