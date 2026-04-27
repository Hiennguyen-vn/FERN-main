-- Tax rules per outlet/category for VAT compliance (Nghi dinh 123/2020)
CREATE TABLE IF NOT EXISTS core.tax_rule (
    id                    BIGSERIAL    PRIMARY KEY,
    outlet_id             BIGINT       NOT NULL REFERENCES core.outlet(id),
    product_category_code VARCHAR(64),
    rate_pct              NUMERIC(5,4) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 1),
    inclusive             BOOLEAN      NOT NULL DEFAULT true,
    effective_from        DATE         NOT NULL DEFAULT CURRENT_DATE,
    effective_to          DATE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_rule_outlet_category_date
    ON core.tax_rule (outlet_id, COALESCE(product_category_code, ''), effective_from);

CREATE INDEX IF NOT EXISTS idx_tax_rule_outlet_effective
    ON core.tax_rule (outlet_id, effective_from, effective_to);

COMMENT ON TABLE core.tax_rule IS
    'VAT/tax rates per outlet and product category. Edge pulls this table to compute line-item tax locally.';
