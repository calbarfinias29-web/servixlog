-- ============================================================
-- SERVIX — fix INSERT/UPDATE grants on cars for newer columns
--
-- CAUZA EROARII „permission denied for table cars”:
--   Migration 20260824122401_servix_demo_write_privileges.sql a
--   înlocuit grant-urile INSERT/UPDATE pe `cars` cu o listă
--   explicită de coloane. Migration 20260824192129 (major update)
--   și 20260824193921 (financial) au adăugat ulterior coloane noi
--   (mileage, body_observations, photo_url, fuel_level etc.) dar
--   NU au acordat grant pe ele. Formularul „Adaugă mașină” inserează
--   exact aceste coloane → Postgres 42501 (Supabase îl raportează
--   ca „permission denied for table cars”).
--
-- FIX: acordăm INSERT/UPDATE pe coloanele noi, pentru aceleași roluri
--   deja autorizate (anon, authenticated — conform designului
--   documentat în schema inițială: aplicație internă, tabletă partajată).
--   RLS rămâne activ, politicile existente rămân neschimbate.
--   `employees.access_code` rămâne în mod deliberat FĂRĂ grant (securitate).
--
-- Non-destructiv: nu șterge date, nu recrează tabele, nu atinge RLS.
-- ============================================================

GRANT INSERT (internal_id, mileage, body_observations, photo_url, fuel_level, overtime_seconds, payment_status, invoice_status, financial_status) ON cars TO anon, authenticated;
GRANT UPDATE (internal_id, mileage, body_observations, photo_url, fuel_level, overtime_seconds, payment_status, invoice_status, financial_status) ON cars TO anon, authenticated;

-- jobs: coloane de overtime adăugate în același major update (coerență,
-- aceleași fluxuri existente de salvare — niciun privilegiu nou de concept).
GRANT INSERT (overtime_seconds, is_overtime) ON jobs TO anon, authenticated;
GRANT UPDATE (overtime_seconds, is_overtime) ON jobs TO anon, authenticated;
