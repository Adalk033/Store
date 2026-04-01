-- store-internal database schema (PostgreSQL)
-- Use with psql on AWS RDS PostgreSQL

BEGIN;

-- 1. Categories
CREATE TABLE IF NOT EXISTS categories (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Products
CREATE TABLE IF NOT EXISTS products (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    barcode         TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    category_id     BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    cost_price      NUMERIC(12,2) NOT NULL,
    margin_percent  NUMERIC(6,2) NOT NULL DEFAULT 0,
    sale_price      NUMERIC(12,2) GENERATED ALWAYS AS (
                        ROUND((cost_price * (1 + margin_percent / 100.0)), 2)
                    ) STORED,
    stock           NUMERIC(12,3) NOT NULL DEFAULT 0,
    min_stock       NUMERIC(12,3) NOT NULL DEFAULT 5,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- 3. Customers
CREATE TABLE IF NOT EXISTS customers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    phone       TEXT,
    email       TEXT,
    notes       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Cash register periods
CREATE TABLE IF NOT EXISTS cash_register_periods (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_name             TEXT NOT NULL,
    start_date              DATE NOT NULL,
    end_date                DATE,
    opening_cash            NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_cash_sales        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_credit_sales      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_credit_collected  NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_expenses          NUMERIC(12,2) NOT NULL DEFAULT 0,
    closing_cash            NUMERIC(12,2),
    status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    version                 INTEGER NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Sales
CREATE TABLE IF NOT EXISTS sales (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_type         TEXT NOT NULL CHECK (sale_type IN ('cash','credit')),
    customer_id       BIGINT REFERENCES customers(id),
    subtotal          NUMERIC(12,2) NOT NULL,
    surcharge         NUMERIC(12,2) NOT NULL DEFAULT 0,
    total             NUMERIC(12,2) NOT NULL,
    cash_received     NUMERIC(12,2),
    cash_change       NUMERIC(12,2),
    cash_register_id  BIGINT REFERENCES cash_register_periods(id),
    idempotency_key   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_type ON sales(sale_type);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency
  ON sales(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 6. Sale items
CREATE TABLE IF NOT EXISTS sale_items (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id  BIGINT NOT NULL REFERENCES products(id),
    quantity    NUMERIC(12,3) NOT NULL,
    unit_price  NUMERIC(12,2) NOT NULL,
    line_total  NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- 7. Credits
CREATE TABLE IF NOT EXISTS credits (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_id             BIGINT UNIQUE NOT NULL REFERENCES sales(id),
    customer_id         BIGINT NOT NULL REFERENCES customers(id),
    original_amount     NUMERIC(12,2) NOT NULL,
    due_date            DATE NOT NULL,
    surcharge_percent   NUMERIC(6,2) NOT NULL DEFAULT 0,
    surcharge_applied   INTEGER NOT NULL DEFAULT 0 CHECK (surcharge_applied IN (0,1)),
    total_due           NUMERIC(12,2) NOT NULL,
    amount_paid         NUMERIC(12,2) NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','overdue','paid')),
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status);
CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(customer_id);

-- 8. Credit payments
CREATE TABLE IF NOT EXISTS credit_payments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    credit_id         BIGINT NOT NULL REFERENCES credits(id),
    amount            NUMERIC(12,2) NOT NULL,
    cash_register_id  BIGINT REFERENCES cash_register_periods(id),
    idempotency_key   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_payments_idempotency
  ON credit_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 9. Inventory movements
CREATE TABLE IF NOT EXISTS inventory_movements (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id    BIGINT NOT NULL REFERENCES products(id),
    type          TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
    quantity      NUMERIC(12,3) NOT NULL,
    reference_id  BIGINT,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id);

-- 10. Cash movements
CREATE TABLE IF NOT EXISTS cash_movements (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_register_id  BIGINT NOT NULL REFERENCES cash_register_periods(id),
    type              TEXT NOT NULL CHECK (type IN ('expense','withdrawal','deposit')),
    amount            NUMERIC(12,2) NOT NULL,
    description       TEXT,
    idempotency_key   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_idempotency
  ON cash_movements(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 11. Settings
CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT
);

INSERT INTO settings (key, value) VALUES
    ('store_name', 'Mi Papeleria'),
    ('store_address', ''),
    ('store_phone', ''),
    ('default_credit_days', '5'),
    ('default_surcharge_percent', '10'),
    ('default_margin_percent', '50'),
    ('aws_enabled', '1'),
    ('aws_env', 'prod'),
    ('aws_region', ''),
    ('aws_api_base_url', ''),
    ('aws_timeout_ms', '5000'),
    ('aws_retry_max', '2'),
    ('ticket_footer_text', 'Gracias por su compra!'),
    ('last_active_page', 'products'),
    ('sales_rows_per_page', '15'),
    ('feature_paginated_cash', '0'),
    ('feature_paginated_sales', '1'),
    ('feature_paginated_inventory', '1'),
    ('feature_paginated_credits', '1'),
    ('feature_paginated_customers', '1'),
    ('feature_paginated_products', '1'),
    ('feature_paginated_reports', '1')
ON CONFLICT (key) DO NOTHING;

-- Trigger to keep updated_at in products updated
CREATE OR REPLACE FUNCTION trg_products_updated_at_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION trg_products_updated_at_fn();

-- 12. Data versions
CREATE TABLE IF NOT EXISTS data_versions (
    module      TEXT PRIMARY KEY,
    version     INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO data_versions (module, version) VALUES
    ('cash', 0),
    ('sales', 0),
    ('inventory', 0),
    ('credits', 0),
    ('customers', 0),
    ('products', 0)
ON CONFLICT (module) DO NOTHING;

-- Scalability indices
CREATE INDEX IF NOT EXISTS idx_sales_cash_register_date ON sales(cash_register_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_payments_cash_register_date ON credit_payments(cash_register_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_cash_register_date ON cash_movements(cash_register_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credits_customer_status_due ON credits(customer_id, status, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_customers_active_name ON customers(is_active, name);
CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);

COMMIT;
