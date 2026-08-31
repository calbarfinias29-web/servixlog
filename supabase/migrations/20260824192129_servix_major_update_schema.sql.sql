-- ============================================================
-- SERVIX MAJOR UPDATE: car internal_id, plate history, mileage,
-- body obs, photo, fuel, overtime, financial status, access codes
-- ============================================================

-- 1. Cars: add internal_id (permanent), mileage, body_observations, photo_url, fuel_level, overtime_seconds, payment_status, invoice_status
ALTER TABLE cars ADD COLUMN IF NOT EXISTS internal_id text;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS mileage integer;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS body_observations text;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS fuel_level text;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS overtime_seconds integer DEFAULT 0;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'neincasat';
ALTER TABLE cars ADD COLUMN IF NOT EXISTS invoice_status text DEFAULT 'nefacturat';

-- 2. Generate internal_id for existing cars (CAR-000001 format)
DO $$
DECLARE
  car_record RECORD;
  counter integer := 1;
BEGIN
  FOR car_record IN SELECT id FROM cars WHERE internal_id IS NULL ORDER BY created_at ASC LOOP
    UPDATE cars SET internal_id = 'CAR-' || lpad(counter::text, 6, '0') WHERE id = car_record.id;
    counter := counter + 1;
  END LOOP;
END $$;

-- 3. Auto-generate internal_id for new cars via trigger
CREATE OR REPLACE FUNCTION generate_internal_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_num integer;
BEGIN
  IF NEW.internal_id IS NULL THEN
    SELECT COALESCE(MAX(CAST(REPLACE(internal_id, 'CAR-', '') AS integer)), 0) INTO max_num FROM cars;
    NEW.internal_id := 'CAR-' || lpad((max_num + 1)::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_internal_id ON cars;
CREATE TRIGGER trg_generate_internal_id
  BEFORE INSERT ON cars
  FOR EACH ROW
  EXECUTE FUNCTION generate_internal_id();

-- 4. Plate history table
CREATE TABLE IF NOT EXISTS plate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  license_plate text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES employees(id),
  is_demo boolean NOT NULL DEFAULT false
);

ALTER TABLE plate_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_plate_history" ON plate_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_plate_history" ON plate_history FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_plate_history" ON plate_history FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_plate_history" ON plate_history FOR DELETE TO anon, authenticated USING (is_demo = true);

-- 5. Mileage log table (track mileage at each service visit)
CREATE TABLE IF NOT EXISTS mileage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  mileage integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES employees(id),
  is_demo boolean NOT NULL DEFAULT false
);

ALTER TABLE mileage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_mileage_log" ON mileage_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_mileage_log" ON mileage_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_mileage_log" ON mileage_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_mileage_log" ON mileage_log FOR DELETE TO anon, authenticated USING (is_demo = true);

-- 6. Employees: add access_code (hashed via crypt extension if available, else plain)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS access_code text;

-- 7. Jobs: add overtime_seconds for tracking overtime separately
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS overtime_seconds integer DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_overtime boolean DEFAULT false;

-- 8. Seed plate_history for existing cars (record current plate as initial)
INSERT INTO plate_history (car_id, license_plate, is_demo)
SELECT id, license_plate, is_demo FROM cars
WHERE NOT EXISTS (SELECT 1 FROM plate_history ph WHERE ph.car_id = cars.id)
ON CONFLICT DO NOTHING;

-- 9. Update RLS policies for cars to allow updating new columns
-- (existing policies already cover UPDATE with USING true / WITH CHECK true)

-- 10. Add check constraints for payment_status and invoice_status
ALTER TABLE cars ADD CONSTRAINT chk_payment_status CHECK (payment_status IN ('incasat', 'neincasat'));
ALTER TABLE cars ADD CONSTRAINT chk_invoice_status CHECK (invoice_status IN ('facturat', 'nefacturat'));
ALTER TABLE cars ADD CONSTRAINT chk_fuel_level CHECK (fuel_level IS NULL OR fuel_level IN ('rezerva', '1/4', '1/2', '3/4', 'plin'));