-- ============================================================
-- SERVIX: car photos (multiple photos per car) + storage bucket
-- Compatibil cu datele existente: cars.photo_url rămâne neatins.
-- ============================================================

-- 1. Tabel car_photos
CREATE TABLE IF NOT EXISTS car_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  url text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE car_photos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_car_photos_car ON car_photos(car_id);

DROP POLICY IF EXISTS "anon_select_car_photos" ON car_photos;
CREATE POLICY "anon_select_car_photos" ON car_photos FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_car_photos" ON car_photos;
CREATE POLICY "anon_insert_car_photos" ON car_photos FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_car_photos" ON car_photos;
CREATE POLICY "anon_delete_car_photos" ON car_photos FOR DELETE
  TO anon, authenticated USING (true);

-- 2. Storage bucket pentru fotografiile mașinilor (public, la fel ca employee-photos)
INSERT INTO storage.buckets (id, name, public) VALUES ('car-photos', 'car-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_read_car_photos" ON storage.objects;
CREATE POLICY "anon_read_car_photos" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'car-photos');
DROP POLICY IF EXISTS "anon_write_car_photos" ON storage.objects;
CREATE POLICY "anon_write_car_photos" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'car-photos');
DROP POLICY IF EXISTS "anon_update_car_photos" ON storage.objects;
CREATE POLICY "anon_update_car_photos" ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'car-photos');
DROP POLICY IF EXISTS "anon_delete_car_photos" ON storage.objects;
CREATE POLICY "anon_delete_car_photos" ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'car-photos');

-- ============================================================
-- 3. Reîncarcă schema cache-ul PostgREST ASTFEL ÎNCÂT relația
--    cars → car_photos (prin FK-ul de mai sus) să devină vizibilă.
--    Fără acest pas, PostgREST afișează:
--    "Could not find a relationship between 'cars' and 'car_photos'
--     in the schema cache" chiar dacă tabelul + FK există.
-- ============================================================
NOTIFY pgrst, 'reload schema';
