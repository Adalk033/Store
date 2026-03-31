import { getDatabase } from '../connection';

export function runMigrations(): void {
  const db = getDatabase();

  db.exec(`
    -- 1. Categories (tree with parent_id)
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

    -- 3. Customers (credit only)
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
        created_at        TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_sales_type ON sales(sale_type);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);

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
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_id   INTEGER NOT NULL REFERENCES credits(id),
        amount      REAL NOT NULL,
        created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

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
        created_at        TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 11. Settings (key-value)
    CREATE TABLE IF NOT EXISTS settings (
        key     TEXT PRIMARY KEY,
        value   TEXT
    );

    -- Default settings
    INSERT OR IGNORE INTO settings (key, value) VALUES
        ('store_name', 'Mi Papeleria'),
        ('store_address', ''),
        ('store_phone', ''),
        ('default_credit_days', '5'),
        ('default_surcharge_percent', '10'),
        ('default_margin_percent', '50'),
        ('ticket_footer_text', 'Gracias por su compra!'),
        ('last_active_page', 'products'),
        ('sales_rows_per_page', '15');
  `);

  // Trigger for updated_at on products (CREATE TRIGGER IF NOT EXISTS not supported in all SQLite versions)
  const triggerExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_products_updated_at'"
  ).get();

  if (!triggerExists) {
    db.exec(`
      CREATE TRIGGER trg_products_updated_at
      AFTER UPDATE ON products
      BEGIN
          UPDATE products SET updated_at = datetime('now','localtime')
          WHERE id = NEW.id;
      END;
    `);
  }

    const creditPaymentColumns = db
        .prepare("PRAGMA table_info('credit_payments')")
        .all() as Array<{ name: string }>;
    const hasCreditPaymentCashRegisterId = creditPaymentColumns.some(column => column.name === 'cash_register_id');

    if (!hasCreditPaymentCashRegisterId) {
        db.exec('ALTER TABLE credit_payments ADD COLUMN cash_register_id INTEGER REFERENCES cash_register_periods(id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_credit_payments_cash_register ON credit_payments(cash_register_id)');
    }

    const salesColumns = db
        .prepare("PRAGMA table_info('sales')")
        .all() as Array<{ name: string }>;
    const hasCashReceived = salesColumns.some(column => column.name === 'cash_received');
    const hasCashChange = salesColumns.some(column => column.name === 'cash_change');

    if (!hasCashReceived) {
        db.exec('ALTER TABLE sales ADD COLUMN cash_received REAL');
    }

    if (!hasCashChange) {
        db.exec('ALTER TABLE sales ADD COLUMN cash_change REAL');
    }

  console.log('Database migrations completed successfully');
}
