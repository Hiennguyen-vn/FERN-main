CREATE SCHEMA IF NOT EXISTS test_support;

CREATE OR REPLACE FUNCTION test_support.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'assert_true failed: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION test_support.assert_equals_text(
  p_actual TEXT,
  p_expected TEXT,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'assert_equals_text failed: %, expected=%, actual=%',
      p_message, p_expected, p_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION test_support.assert_equals_numeric(
  p_actual NUMERIC,
  p_expected NUMERIC,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'assert_equals_numeric failed: %, expected=%, actual=%',
      p_message, p_expected, p_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION test_support.assert_row_count(
  p_sql TEXT,
  p_expected BIGINT,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual BIGINT;
BEGIN
  EXECUTE format('SELECT count(*) FROM (%s) AS counted_rows', p_sql)
    INTO v_actual;

  IF v_actual <> p_expected THEN
    RAISE EXCEPTION 'assert_row_count failed: %, expected=%, actual=%',
      p_message, p_expected, v_actual;
  END IF;
END;
$$;
