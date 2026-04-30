-- V67: F&B void/comp reason taxonomy + manager approval audit chain.
-- Replace free-text void reason with structured codes; require manager approval
-- for high-risk reasons (comp, employee meal). Persist approval chain for audit.

CREATE TABLE IF NOT EXISTS core.void_reason (
  code                          TEXT PRIMARY KEY,
  label                         TEXT NOT NULL,
  description                   TEXT,
  requires_manager_approval     BOOLEAN NOT NULL DEFAULT false,
  reverses_inventory            BOOLEAN NOT NULL DEFAULT true,
  category                      TEXT NOT NULL CHECK (category IN ('CUSTOMER','OPERATIONAL','COMPLIANCE','FINANCIAL')),
  active                        BOOLEAN NOT NULL DEFAULT true,
  sort_order                    INTEGER NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO core.void_reason (code, label, description, requires_manager_approval, reverses_inventory, category, sort_order) VALUES
  ('CUSTOMER_REFUSED',       'Khách từ chối',           'Khách hủy trước khi nhận hàng',                     false, true,  'CUSTOMER',    10),
  ('ORDER_MISTAKE',          'Sai order',               'Cashier hoặc khách nhập sai',                       false, true,  'OPERATIONAL', 20),
  ('KITCHEN_ERROR',          'Lỗi bếp',                 'Bếp làm sai món, hỏng món',                         false, true,  'OPERATIONAL', 30),
  ('COMPLAINT_RECOVERY',     'Bồi thường khiếu nại',    'Tặng để giữ khách sau phàn nàn',                    true,  false, 'CUSTOMER',    40),
  ('MANAGER_COMP',           'Quản lý tặng',            'Manager comp cho khách VIP/promo',                  true,  false, 'FINANCIAL',   50),
  ('EMPLOYEE_MEAL',          'Suất ăn nhân viên',       'Nhân viên dùng theo policy',                        true,  true,  'OPERATIONAL', 60),
  ('SPOILAGE',               'Hư hỏng',                 'Hàng hỏng trong quá trình phục vụ',                 false, false, 'OPERATIONAL', 70),
  ('TRAINING',               'Huấn luyện',              'Order test cho training/onboarding',                true,  false, 'OPERATIONAL', 80),
  ('SYSTEM_ERROR',           'Lỗi hệ thống',            'Duplicate order, payment fail mid-tx',              false, true,  'COMPLIANCE',  90),
  ('PRICE_OVERRIDE_VOID',    'Hủy do override giá',     'Cancel khi override không được chấp thuận',        true,  true,  'COMPLIANCE',  100)
ON CONFLICT (code) DO NOTHING;

GRANT SELECT ON core.void_reason TO fern_app;
