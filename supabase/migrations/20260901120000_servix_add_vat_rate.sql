-- ============================================================
-- SERVIX — Cotă TVA
-- Adaugă coloana vat_rate în tabelul rates (singurul rând „Setări” editat din Admin → Setări).
-- Valoarea implicită este 21%. Se aplică automat rapoartelor PDF la final,
-- fără a modifica mecanismul existent de calcul al costurilor/tarifelor.
-- ============================================================

ALTER TABLE rates ADD COLUMN IF NOT EXISTS vat_rate numeric(10,2) NOT NULL DEFAULT 21;

-- Asigură că rândul existent (dacă avea valoare NULLde) primeste valoarea implicită.
UPDATE rates SET vat_rate = 21 WHERE vat_rate IS NULL;