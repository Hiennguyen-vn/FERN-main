CREATE TYPE ordering_table_status_enum AS ENUM (
  'active',
  'unavailable',
  'archived'
);

CREATE TABLE core.ordering_table (
  id BIGINT PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  table_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  public_token TEXT NOT NULL,
  status ordering_table_status_enum NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_ordering_table_outlet_code UNIQUE (outlet_id, table_code),
  CONSTRAINT uq_ordering_table_public_token UNIQUE (public_token)
);

CREATE INDEX idx_ordering_table_outlet_id ON core.ordering_table (outlet_id);
CREATE INDEX idx_ordering_table_status ON core.ordering_table (status);
