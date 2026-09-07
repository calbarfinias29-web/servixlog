-- SERVIX FAZA 6: persistent test-run registry.
-- Local migration only. No existing operational rows are changed or backfilled.

CREATE TABLE IF NOT EXISTS test_runs (
  test_run_id text PRIMARY KEY CHECK (test_run_id ~ '^TR-[0-9]+-[0-9a-z]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'PASSED', 'FAILED', 'BLOCKED', 'CLEANUP_PENDING', 'CLEANED')),
  environment text NOT NULL DEFAULT 'local',
  cleanup_status text NOT NULL DEFAULT 'PENDING' CHECK (cleanup_status IN ('PENDING', 'CLEANUP_PENDING', 'CLEANED')),
  description text,
  source text,
  test_mode text
);

CREATE TABLE IF NOT EXISTS test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id text NOT NULL REFERENCES test_runs(test_run_id) ON DELETE CASCADE,
  test_name text NOT NULL,
  category text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'FAIL', 'BLOCKED')),
  expected text NOT NULL,
  actual text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(test_run_id);

CREATE TABLE IF NOT EXISTS agent_bugs (
  bug_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id text NOT NULL REFERENCES test_runs(test_run_id) ON DELETE CASCADE,
  test_name text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  expected text NOT NULL,
  actual text NOT NULL,
  reproduction_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_area text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'FIXED', 'VERIFIED', 'WONT_FIX')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_run_id, test_name, affected_area)
);
CREATE INDEX IF NOT EXISTS idx_agent_bugs_run ON agent_bugs(test_run_id);

-- Full Test Mode uses this isolated JSON fixture store; no operational table is touched.
CREATE TABLE IF NOT EXISTS test_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id text NOT NULL REFERENCES test_runs(test_run_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('client', 'car', 'job', 'appointment', 'time', 'employee')),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_fixtures_run ON test_fixtures(test_run_id);

ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_bugs ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_fixtures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phase6_test_runs_select ON test_runs;
CREATE POLICY phase6_test_runs_select ON test_runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS phase6_test_runs_insert ON test_runs;
CREATE POLICY phase6_test_runs_insert ON test_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS phase6_test_runs_update ON test_runs;
CREATE POLICY phase6_test_runs_update ON test_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS phase6_results_select ON test_results;
CREATE POLICY phase6_results_select ON test_results FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS phase6_results_insert ON test_results;
CREATE POLICY phase6_results_insert ON test_results FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS phase6_bugs_select ON agent_bugs;
CREATE POLICY phase6_bugs_select ON agent_bugs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS phase6_bugs_insert ON agent_bugs;
CREATE POLICY phase6_bugs_insert ON agent_bugs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS phase6_bugs_update ON agent_bugs;
CREATE POLICY phase6_bugs_update ON agent_bugs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS phase6_fixtures_select ON test_fixtures;
CREATE POLICY phase6_fixtures_select ON test_fixtures FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS phase6_fixtures_insert ON test_fixtures;
CREATE POLICY phase6_fixtures_insert ON test_fixtures FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON test_runs TO anon, authenticated;
GRANT SELECT, INSERT ON test_results TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON agent_bugs TO anon, authenticated;
GRANT SELECT, INSERT ON test_fixtures TO anon, authenticated;

CREATE OR REPLACE FUNCTION cleanup_test_run(p_test_run_id text, p_confirmation text)
RETURNS TABLE (table_name text, remaining_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining bigint;
BEGIN
  IF p_test_run_id IS NULL OR p_test_run_id !~ '^TR-[0-9]+-[0-9a-z]+$' THEN
    RAISE EXCEPTION 'invalid test_run_id';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'Da' THEN
    RAISE EXCEPTION 'explicit confirmation required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM test_runs WHERE test_runs.test_run_id = p_test_run_id) THEN
    RAISE EXCEPTION 'test_run_id does not exist';
  END IF;

  DELETE FROM test_fixtures WHERE test_fixtures.test_run_id = p_test_run_id;
  GET DIAGNOSTICS v_remaining = ROW_COUNT;
  table_name := 'test_fixtures'; remaining_rows := v_remaining; RETURN NEXT;
  DELETE FROM test_results WHERE test_results.test_run_id = p_test_run_id;
  GET DIAGNOSTICS v_remaining = ROW_COUNT;
  table_name := 'test_results'; remaining_rows := v_remaining; RETURN NEXT;
  DELETE FROM agent_bugs WHERE agent_bugs.test_run_id = p_test_run_id;
  GET DIAGNOSTICS v_remaining = ROW_COUNT;
  table_name := 'agent_bugs'; remaining_rows := v_remaining; RETURN NEXT;

  UPDATE test_runs SET status = 'CLEANED', cleanup_status = 'CLEANED', finished_at = now()
    WHERE test_runs.test_run_id = p_test_run_id;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION cleanup_test_run(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_test_run(text, text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
