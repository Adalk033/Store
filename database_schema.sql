-- store-internal database schema (SQLite)
-- Run this file to create the database structure from scratch.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- 1. Categories
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    parent_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- 2. Products
CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode         TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    cost_price      REAL NOT NULL,
    margin_percent  REAL NOT NULL DEFAULT 0,
    sale_price      REAL GENERATED ALWAYS AS (
                        ROUND(cost_price * (1 + margin_percent / 100.0), 2)
                    ) STORED,
    stock           INTEGER NOT NULL DEFAULT 0,
    min_stock       INTEGER NOT NULL DEFAULT 5,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- 3. Customers
CREATE TABLE IF NOT EXISTS customers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    phone       TEXT,
    email       TEXT,
    notes       TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- 4. Cash register periods
CREATE TABLE IF NOT EXISTS cash_register_periods (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    period_name             TEXT NOT NULL,
    start_date              TEXT NOT NULL,
    end_date                TEXT,
    opening_cash            REAL DEFAULT 0,
    total_cash_sales        REAL DEFAULT 0,
    total_credit_sales      REAL DEFAULT 0,
    total_credit_collected  REAL DEFAULT 0,
    total_expenses          REAL DEFAULT 0,
    closing_cash            REAL,
    status                  TEXT CHECK(status IN ('open','closed')) DEFAULT 'open',
    version                 INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT DEFAULT (datetime('now','localtime'))
);

-- 5. Sales
CREATE TABLE IF NOT EXISTS sales (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_type         TEXT NOT NULL CHECK(sale_type IN ('cash','credit')),
    customer_id       INTEGER REFERENCES customers(id),
    subtotal          REAL NOT NULL,
    surcharge         REAL DEFAULT 0,
    total             REAL NOT NULL,
    cash_received     REAL,
    cash_change       REAL,
    cash_register_id  INTEGER REFERENCES cash_register_periods(id),
    idempotency_key   TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sales_type ON sales(sale_type);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency ON sales(idempotency_key);

-- 6. Sale items
CREATE TABLE IF NOT EXISTS sale_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    INTEGER NOT NULL,
    unit_price  REAL NOT NULL,
    line_total  REAL GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- 7. Credits
CREATE TABLE IF NOT EXISTS credits (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id             INTEGER UNIQUE NOT NULL REFERENCES sales(id),
    customer_id         INTEGER NOT NULL REFERENCES customers(id),
    original_amount     REAL NOT NULL,
    due_date            TEXT NOT NULL,
    surcharge_percent   REAL NOT NULL DEFAULT 0,
    surcharge_applied   INTEGER DEFAULT 0,
    total_due           REAL NOT NULL,
    amount_paid         REAL DEFAULT 0,
    status              TEXT CHECK(status IN ('pending','overdue','paid'))
                            DEFAULT 'pending',
    paid_at             TEXT,
    created_at          TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status);
CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(customer_id);

-- 8. Credit payments
CREATE TABLE IF NOT EXISTS credit_payments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_id         INTEGER NOT NULL REFERENCES credits(id),
    amount            REAL NOT NULL,
    cash_register_id  INTEGER REFERENCES cash_register_periods(id),
    idempotency_key   TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_payments_idempotency ON credit_payments(idempotency_key);

-- 9. Inventory movements
CREATE TABLE IF NOT EXISTS inventory_movements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    type          TEXT NOT NULL CHECK(type IN ('in','out','adjustment')),
    quantity      INTEGER NOT NULL,
    reference_id  INTEGER,
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id);

-- 10. Cash movements
CREATE TABLE IF NOT EXISTS cash_movements (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    cash_register_id  INTEGER NOT NULL REFERENCES cash_register_periods(id),
    type              TEXT NOT NULL CHECK(type IN ('expense','withdrawal','deposit')),
    amount            REAL NOT NULL,
    description       TEXT,
    idempotency_key   TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_idempotency ON cash_movements(idempotency_key);

-- 11. Settings
CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('store_name', 'Mi Papeleria'),
    ('store_address', ''),
    ('store_phone', ''),
    ('default_credit_days', '5'),
    ('default_surcharge_percent', '10'),
    ('default_margin_percent', '50'),
    ('ticket_footer_text', 'Gracias por su compra!'),
    ('last_active_page', 'products'),
    ('sales_rows_per_page', '15'),
    ('feature_paginated_cash', '0'),
    ('feature_paginated_sales', '1'),
    ('feature_paginated_inventory', '1'),
    ('feature_paginated_credits', '1'),
    ('feature_paginated_customers', '1'),
    ('feature_paginated_products', '0'),
    ('feature_paginated_reports', '0');

-- Trigger to keep updated_at in products updated
CREATE TRIGGER IF NOT EXISTS trg_products_updated_at
AFTER UPDATE ON products
BEGIN
    UPDATE products
    SET updated_at = datetime('now','localtime')
    WHERE id = NEW.id;
END;

-- 12. Data versions (Phase 5 - cache invalidation)
CREATE TABLE IF NOT EXISTS data_versions (
    module      TEXT PRIMARY KEY,
    version     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO data_versions (module, version) VALUES
    ('cash', 0),
    ('sales', 0),
    ('inventory', 0),
    ('credits', 0),
    ('customers', 0),
    ('products', 0);

-- Scalability indices
CREATE INDEX IF NOT EXISTS idx_sales_cash_register_date ON sales(cash_register_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_payments_cash_register_date ON credit_payments(cash_register_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_cash_register_date ON cash_movements(cash_register_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_credits_customer_status_due ON credits(customer_id, status, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_customers_active_name ON customers(is_active, name);
CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);

COMMIT;
