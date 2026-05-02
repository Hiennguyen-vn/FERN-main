-- V69: F&B allergen taxonomy + product/customer mapping.
-- EU 14 + sesame (VN restaurant menu standard).

CREATE TABLE IF NOT EXISTS core.allergen (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  icon        TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO core.allergen (code, label, label_en, icon, sort_order) VALUES
  ('GLUTEN',      'Gluten (lúa mì)',      'Gluten / wheat',          '🌾', 10),
  ('DAIRY',       'Sữa và chế phẩm',      'Milk / dairy',            '🥛', 20),
  ('EGGS',        'Trứng',                 'Eggs',                    '🥚', 30),
  ('PEANUTS',     'Đậu phộng',             'Peanuts',                 '🥜', 40),
  ('TREE_NUTS',   'Hạt cây',               'Tree nuts',               '🌰', 50),
  ('SOY',         'Đậu nành',              'Soy',                     '🫘', 60),
  ('FISH',        'Cá',                    'Fish',                    '🐟', 70),
  ('SHELLFISH',   'Hải sản có vỏ',        'Shellfish / crustacean',  '🦐', 80),
  ('SESAME',      'Vừng / mè',             'Sesame',                  '🌱', 90),
  ('CELERY',      'Cần tây',               'Celery',                  '🌿', 100),
  ('MUSTARD',     'Mù tạt',                'Mustard',                 '🟡', 110),
  ('SULPHITES',   'Sulphite',              'Sulphites',               '⚗️', 120),
  ('LUPIN',       'Đậu lupin',             'Lupin',                   '🌼', 130),
  ('MOLLUSC',     'Nhuyễn thể',            'Molluscs',                '🐌', 140),
  ('ALCOHOL',     'Cồn',                   'Alcohol',                 '🍷', 150)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS core.product_allergen (
  product_id    BIGINT NOT NULL REFERENCES core.product(id) ON DELETE CASCADE,
  allergen_code TEXT   NOT NULL REFERENCES core.allergen(code),
  is_traces     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, allergen_code)
);

CREATE INDEX IF NOT EXISTS ix_product_allergen_code
  ON core.product_allergen (allergen_code);

CREATE TABLE IF NOT EXISTS core.customer_allergy (
  customer_id   BIGINT NOT NULL,
  allergen_code TEXT   NOT NULL REFERENCES core.allergen(code),
  severity      TEXT   NOT NULL DEFAULT 'AVOID' CHECK (severity IN ('NOTE','AVOID','SEVERE')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, allergen_code)
);

CREATE INDEX IF NOT EXISTS ix_customer_allergy_severity
  ON core.customer_allergy (customer_id, severity);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  core.allergen, core.product_allergen, core.customer_allergy
  TO fern_app;
