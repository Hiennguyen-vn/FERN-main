-- POS device registry. One row per provisioned Windows POS terminal.
-- worker_id range 128-1023 reserved for edge devices (0-127 = central services).
CREATE TABLE core.device_registry (
  id                      BIGINT        PRIMARY KEY,
  outlet_id               BIGINT        NOT NULL REFERENCES core.outlet(id),
  device_label            TEXT          NOT NULL,
  worker_id               INT           NOT NULL UNIQUE
                                          CHECK (worker_id BETWEEN 128 AND 1023),
  browser_fingerprint_hash TEXT,
  issued_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ,
  last_seen_at            TIMESTAMPTZ,
  version                 INT           NOT NULL DEFAULT 0
);

CREATE INDEX ix_device_registry_outlet ON core.device_registry(outlet_id);
