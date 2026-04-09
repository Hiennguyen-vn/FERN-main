BEGIN;

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES ('R20', 'Reference Test Currency', 'R', 2);

INSERT INTO core.currency (code, name, symbol, decimal_places)
VALUES
  ('EUR', 'Euro', 'EUR', 2),
  ('USD', 'US Dollar', '$', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.region (
  id,
  code,
  currency_code,
  name,
  timezone_name
)
VALUES (
  920000,
  'R20-ROOT',
  'R20',
  'Reference Root',
  'Asia/Ho_Chi_Minh'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO core.exchange_rate (
      from_currency_code,
      to_currency_code,
      rate,
      effective_from
    )
    VALUES ('USD', 'EUR', 1.10000000, DATE '2025-01-01');

    RAISE EXCEPTION 'expected chk_exchange_rate_order failure';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.exchange_rate (
  from_currency_code,
  to_currency_code,
  rate,
  effective_from
)
VALUES ('EUR', 'USD', 1.10000000, DATE '2025-01-01');

DO $$
BEGIN
  BEGIN
    INSERT INTO core.outlet (
      id,
      region_id,
      code,
      name,
      status,
      opened_at,
      closed_at
    )
    VALUES (
      920001,
      920000,
      'R20-ROOT-001',
      'Broken Outlet',
      'active',
      DATE '2025-02-01',
      DATE '2025-01-31'
    );

    RAISE EXCEPTION 'expected chk_outlet_closed_after_opened failure';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code
)
VALUES (
  920100,
  'ref.user',
  'hash',
  'Reference User',
  'R20-EMP-001'
);

UPDATE core.app_user
SET deleted_at = NOW()
WHERE id = 920100;

DO $$
BEGIN
  BEGIN
    INSERT INTO core.app_user (
      id,
      username,
      password_hash,
      full_name,
      employee_code
    )
    VALUES (
      920101,
      'ref.user',
      'hash',
      'Reference User Reuse Attempt',
      'R20-EMP-002'
    );

    RAISE EXCEPTION 'expected username unique violation';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
