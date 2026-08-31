-- ============================================================
-- 1. Appointments table
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid REFERENCES cars(id) ON DELETE SET NULL,
  license_plate text,
  client_name text,
  client_phone text,
  make text,
  model text,
  internal_id text,
  vin text,
  appointment_date date NOT NULL,
  appointment_time text NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'programata',
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_appointments" ON appointments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_appointments" ON appointments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_appointments" ON appointments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_appointments" ON appointments FOR DELETE TO anon, authenticated USING (is_demo = true);

-- ============================================================
-- 2. Unified financial_status column on cars
--    Replaces payment_status + invoice_status with single field
-- ============================================================
ALTER TABLE cars ADD COLUMN IF NOT EXISTS financial_status text DEFAULT 'nefacturat';

-- Migrate existing data: combine payment_status + invoice_status into financial_status
UPDATE cars SET financial_status = CASE
  WHEN payment_status = 'incasat' THEN 'incasat'
  WHEN invoice_status = 'facturat' THEN 'facturat'
  WHEN payment_status = 'neincasat' THEN 'neincasat'
  ELSE 'nefacturat'
END;

ALTER TABLE cars ADD CONSTRAINT chk_financial_status CHECK (financial_status IN ('incasat', 'neincasat', 'facturat', 'nefacturat'));

-- ============================================================
-- 3. Storage bucket for employee photos
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('employee-photos', 'employee-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "anon_read_employee_photos" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'employee-photos');
CREATE POLICY "anon_write_employee_photos" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'employee-photos');
CREATE POLICY "anon_update_employee_photos" ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'employee-photos');
CREATE POLICY "anon_delete_employee_photos" ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'employee-photos');

-- ============================================================
-- 4. Demo appointments for today
-- ============================================================
INSERT INTO appointments (car_id, license_plate, client_name, client_phone, make, model, internal_id, vin, appointment_date, appointment_time, status, is_demo)
SELECT c.id, c.license_plate, c.client_name, c.client_phone, c.make, c.model, c.internal_id, c.vin,
  CURRENT_DATE, '09:00', 'programata', true
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
ON CONFLICT DO NOTHING;

INSERT INTO appointments (car_id, license_plate, client_name, client_phone, make, model, internal_id, vin, appointment_date, appointment_time, status, is_demo)
SELECT c.id, c.license_plate, c.client_name, c.client_phone, c.make, c.model, c.internal_id, c.vin,
  CURRENT_DATE, '10:30', 'programata', true
FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND c.client_name = 'Mihai Ionescu'
ON CONFLICT DO NOTHING;

INSERT INTO appointments (car_id, license_plate, client_name, client_phone, make, model, internal_id, vin, appointment_date, appointment_time, status, is_demo)
SELECT c.id, c.license_plate, c.client_name, c.client_phone, c.make, c.model, c.internal_id, c.vin,
  CURRENT_DATE, '14:00', 'programata', true
FROM cars c WHERE c.license_plate = 'TM 77 DEMO' AND c.client_name = 'Vlad Georgescu'
ON CONFLICT DO NOTHING;