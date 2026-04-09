CREATE SCHEMA IF NOT EXISTS core;

SET search_path TO core, public;

/* =========================================================
   ENUMS
   ========================================================= */

CREATE TYPE gender_enum AS ENUM (
  'male',
  'female',
  'other',
  'unknown'
);

CREATE TYPE user_status_enum AS ENUM (
  'active',
  'inactive',
  'locked',
  'suspended'
);

CREATE TYPE role_status_enum AS ENUM (
  'active',
  'inactive'
);

CREATE TYPE location_status_enum AS ENUM (
  'draft',
  'active',
  'inactive',
  'closed'
);

CREATE TYPE shift_schedule_status_enum AS ENUM (
  'scheduled',
  'confirmed',
  'cancelled'
);

CREATE TYPE attendance_status_enum AS ENUM (
  'pending',
  'present',
  'late',
  'absent',
  'leave'
);

CREATE TYPE approval_status_enum AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE employment_type_enum AS ENUM (
  'full_time',
  'part_time',
  'seasonal',
  'contractor'
);

CREATE TYPE salary_type_enum AS ENUM (
  'monthly',
  'daily',
  'hourly'
);

CREATE TYPE contract_status_enum AS ENUM (
  'draft',
  'active',
  'expired',
  'terminated'
);

CREATE TYPE product_status_enum AS ENUM (
  'draft',
  'active',
  'inactive',
  'discontinued'
);

CREATE TYPE supplier_status_enum AS ENUM (
  'active',
  'inactive',
  'suspended'
);

CREATE TYPE order_type_enum AS ENUM (
  'dine_in',
  'takeaway',
  'delivery',
  'online'
);

CREATE TYPE sale_order_status_enum AS ENUM (
  'open',
  'completed',
  'cancelled',
  'refunded',
  'partially_refunded',
  'voided'
);

CREATE TYPE payment_status_enum AS ENUM (
  'unpaid',
  'partially_paid',
  'paid',
  'refunded'
);

CREATE TYPE payment_method_enum AS ENUM (
  'cash',
  'card',
  'ewallet',
  'bank_transfer',
  'cheque',
  'voucher'
);

CREATE TYPE payment_txn_status_enum AS ENUM (
  'pending',
  'success',
  'failed',
  'cancelled',
  'refunded'
);

CREATE TYPE supplier_payment_status_enum AS ENUM (
  'pending',
  'posted',
  'cancelled',
  'reversed'
);

CREATE TYPE po_status_enum AS ENUM (
  'draft',
  'submitted',
  'approved',
  'ordered',
  'partially_received',
  'completed',
  'closed',
  'cancelled'
);

CREATE TYPE po_item_status_enum AS ENUM (
  'open',
  'partially_received',
  'completed',
  'cancelled'
);

CREATE TYPE receipt_status_enum AS ENUM (
  'draft',
  'received',
  'posted',
  'cancelled'
);

CREATE TYPE supplier_invoice_status_enum AS ENUM (
  'draft',
  'received',
  'matched',
  'approved',
  'posted',
  'disputed',
  'cancelled'
);

CREATE TYPE supplier_invoice_line_type_enum AS ENUM (
  'stock',
  'partial_match',
  'non_po_receipt',
  'non_stock'
);

CREATE TYPE inventory_txn_type_enum AS ENUM (
  'purchase_in',
  'sale_usage',
  'waste_out',
  'stock_adjustment_in',
  'stock_adjustment_out',
  'manufacture_in',
  'manufacture_out'
);

CREATE TYPE stock_count_status_enum AS ENUM (
  'draft',
  'counting',
  'submitted',
  'approved',
  'posted',
  'cancelled'
);

CREATE TYPE payroll_status_enum AS ENUM (
  'draft',
  'approved',
  'rejected',
  'paid',
  'cancelled'
);

CREATE TYPE pos_session_status_enum AS ENUM (
  'open',
  'closed',
  'reconciled',
  'cancelled'
);

CREATE TYPE promo_type_enum AS ENUM (
  'percentage',
  'fixed_amount',
  'buy_x_get_y',
  'combo_price',
  'subsidy'
);

CREATE TYPE promo_status_enum AS ENUM (
  'draft',
  'active',
  'inactive',
  'expired',
  'cancelled'
);

CREATE TYPE audit_action_enum AS ENUM (
  'insert',
  'update',
  'delete',
  'approve',
  'reject',
  'post',
  'cancel',
  'login',
  'logout'
);

CREATE TYPE item_status_enum AS ENUM (
  'active',
  'inactive',
  'discontinued'
);

CREATE TYPE recipe_status_enum AS ENUM (
  'draft',
  'active',
  'archived'
);

CREATE TYPE expense_source_type_enum AS ENUM (
  'inventory_purchase',
  'operating_expense',
  'payroll',
  'other'
);

/* =========================================================
   HELPER FUNCTIONS
   ========================================================= */

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION core.apply_stock_delta(
  p_outlet_id BIGINT,
  p_item_id BIGINT,
  p_qty_delta NUMERIC(18,4),
  p_unit_cost NUMERIC(18,4),
  p_last_count_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO core.stock_balance (
    location_id,
    item_id,
    qty_on_hand,
    unit_cost,
    last_count_date,
    updated_at
  )
  VALUES (
    p_outlet_id,
    p_item_id,
    p_qty_delta,
    p_unit_cost,
    p_last_count_date,
    NOW()
  )
  ON CONFLICT (location_id, item_id)
  DO UPDATE SET
    qty_on_hand = core.stock_balance.qty_on_hand + EXCLUDED.qty_on_hand,
    unit_cost = COALESCE(EXCLUDED.unit_cost, core.stock_balance.unit_cost),
    last_count_date = COALESCE(EXCLUDED.last_count_date, core.stock_balance.last_count_date),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION core.sync_stock_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM core.apply_stock_delta(
      NEW.outlet_id,
      NEW.item_id,
      NEW.qty_change,
      NEW.unit_cost,
      NULL
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM core.apply_stock_delta(
      OLD.outlet_id,
      OLD.item_id,
      OLD.qty_change * -1,
      NULL,
      NULL
    );

    PERFORM core.apply_stock_delta(
      NEW.outlet_id,
      NEW.item_id,
      NEW.qty_change,
      NEW.unit_cost,
      NULL
    );
    RETURN NEW;
  END IF;

  PERFORM core.apply_stock_delta(
    OLD.outlet_id,
    OLD.item_id,
    OLD.qty_change * -1,
    NULL,
    NULL
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION core.check_supplier_invoice_has_receipts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'supplier_invoice' THEN
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.id;
    ELSE
      v_invoice_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.invoice_id;
    ELSE
      v_invoice_id := NEW.invoice_id;
    END IF;
  END IF;

  IF v_invoice_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.supplier_invoice si
    WHERE si.id = v_invoice_id
      AND NOT EXISTS (
        SELECT 1
        FROM core.supplier_invoice_receipt sir
        WHERE sir.invoice_id = si.id
      )
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'supplier_invoice %s must be linked to at least one goods_receipt',
        v_invoice_id
      );
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION core.check_supplier_invoice_receipt_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'supplier_invoice' THEN
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.id;
    ELSE
      v_invoice_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.invoice_id;
    ELSE
      v_invoice_id := NEW.invoice_id;
    END IF;
  END IF;

  IF v_invoice_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.supplier_invoice_receipt sir
    JOIN core.supplier_invoice si
      ON si.id = sir.invoice_id
    JOIN core.goods_receipt gr
      ON gr.id = sir.receipt_id
    JOIN core.purchase_order po
      ON po.id = gr.po_id
    WHERE sir.invoice_id = v_invoice_id
      AND (
        si.supplier_id <> po.supplier_id
        OR si.currency_code <> gr.currency_code
      )
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'supplier_invoice %s has receipt links with mismatched supplier or currency',
        v_invoice_id
      );
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION core.check_supplier_payment_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_id BIGINT;
  v_invoice_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'supplier_payment_allocation' THEN
    IF TG_OP = 'DELETE' THEN
      v_payment_id := OLD.payment_id;
      v_invoice_id := OLD.invoice_id;
    ELSIF TG_OP = 'INSERT' THEN
      v_payment_id := NEW.payment_id;
      v_invoice_id := NEW.invoice_id;
    ELSE
      v_payment_id := NEW.payment_id;
      v_invoice_id := NEW.invoice_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_payment' THEN
    v_payment_id := NEW.id;
    v_invoice_id := NULL;
  ELSE
    v_payment_id := NULL;
    v_invoice_id := NEW.id;
  END IF;

  IF v_payment_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM core.supplier_payment_allocation spa
    JOIN core.supplier_payment sp
      ON sp.id = spa.payment_id
    JOIN core.supplier_invoice si
      ON si.id = spa.invoice_id
    WHERE spa.payment_id = v_payment_id
      AND (
        sp.supplier_id <> si.supplier_id
        OR sp.currency_code <> si.currency_code
      )
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'supplier_payment %s has allocations with mismatched supplier or currency',
        v_payment_id
      );
  END IF;

  IF v_payment_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM core.supplier_payment sp
    JOIN (
      SELECT payment_id, SUM(allocated_amount) AS allocated_total
      FROM core.supplier_payment_allocation
      WHERE payment_id = v_payment_id
      GROUP BY payment_id
    ) sums
      ON sums.payment_id = sp.id
    WHERE sp.id = v_payment_id
      AND sums.allocated_total > sp.amount
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'supplier_payment %s allocations exceed payment amount',
        v_payment_id
      );
  END IF;

  IF v_invoice_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM core.supplier_invoice si
    JOIN (
      SELECT invoice_id, SUM(allocated_amount) AS allocated_total
      FROM core.supplier_payment_allocation
      WHERE invoice_id = v_invoice_id
      GROUP BY invoice_id
    ) sums
      ON sums.invoice_id = si.id
    WHERE si.id = v_invoice_id
      AND sums.allocated_total > si.total_amount
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'supplier_invoice %s allocations exceed invoice total',
        v_invoice_id
      );
  END IF;

  RETURN NULL;
END;
$$;

/* =========================================================
   REFERENCE / ORG
   ========================================================= */

CREATE TABLE core.currency (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(10),
  decimal_places INT NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.region (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  parent_region_id BIGINT REFERENCES core.region(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  name VARCHAR(150) NOT NULL,
  tax_code VARCHAR(50),
  timezone_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_region_not_self_parent CHECK (
    parent_region_id IS NULL OR parent_region_id <> id
  )
);

CREATE INDEX idx_region_parent_region_id ON core.region(parent_region_id);
CREATE INDEX idx_region_name ON core.region(name);

CREATE TABLE core.exchange_rate (
  from_currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  to_currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  rate NUMERIC(20,8) NOT NULL CHECK (rate > 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_currency_code, to_currency_code, effective_from),
  CONSTRAINT chk_exchange_rate_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT chk_exchange_rate_order CHECK (
    from_currency_code < to_currency_code
  )
);

CREATE INDEX idx_exchange_rate_effective_to
  ON core.exchange_rate(to_currency_code, effective_to);

CREATE TABLE core.outlet (
  id BIGINT PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES core.region(id),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  status location_status_enum NOT NULL DEFAULT 'draft',
  address TEXT,
  phone VARCHAR(30),
  email VARCHAR(150),
  opened_at DATE,
  closed_at DATE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outlet_closed_after_opened CHECK (
    closed_at IS NULL OR opened_at IS NULL OR closed_at >= opened_at
  )
);

CREATE INDEX idx_outlet_region_id ON core.outlet(region_id);
CREATE INDEX idx_outlet_name ON core.outlet(name);
CREATE INDEX idx_outlet_status ON core.outlet(status);

/* =========================================================
   IAM
   ========================================================= */

CREATE TABLE core.role (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  status role_status_enum NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.permission (
  code VARCHAR(100) PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  description TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.role_permission (
  role_code VARCHAR(50) NOT NULL REFERENCES core.role(code),
  permission_code VARCHAR(100) NOT NULL REFERENCES core.permission(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE core.app_user (
  id BIGINT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  employee_code VARCHAR(50) UNIQUE,
  dob DATE,
  gender gender_enum NOT NULL DEFAULT 'unknown',
  national_id VARCHAR(30),
  address TEXT,
  phone VARCHAR(30),
  email VARCHAR(150),
  status user_status_enum NOT NULL DEFAULT 'active',
  password_changed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_app_user_status ON core.app_user(status);
CREATE INDEX idx_app_user_full_name ON core.app_user(full_name);

CREATE TABLE core.user_role (
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  role_code VARCHAR(50) NOT NULL REFERENCES core.role(code),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_code, outlet_id)
);

CREATE INDEX idx_user_role_role_code ON core.user_role(role_code);
CREATE INDEX idx_user_role_outlet_id ON core.user_role(outlet_id);

CREATE TABLE core.user_permission (
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  permission_code VARCHAR(100) NOT NULL REFERENCES core.permission(code),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission_code, outlet_id)
);

CREATE INDEX idx_user_permission_permission_code
  ON core.user_permission(permission_code);
CREATE INDEX idx_user_permission_outlet_id ON core.user_permission(outlet_id);

/* =========================================================
   HR / ATTENDANCE
   ========================================================= */

CREATE TABLE core.shift (
  id BIGINT PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  code VARCHAR(50),
  name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INT NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_shift_end_after_start CHECK (end_time > start_time),
  CONSTRAINT uq_shift_code_per_outlet UNIQUE (outlet_id, code)
);

CREATE INDEX idx_shift_outlet_id ON core.shift(outlet_id);
CREATE INDEX idx_shift_outlet_name ON core.shift(outlet_id, name);

CREATE TABLE core.work_shift (
  id BIGINT PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES core.shift(id),
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  work_date DATE NOT NULL,
  schedule_status shift_schedule_status_enum NOT NULL DEFAULT 'scheduled',
  attendance_status attendance_status_enum NOT NULL DEFAULT 'pending',
  approval_status approval_status_enum NOT NULL DEFAULT 'pending',
  actual_start_time TIMESTAMPTZ,
  actual_end_time TIMESTAMPTZ,
  assigned_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_work_shift_assignment UNIQUE (shift_id, user_id, work_date),
  CONSTRAINT chk_work_shift_actual_range CHECK (
    actual_end_time IS NULL
    OR actual_start_time IS NULL
    OR actual_end_time >= actual_start_time
  )
);

CREATE INDEX idx_work_shift_user_date ON core.work_shift(user_id, work_date);
CREATE INDEX idx_work_shift_shift_date ON core.work_shift(shift_id, work_date);

CREATE TABLE core.employee_contract (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  employment_type employment_type_enum NOT NULL,
  salary_type salary_type_enum NOT NULL,
  base_salary NUMERIC(18,2) NOT NULL CHECK (base_salary >= 0),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  region_code VARCHAR(50) NOT NULL REFERENCES core.region(code),
  tax_code VARCHAR(50),
  bank_account VARCHAR(100),
  hire_date DATE,
  start_date DATE NOT NULL,
  end_date DATE,
  status contract_status_enum NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_employee_contract_end_after_start CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE INDEX idx_employee_contract_user_id ON core.employee_contract(user_id);
CREATE INDEX idx_employee_contract_user_start
  ON core.employee_contract(user_id, start_date DESC);

/* =========================================================
   PRODUCT / CATEGORY / UOM / RECIPE
   ========================================================= */

CREATE TABLE core.product_category (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_category_is_active
  ON core.product_category(is_active);

CREATE TABLE core.item_category (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_item_category_is_active
  ON core.item_category(is_active);

CREATE TABLE core.unit_of_measure (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.uom_conversion (
  from_uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  to_uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  conversion_factor NUMERIC(20,8) NOT NULL CHECK (conversion_factor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_uom_code, to_uom_code),
  CONSTRAINT chk_uom_conversion_not_same CHECK (from_uom_code <> to_uom_code),
  CONSTRAINT chk_uom_conversion_order CHECK (from_uom_code < to_uom_code)
);

CREATE TABLE core.item (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category_code VARCHAR(50) REFERENCES core.item_category(code),
  base_uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  min_stock_level NUMERIC(18,4) CHECK (min_stock_level IS NULL OR min_stock_level >= 0),
  max_stock_level NUMERIC(18,4),
  status item_status_enum NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_item_stock_levels CHECK (
    max_stock_level IS NULL
    OR min_stock_level IS NULL
    OR max_stock_level >= min_stock_level
  )
);

CREATE INDEX idx_item_name ON core.item(name);
CREATE INDEX idx_item_category_code ON core.item(category_code);

CREATE TABLE core.product (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category_code VARCHAR(50) REFERENCES core.product_category(code),
  status product_status_enum NOT NULL DEFAULT 'draft',
  image_url TEXT,
  description TEXT,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  updated_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_category_code ON core.product(category_code);
CREATE INDEX idx_product_status ON core.product(status);
CREATE INDEX idx_product_name ON core.product(name);

CREATE TABLE core.tax_rate (
  region_id BIGINT NOT NULL REFERENCES core.region(id),
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  tax_percent NUMERIC(5,2) NOT NULL CHECK (
    tax_percent >= 0 AND tax_percent <= 100
  ),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_id, product_id, effective_from),
  CONSTRAINT chk_tax_rate_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE INDEX idx_tax_rate_product_id ON core.tax_rate(product_id);

CREATE TABLE core.recipe (
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  version VARCHAR(30) NOT NULL,
  yield_qty NUMERIC(18,4) NOT NULL CHECK (yield_qty > 0),
  yield_uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  status recipe_status_enum NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, version)
);

CREATE INDEX idx_recipe_product_id ON core.recipe(product_id);

CREATE TABLE core.recipe_item (
  product_id BIGINT NOT NULL,
  version VARCHAR(30) NOT NULL,
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  qty NUMERIC(18,4) NOT NULL CHECK (qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, version, item_id),
  CONSTRAINT fk_recipe_item_recipe FOREIGN KEY (product_id, version)
    REFERENCES core.recipe(product_id, version)
);

CREATE INDEX idx_recipe_item_item_id ON core.recipe_item(item_id);

CREATE TABLE core.product_outlet_availability (
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, outlet_id)
);

CREATE INDEX idx_product_outlet_availability_outlet_id
  ON core.product_outlet_availability(outlet_id);

CREATE TABLE core.product_price (
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  price_value NUMERIC(18,2) NOT NULL CHECK (price_value >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  updated_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, outlet_id, effective_from),
  CONSTRAINT chk_product_price_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE INDEX idx_product_price_outlet_id ON core.product_price(outlet_id);
CREATE INDEX idx_product_price_product_outlet_effective_to
  ON core.product_price(product_id, outlet_id, effective_to);

/* =========================================================
   PROCUREMENT
   ========================================================= */

CREATE TABLE core.supplier_procurement (
  id BIGINT PRIMARY KEY,
  region_id BIGINT REFERENCES core.region(id),
  supplier_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  tax_code VARCHAR(50),
  address TEXT,
  phone VARCHAR(30),
  email VARCHAR(150),
  contact_person VARCHAR(150),
  status supplier_status_enum NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_procurement_region_id
  ON core.supplier_procurement(region_id);
CREATE INDEX idx_supplier_procurement_name
  ON core.supplier_procurement(name);
CREATE INDEX idx_supplier_procurement_status
  ON core.supplier_procurement(status);

CREATE TABLE core.purchase_order (
  id BIGINT PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES core.supplier_procurement(id),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  order_date DATE NOT NULL,
  expected_delivery_date DATE,
  expected_total NUMERIC(18,2) CHECK (expected_total IS NULL OR expected_total >= 0),
  status po_status_enum NOT NULL DEFAULT 'draft',
  note TEXT,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_purchase_order_expected_delivery CHECK (
    expected_delivery_date IS NULL OR expected_delivery_date >= order_date
  )
);

CREATE INDEX idx_purchase_order_supplier_id ON core.purchase_order(supplier_id);
CREATE INDEX idx_purchase_order_outlet_id ON core.purchase_order(outlet_id);
CREATE INDEX idx_purchase_order_order_date ON core.purchase_order(order_date);
CREATE INDEX idx_purchase_order_status ON core.purchase_order(status);

CREATE TABLE core.purchase_order_item (
  po_id BIGINT NOT NULL REFERENCES core.purchase_order(id),
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  expected_unit_price NUMERIC(18,4) CHECK (
    expected_unit_price IS NULL OR expected_unit_price >= 0
  ),
  qty_ordered NUMERIC(18,4) NOT NULL CHECK (qty_ordered > 0),
  qty_received NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  status po_item_status_enum NOT NULL DEFAULT 'open',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (po_id, item_id)
);

CREATE INDEX idx_purchase_order_item_item_id
  ON core.purchase_order_item(item_id);
CREATE INDEX idx_purchase_order_item_status
  ON core.purchase_order_item(status);

CREATE TABLE core.goods_receipt (
  id BIGINT PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES core.purchase_order(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  receipt_time TIMESTAMPTZ NOT NULL,
  business_date DATE NOT NULL,
  status receipt_status_enum NOT NULL DEFAULT 'draft',
  note TEXT,
  total_price NUMERIC(18,2) NOT NULL CHECK (total_price >= 0),
  supplier_lot_number VARCHAR(50),
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_goods_receipt_id_po UNIQUE (id, po_id)
);

CREATE INDEX idx_goods_receipt_po_id ON core.goods_receipt(po_id);
CREATE INDEX idx_goods_receipt_business_date ON core.goods_receipt(business_date);
CREATE INDEX idx_goods_receipt_status ON core.goods_receipt(status);

CREATE TABLE core.goods_receipt_item (
  id BIGINT PRIMARY KEY,
  receipt_id BIGINT NOT NULL,
  po_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  uom_code VARCHAR(30) NOT NULL REFERENCES core.unit_of_measure(code),
  qty_received NUMERIC(18,4) NOT NULL CHECK (qty_received > 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  manufacture_date DATE,
  expiry_date DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_goods_receipt_item_receipt FOREIGN KEY (receipt_id, po_id)
    REFERENCES core.goods_receipt(id, po_id),
  CONSTRAINT fk_goods_receipt_item_po FOREIGN KEY (po_id, item_id)
    REFERENCES core.purchase_order_item(po_id, item_id),
  CONSTRAINT chk_goods_receipt_item_dates CHECK (
    expiry_date IS NULL
    OR manufacture_date IS NULL
    OR expiry_date >= manufacture_date
  )
);

CREATE INDEX idx_goods_receipt_item_receipt_id
  ON core.goods_receipt_item(receipt_id);
CREATE INDEX idx_goods_receipt_item_po_item
  ON core.goods_receipt_item(po_id, item_id);
CREATE INDEX idx_goods_receipt_item_item_id ON core.goods_receipt_item(item_id);
CREATE INDEX idx_goods_receipt_item_expiry_date
  ON core.goods_receipt_item(expiry_date);

CREATE TABLE core.supplier_invoice (
  id BIGINT PRIMARY KEY,
  invoice_number VARCHAR(100) NOT NULL,
  supplier_id BIGINT NOT NULL REFERENCES core.supplier_procurement(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  invoice_date DATE NOT NULL,
  due_date DATE,
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status supplier_invoice_status_enum NOT NULL DEFAULT 'draft',
  note TEXT,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_supplier_invoice_number UNIQUE (supplier_id, invoice_number),
  CONSTRAINT chk_supplier_invoice_due_date CHECK (
    due_date IS NULL OR due_date >= invoice_date
  )
);

CREATE INDEX idx_supplier_invoice_supplier_id
  ON core.supplier_invoice(supplier_id);
CREATE INDEX idx_supplier_invoice_invoice_date
  ON core.supplier_invoice(invoice_date);
CREATE INDEX idx_supplier_invoice_due_date ON core.supplier_invoice(due_date);
CREATE INDEX idx_supplier_invoice_status ON core.supplier_invoice(status);

CREATE TABLE core.supplier_invoice_receipt (
  invoice_id BIGINT NOT NULL REFERENCES core.supplier_invoice(id) ON DELETE CASCADE,
  receipt_id BIGINT NOT NULL REFERENCES core.goods_receipt(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invoice_id, receipt_id)
);

CREATE INDEX idx_supplier_invoice_receipt_receipt_id
  ON core.supplier_invoice_receipt(receipt_id);

CREATE TABLE core.supplier_invoice_item (
  invoice_id BIGINT NOT NULL REFERENCES core.supplier_invoice(id) ON DELETE CASCADE,
  line_number INT NOT NULL CHECK (line_number > 0),
  line_type supplier_invoice_line_type_enum NOT NULL,
  goods_receipt_item_id BIGINT REFERENCES core.goods_receipt_item(id),
  description TEXT,
  qty_invoiced NUMERIC(18,4) CHECK (qty_invoiced IS NULL OR qty_invoiced > 0),
  unit_price NUMERIC(18,4) CHECK (unit_price IS NULL OR unit_price >= 0),
  tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (
    tax_percent >= 0 AND tax_percent <= 100
  ),
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invoice_id, line_number)
);

CREATE INDEX idx_supplier_invoice_item_goods_receipt_item_id
  ON core.supplier_invoice_item(goods_receipt_item_id);

CREATE TABLE core.supplier_payment (
  id BIGINT PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES core.supplier_procurement(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  payment_method payment_method_enum NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  status supplier_payment_status_enum NOT NULL DEFAULT 'pending',
  payment_time TIMESTAMPTZ NOT NULL,
  transaction_ref VARCHAR(100),
  note TEXT,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_payment_supplier_id
  ON core.supplier_payment(supplier_id);
CREATE INDEX idx_supplier_payment_payment_time
  ON core.supplier_payment(payment_time);
CREATE INDEX idx_supplier_payment_currency_code
  ON core.supplier_payment(currency_code);
CREATE INDEX idx_supplier_payment_status ON core.supplier_payment(status);

CREATE TABLE core.supplier_payment_allocation (
  payment_id BIGINT NOT NULL REFERENCES core.supplier_payment(id) ON DELETE CASCADE,
  invoice_id BIGINT NOT NULL REFERENCES core.supplier_invoice(id),
  allocated_amount NUMERIC(18,2) NOT NULL CHECK (allocated_amount > 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (payment_id, invoice_id)
);

CREATE INDEX idx_supplier_payment_allocation_invoice_id
  ON core.supplier_payment_allocation(invoice_id);

/* =========================================================
   SALES / POS
   ========================================================= */

CREATE TABLE core.pos_session (
  id BIGINT PRIMARY KEY,
  session_code VARCHAR(100) NOT NULL UNIQUE,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  manager_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  business_date DATE NOT NULL,
  status pos_session_status_enum NOT NULL DEFAULT 'open',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pos_session_closed_after_opened CHECK (
    closed_at IS NULL OR closed_at >= opened_at
  )
);

CREATE INDEX idx_pos_session_outlet_id ON core.pos_session(outlet_id);
CREATE INDEX idx_pos_session_business_date ON core.pos_session(business_date);
CREATE INDEX idx_pos_session_status ON core.pos_session(status);

CREATE TABLE core.sale_record (
  id BIGINT PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  pos_session_id BIGINT REFERENCES core.pos_session(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  order_type order_type_enum NOT NULL DEFAULT 'dine_in',
  status sale_order_status_enum NOT NULL DEFAULT 'open',
  payment_status payment_status_enum NOT NULL DEFAULT 'unpaid',
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sale_record_discount CHECK (discount <= subtotal),
  CONSTRAINT chk_sale_record_total CHECK (
    total_amount = subtotal - discount + tax_amount
  )
);

CREATE INDEX idx_sale_record_outlet_id ON core.sale_record(outlet_id);
CREATE INDEX idx_sale_record_pos_session_id ON core.sale_record(pos_session_id);
CREATE INDEX idx_sale_record_status ON core.sale_record(status);
CREATE INDEX idx_sale_record_order_type ON core.sale_record(order_type);
CREATE INDEX idx_sale_record_created_at ON core.sale_record(created_at);
CREATE INDEX brin_sale_record_created_at
  ON core.sale_record USING BRIN(created_at);

CREATE TABLE core.payment (
  sale_id BIGINT PRIMARY KEY REFERENCES core.sale_record(id) ON DELETE CASCADE,
  pos_session_id BIGINT REFERENCES core.pos_session(id),
  payment_method payment_method_enum NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  status payment_txn_status_enum NOT NULL DEFAULT 'pending',
  payment_time TIMESTAMPTZ NOT NULL,
  transaction_ref VARCHAR(100),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_pos_session_id ON core.payment(pos_session_id);
CREATE INDEX idx_payment_payment_method ON core.payment(payment_method);
CREATE INDEX idx_payment_payment_time ON core.payment(payment_time);
CREATE INDEX idx_payment_status ON core.payment(status);

CREATE TABLE core.sale_item (
  sale_id BIGINT NOT NULL REFERENCES core.sale_record(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES core.product(id),
  unit_price NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  qty NUMERIC(18,4) NOT NULL CHECK (qty > 0),
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total NUMERIC(18,2) NOT NULL CHECK (line_total >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sale_id, product_id)
);

CREATE INDEX idx_sale_item_product_id ON core.sale_item(product_id);

CREATE TABLE core.promotion (
  id BIGINT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  promo_type promo_type_enum NOT NULL,
  status promo_status_enum NOT NULL DEFAULT 'draft',
  value_amount NUMERIC(18,2) CHECK (value_amount IS NULL OR value_amount >= 0),
  value_percent NUMERIC(8,4) CHECK (
    value_percent IS NULL OR (value_percent >= 0 AND value_percent <= 100)
  ),
  min_order_amount NUMERIC(18,2) CHECK (
    min_order_amount IS NULL OR min_order_amount >= 0
  ),
  max_discount_amount NUMERIC(18,2) CHECK (
    max_discount_amount IS NULL OR max_discount_amount >= 0
  ),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_promotion_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE TABLE core.promotion_scope (
  promotion_id BIGINT NOT NULL REFERENCES core.promotion(id) ON DELETE CASCADE,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (promotion_id, outlet_id)
);

CREATE TABLE core.sale_item_promotion (
  sale_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  promotion_id BIGINT NOT NULL REFERENCES core.promotion(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sale_id, product_id, promotion_id),
  CONSTRAINT fk_sale_item_promotion_sale_item FOREIGN KEY (sale_id, product_id)
    REFERENCES core.sale_item(sale_id, product_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_sale_item_promotion_promotion_id
  ON core.sale_item_promotion(promotion_id);

/* =========================================================
   INVENTORY
   ========================================================= */

CREATE TABLE core.stock_balance (
  location_id BIGINT NOT NULL REFERENCES core.outlet(id),
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  qty_on_hand NUMERIC(18,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18,4),
  last_count_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, item_id)
);

CREATE INDEX idx_stock_balance_item_id ON core.stock_balance(item_id);

CREATE TABLE core.manufacturing_batch (
  id BIGINT PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  reference_code VARCHAR(100) NOT NULL UNIQUE,
  business_date DATE NOT NULL,
  note TEXT,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_manufacturing_batch_outlet_id
  ON core.manufacturing_batch(outlet_id);
CREATE INDEX idx_manufacturing_batch_business_date
  ON core.manufacturing_batch(business_date);

CREATE TABLE core.stock_count_session (
  id BIGINT PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES core.outlet(id),
  count_date DATE NOT NULL,
  status stock_count_status_enum NOT NULL DEFAULT 'draft',
  note TEXT,
  counted_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_count_session_location_id
  ON core.stock_count_session(location_id);
CREATE INDEX idx_stock_count_session_count_date
  ON core.stock_count_session(count_date);
CREATE INDEX idx_stock_count_session_status
  ON core.stock_count_session(status);

CREATE TABLE core.stock_count_line (
  id BIGINT PRIMARY KEY,
  stock_count_session_id BIGINT NOT NULL REFERENCES core.stock_count_session(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  system_qty NUMERIC(18,4) NOT NULL,
  actual_qty NUMERIC(18,4) NOT NULL CHECK (actual_qty >= 0),
  variance_qty NUMERIC(18,4) GENERATED ALWAYS AS (actual_qty - system_qty) STORED,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stock_count_line UNIQUE (stock_count_session_id, item_id)
);

CREATE INDEX idx_stock_count_line_item_id ON core.stock_count_line(item_id);

CREATE TABLE core.inventory_transaction (
  id BIGINT PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  item_id BIGINT NOT NULL REFERENCES core.item(id),
  qty_change NUMERIC(18,4) NOT NULL,
  CONSTRAINT chk_inventory_txn_sign CHECK (
    CASE
      WHEN txn_type IN ('purchase_in','stock_adjustment_in','manufacture_in')
        THEN qty_change > 0
      WHEN txn_type IN ('sale_usage','waste_out','stock_adjustment_out','manufacture_out')
        THEN qty_change < 0
    END
  ),
  business_date DATE NOT NULL,
  txn_time TIMESTAMPTZ NOT NULL,
  txn_type inventory_txn_type_enum NOT NULL,
  unit_cost NUMERIC(18,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_transaction_outlet_id
  ON core.inventory_transaction(outlet_id);
CREATE INDEX idx_inventory_transaction_item_id
  ON core.inventory_transaction(item_id);
CREATE INDEX idx_inventory_transaction_business_date
  ON core.inventory_transaction(business_date);
CREATE INDEX idx_inventory_transaction_txn_type
  ON core.inventory_transaction(txn_type);
CREATE INDEX idx_inventory_transaction_outlet_item_time
  ON core.inventory_transaction(outlet_id, item_id, txn_time);
CREATE INDEX brin_inventory_transaction_txn_time
  ON core.inventory_transaction USING BRIN(txn_time);

CREATE TABLE core.waste_record (
  inventory_transaction_id BIGINT PRIMARY KEY
    REFERENCES core.inventory_transaction(id) ON DELETE CASCADE,
  reason VARCHAR(255) NOT NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL
);

CREATE TABLE core.goods_receipt_transaction (
  inventory_transaction_id BIGINT PRIMARY KEY
    REFERENCES core.inventory_transaction(id) ON DELETE CASCADE,
  goods_receipt_item_id BIGINT NOT NULL UNIQUE
    REFERENCES core.goods_receipt_item(id)
);

CREATE TABLE core.sale_item_transaction (
  inventory_transaction_id BIGINT PRIMARY KEY
    REFERENCES core.inventory_transaction(id) ON DELETE CASCADE,
  sale_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  CONSTRAINT fk_sale_item_transaction_sale_item FOREIGN KEY (sale_id, product_id)
    REFERENCES core.sale_item(sale_id, product_id)
);

CREATE INDEX idx_sale_item_transaction_sale_line
  ON core.sale_item_transaction(sale_id, product_id);

CREATE TABLE core.manufacturing_transaction (
  inventory_transaction_id BIGINT PRIMARY KEY
    REFERENCES core.inventory_transaction(id) ON DELETE CASCADE,
  manufacturing_batch_id BIGINT NOT NULL REFERENCES core.manufacturing_batch(id)
);

CREATE INDEX idx_manufacturing_transaction_batch_id
  ON core.manufacturing_transaction(manufacturing_batch_id);

CREATE TABLE core.inventory_adjustment (
  inventory_transaction_id BIGINT PRIMARY KEY
    REFERENCES core.inventory_transaction(id) ON DELETE CASCADE,
  stock_count_line_id BIGINT REFERENCES core.stock_count_line(id),
  reason VARCHAR(255) NOT NULL,
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL
);

/* =========================================================
   FINANCE / PAYROLL
   ========================================================= */

CREATE TABLE core.payroll_period (
  id BIGINT PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES core.region(id),
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pay_date DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_period_region_dates UNIQUE (region_id, start_date, end_date),
  CONSTRAINT chk_payroll_period_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_payroll_period_pay_date CHECK (
    pay_date IS NULL OR pay_date >= end_date
  )
);

CREATE INDEX idx_payroll_period_region_id ON core.payroll_period(region_id);

CREATE TABLE core.payroll_timesheet (
  id BIGINT PRIMARY KEY,
  payroll_period_id BIGINT NOT NULL REFERENCES core.payroll_period(id),
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  outlet_id BIGINT REFERENCES core.outlet(id),
  work_days NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (work_days >= 0),
  work_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (work_hours >= 0),
  overtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  overtime_rate NUMERIC(5,2) NOT NULL DEFAULT 1.5 CHECK (overtime_rate >= 0),
  late_count INT NOT NULL DEFAULT 0 CHECK (late_count >= 0),
  absent_days NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (absent_days >= 0),
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_timesheet_period_user UNIQUE (payroll_period_id, user_id)
);

CREATE INDEX idx_payroll_timesheet_user_id ON core.payroll_timesheet(user_id);

CREATE TABLE core.payroll (
  id BIGINT PRIMARY KEY,
  payroll_timesheet_id BIGINT NOT NULL UNIQUE REFERENCES core.payroll_timesheet(id),
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  base_salary_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (base_salary_amount >= 0),
  net_salary NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (net_salary >= 0),
  status payroll_status_enum NOT NULL DEFAULT 'draft',
  approved_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  payment_ref VARCHAR(100),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payroll_status ON core.payroll(status);

CREATE TABLE core.expense_record (
  id BIGINT PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  business_date DATE NOT NULL,
  currency_code VARCHAR(10) NOT NULL REFERENCES core.currency(code),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  source_type expense_source_type_enum NOT NULL,
  note TEXT,
  created_by_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_record_outlet_id ON core.expense_record(outlet_id);
CREATE INDEX idx_expense_record_business_date
  ON core.expense_record(business_date);
CREATE INDEX idx_expense_record_source_type
  ON core.expense_record(source_type);

CREATE TABLE core.expense_inventory_purchase (
  expense_record_id BIGINT PRIMARY KEY
    REFERENCES core.expense_record(id) ON DELETE CASCADE,
  goods_receipt_id BIGINT NOT NULL UNIQUE
    REFERENCES core.goods_receipt(id)
);

CREATE TABLE core.expense_operating (
  expense_record_id BIGINT PRIMARY KEY
    REFERENCES core.expense_record(id) ON DELETE CASCADE,
  description TEXT NOT NULL
);

CREATE TABLE core.expense_other (
  expense_record_id BIGINT PRIMARY KEY
    REFERENCES core.expense_record(id) ON DELETE CASCADE,
  description TEXT NOT NULL
);

CREATE TABLE core.expense_payroll (
  expense_record_id BIGINT PRIMARY KEY
    REFERENCES core.expense_record(id) ON DELETE CASCADE,
  payroll_id BIGINT NOT NULL UNIQUE REFERENCES core.payroll(id)
);

/* =========================================================
   AUDIT
   ========================================================= */

CREATE TABLE core.audit_log (
  id BIGINT PRIMARY KEY,
  actor_user_id BIGINT REFERENCES core.app_user(id) ON DELETE SET NULL,
  action audit_action_enum NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  reason TEXT,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_actor_user_id ON core.audit_log(actor_user_id);
CREATE INDEX idx_audit_log_action ON core.audit_log(action);
CREATE INDEX idx_audit_log_entity_name ON core.audit_log(entity_name);
CREATE INDEX idx_audit_log_entity_lookup
  ON core.audit_log(entity_name, entity_id);
CREATE INDEX idx_audit_log_created_at ON core.audit_log(created_at);
CREATE INDEX brin_audit_log_created_at
  ON core.audit_log USING BRIN(created_at);

/* =========================================================
   UPDATED_AT TRIGGERS
   ========================================================= */

CREATE TRIGGER trg_currency_updated_at
BEFORE UPDATE ON core.currency
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_region_updated_at
BEFORE UPDATE ON core.region
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_exchange_rate_updated_at
BEFORE UPDATE ON core.exchange_rate
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_outlet_updated_at
BEFORE UPDATE ON core.outlet
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_role_updated_at
BEFORE UPDATE ON core.role
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_permission_updated_at
BEFORE UPDATE ON core.permission
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_app_user_updated_at
BEFORE UPDATE ON core.app_user
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_shift_updated_at
BEFORE UPDATE ON core.shift
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_work_shift_updated_at
BEFORE UPDATE ON core.work_shift
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_employee_contract_updated_at
BEFORE UPDATE ON core.employee_contract
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_product_category_updated_at
BEFORE UPDATE ON core.product_category
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_item_category_updated_at
BEFORE UPDATE ON core.item_category
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_unit_of_measure_updated_at
BEFORE UPDATE ON core.unit_of_measure
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_uom_conversion_updated_at
BEFORE UPDATE ON core.uom_conversion
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_item_updated_at
BEFORE UPDATE ON core.item
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_product_updated_at
BEFORE UPDATE ON core.product
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_tax_rate_updated_at
BEFORE UPDATE ON core.tax_rate
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_recipe_updated_at
BEFORE UPDATE ON core.recipe
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_recipe_item_updated_at
BEFORE UPDATE ON core.recipe_item
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_product_outlet_availability_updated_at
BEFORE UPDATE ON core.product_outlet_availability
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_product_price_updated_at
BEFORE UPDATE ON core.product_price
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_supplier_procurement_updated_at
BEFORE UPDATE ON core.supplier_procurement
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_purchase_order_updated_at
BEFORE UPDATE ON core.purchase_order
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_purchase_order_item_updated_at
BEFORE UPDATE ON core.purchase_order_item
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_goods_receipt_updated_at
BEFORE UPDATE ON core.goods_receipt
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_goods_receipt_item_updated_at
BEFORE UPDATE ON core.goods_receipt_item
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_supplier_invoice_updated_at
BEFORE UPDATE ON core.supplier_invoice
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_supplier_invoice_item_updated_at
BEFORE UPDATE ON core.supplier_invoice_item
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_supplier_payment_updated_at
BEFORE UPDATE ON core.supplier_payment
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_supplier_payment_allocation_updated_at
BEFORE UPDATE ON core.supplier_payment_allocation
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_pos_session_updated_at
BEFORE UPDATE ON core.pos_session
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_sale_record_updated_at
BEFORE UPDATE ON core.sale_record
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_payment_updated_at
BEFORE UPDATE ON core.payment
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_sale_item_updated_at
BEFORE UPDATE ON core.sale_item
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_promotion_updated_at
BEFORE UPDATE ON core.promotion
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_manufacturing_batch_updated_at
BEFORE UPDATE ON core.manufacturing_batch
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_stock_count_session_updated_at
BEFORE UPDATE ON core.stock_count_session
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_stock_count_line_updated_at
BEFORE UPDATE ON core.stock_count_line
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_payroll_period_updated_at
BEFORE UPDATE ON core.payroll_period
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_payroll_timesheet_updated_at
BEFORE UPDATE ON core.payroll_timesheet
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_payroll_updated_at
BEFORE UPDATE ON core.payroll
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_expense_record_updated_at
BEFORE UPDATE ON core.expense_record
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

/* =========================================================
   BUSINESS TRIGGERS
   ========================================================= */

CREATE TRIGGER trg_inventory_transaction_sync_stock_balance
AFTER INSERT OR UPDATE OR DELETE ON core.inventory_transaction
FOR EACH ROW EXECUTE FUNCTION core.sync_stock_balance();

CREATE CONSTRAINT TRIGGER trg_supplier_invoice_has_receipts_invoice
AFTER INSERT OR UPDATE ON core.supplier_invoice
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_invoice_has_receipts();

CREATE CONSTRAINT TRIGGER trg_supplier_invoice_has_receipts_link
AFTER INSERT OR UPDATE OR DELETE ON core.supplier_invoice_receipt
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_invoice_has_receipts();

CREATE CONSTRAINT TRIGGER trg_supplier_invoice_receipt_consistency
AFTER INSERT OR UPDATE OR DELETE ON core.supplier_invoice_receipt
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_invoice_receipt_consistency();

CREATE CONSTRAINT TRIGGER trg_supplier_payment_allocation_check
AFTER INSERT OR UPDATE OR DELETE ON core.supplier_payment_allocation
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_payment_allocations();

CREATE CONSTRAINT TRIGGER trg_supplier_payment_allocation_check_payment
AFTER UPDATE ON core.supplier_payment
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_payment_allocations();

CREATE CONSTRAINT TRIGGER trg_supplier_payment_allocation_check_invoice
AFTER UPDATE ON core.supplier_invoice
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_payment_allocations();

CREATE CONSTRAINT TRIGGER trg_supplier_invoice_receipt_consistency_invoice
AFTER UPDATE ON core.supplier_invoice
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_supplier_invoice_receipt_consistency();
