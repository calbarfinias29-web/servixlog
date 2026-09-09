-- SERVIX inactivity notifications.
-- Prepared for review only. Do not apply automatically.
-- No existing operational table is changed or backfilled.

CREATE TABLE IF NOT EXISTS employee_inactivity_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_inactivity_period_open
  ON employee_inactivity_periods(employee_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_inactivity_period_employee
  ON employee_inactivity_periods(employee_id, started_at DESC);

CREATE TABLE IF NOT EXISTS employee_inactivity_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES employee_inactivity_periods(id) ON DELETE CASCADE,
  threshold_minutes integer NOT NULL CHECK (threshold_minutes IN (10, 20, 30)),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (period_id, threshold_minutes)
);
CREATE INDEX IF NOT EXISTS idx_employee_inactivity_notifications_unread
  ON employee_inactivity_notifications(read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_inactivity_notifications_employee
  ON employee_inactivity_notifications(employee_id, created_at DESC);

ALTER TABLE employee_inactivity_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_inactivity_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_inactivity_periods_select ON employee_inactivity_periods;
CREATE POLICY employee_inactivity_periods_select ON employee_inactivity_periods
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS employee_inactivity_notifications_select ON employee_inactivity_notifications;
CREATE POLICY employee_inactivity_notifications_select ON employee_inactivity_notifications
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS employee_inactivity_notifications_update ON employee_inactivity_notifications;
CREATE POLICY employee_inactivity_notifications_update ON employee_inactivity_notifications
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON employee_inactivity_periods TO anon, authenticated;
GRANT SELECT, UPDATE ON employee_inactivity_notifications TO anon, authenticated;

CREATE OR REPLACE FUNCTION observe_employee_inactivity(
  p_employee_ids uuid[],
  p_observed_at timestamptz DEFAULT now()
)
RETURNS SETOF employee_inactivity_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_period employee_inactivity_periods%ROWTYPE;
  v_notification employee_inactivity_notifications%ROWTYPE;
  v_threshold integer;
  v_elapsed integer;
BEGIN
  UPDATE employee_inactivity_periods
  SET ended_at = p_observed_at
  WHERE ended_at IS NULL
    AND NOT (employee_id = ANY(COALESCE(p_employee_ids, ARRAY[]::uuid[])));

  FOREACH v_employee_id IN ARRAY COALESCE(p_employee_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_period
    FROM employee_inactivity_periods
    WHERE employee_id = v_employee_id AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO employee_inactivity_periods (employee_id, started_at, created_at)
      VALUES (v_employee_id, p_observed_at, p_observed_at)
      RETURNING * INTO v_period;
    END IF;

    v_elapsed := FLOOR(EXTRACT(EPOCH FROM (p_observed_at - v_period.started_at)) / 60);
    FOREACH v_threshold IN ARRAY ARRAY[10, 20, 30] LOOP
      IF v_elapsed >= v_threshold THEN
        INSERT INTO employee_inactivity_notifications
          (employee_id, period_id, threshold_minutes, created_at)
        VALUES
          (v_employee_id, v_period.id, v_threshold, p_observed_at)
        ON CONFLICT (period_id, threshold_minutes) DO NOTHING
        RETURNING * INTO v_notification;
        IF FOUND THEN RETURN NEXT v_notification; END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION observe_employee_inactivity(uuid[], timestamptz) TO anon, authenticated;
