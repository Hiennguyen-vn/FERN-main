-- Minimal schema for OrgSyncRepository integration tests.
-- Only tables required by OrgSyncRepository SQL — no FK chains to unrelated tables.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE core.region (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  parent_region_id BIGINT REFERENCES core.region(id),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'VND',
  name VARCHAR(150) NOT NULL,
  timezone_name VARCHAR(100) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.outlet (
  id BIGINT PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES core.region(id),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.app_user (
  id BIGINT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL DEFAULT 'x',
  full_name VARCHAR(150) NOT NULL DEFAULT 'Test User',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.role (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.user_role (
  user_id BIGINT NOT NULL REFERENCES core.app_user(id),
  role_code VARCHAR(50) NOT NULL REFERENCES core.role(code),
  outlet_id BIGINT NOT NULL REFERENCES core.outlet(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_code, outlet_id)
);
