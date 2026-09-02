-- SERVIX persistent catalog for reusable vehicle and work values.
-- Existing cars, jobs, and appointments remain text-based and unchanged.

CREATE TABLE IF NOT EXISTS vehicle_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_makes_normalized_name_key UNIQUE (normalized_name)
);

CREATE TABLE IF NOT EXISTS vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id uuid NOT NULL REFERENCES vehicle_makes(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_models_make_normalized_name_key UNIQUE (make_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS work_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_catalog_normalized_name_key UNIQUE (normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_makes_normalized_name ON vehicle_makes(normalized_name);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_make_id ON vehicle_models(make_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_make_normalized_name ON vehicle_models(make_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_work_catalog_normalized_name ON work_catalog(normalized_name);

ALTER TABLE vehicle_makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_select" ON vehicle_makes;
CREATE POLICY "catalog_select" ON vehicle_makes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "catalog_insert" ON vehicle_makes;
CREATE POLICY "catalog_insert" ON vehicle_makes FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "catalog_select" ON vehicle_models;
CREATE POLICY "catalog_select" ON vehicle_models FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "catalog_insert" ON vehicle_models;
CREATE POLICY "catalog_insert" ON vehicle_models FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "catalog_select" ON work_catalog;
CREATE POLICY "catalog_select" ON work_catalog FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "catalog_insert" ON work_catalog;
CREATE POLICY "catalog_insert" ON work_catalog FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON vehicle_makes TO anon, authenticated;
GRANT SELECT, INSERT ON vehicle_models TO anon, authenticated;
GRANT SELECT, INSERT ON work_catalog TO anon, authenticated;

-- Backfill only non-empty existing values. No source rows are updated or deleted.
INSERT INTO vehicle_makes (name, normalized_name)
SELECT MIN(name), lower(regexp_replace(name, '[[:space:]]', '', 'g'))
FROM (
  SELECT make AS name FROM cars WHERE make IS NOT NULL AND btrim(make) <> ''
  UNION ALL
  SELECT make AS name FROM appointments WHERE make IS NOT NULL AND btrim(make) <> ''
) values_source
GROUP BY lower(regexp_replace(name, '[[:space:]]', '', 'g'))
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO vehicle_models (make_id, name, normalized_name)
SELECT vm.id, source.model, lower(regexp_replace(source.model, '[[:space:]]', '', 'g'))
FROM (
  SELECT DISTINCT make, model
  FROM (
    SELECT make, model FROM cars WHERE make IS NOT NULL AND btrim(make) <> '' AND model IS NOT NULL AND btrim(model) <> ''
    UNION
    SELECT make, model FROM appointments WHERE make IS NOT NULL AND btrim(make) <> '' AND model IS NOT NULL AND btrim(model) <> ''
  ) source_values
) source
JOIN vehicle_makes vm ON vm.normalized_name = lower(regexp_replace(source.make, '[[:space:]]', '', 'g'))
ON CONFLICT (make_id, normalized_name) DO NOTHING;

INSERT INTO work_catalog (name, normalized_name)
SELECT MIN(title), lower(regexp_replace(title, '[[:space:]]', '', 'g'))
FROM jobs
WHERE title IS NOT NULL AND btrim(title) <> ''
GROUP BY lower(regexp_replace(title, '[[:space:]]', '', 'g'))
ON CONFLICT (normalized_name) DO NOTHING;
