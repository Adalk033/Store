# AGENTS.md - store-internal POS

## Project Overview

store-internal is a fully local, offline desktop POS (point-of-sale) application for a stationery store. Built with Electron + React + TypeScript + SQLite. Runs on a single PC, single store, no cloud.

### Key Features

- Product catalog with nested categories (parent/child)
- Auto-calculated sale price from cost + margin percentage
- Internal barcode generation per product
- Inventory management (in/out/adjustment movements, low-stock alerts)
- Counter sales (anonymous cash) and credit sales (registered customers)
- Credit system with deadline-based surcharge (one-time price increase if overdue)
- Monthly cash register periods with opening/closing/expense tracking
- Digital tickets (thermal printer support planned)
- Sales reports and statistics with charts

## Tech Stack

- **Runtime**: Electron
- **Frontend**: React 18+ with TypeScript (strict mode)
- **Bundler/Compiler**: Vite (no Babel needed)
- **Database**: SQLite via sqlite3 package
- **Styling**: CSS Modules + BEM naming + global CSS custom properties
- **Barcode**: JsBarcode
- **Charts**: Recharts or Chart.js
- **Tickets**: electron-pos-printer or jsPDF

Do NOT introduce: Tailwind, styled-components, shadcn/ui, any ORM, any additional styling framework.

## Design System

The full design spec lives in `docs/DESIGN.md`. Key tokens are implemented as CSS custom properties in `src/styles/globals.css`. Always reference these variables instead of hardcoding values.

### Color Palette

- Background surface: `--color-bg` = `#F9F9F9`
- Card containers: `--color-card` = `#FFFFFF`
- Primary action / nav: `--color-primary` = `#1A2B3C`
- Text primary: `--color-text` = `#111827`
- Text secondary / labels: `--color-text-secondary` = `#6B7280`
- Borders / lines: `--color-border` = `#E5E7EB`
- Success / high stock: `--color-success` = `#10B981`
- Warning / low stock: `--color-warning` = `#F59E0B`
- Error / no stock: `--color-error` = `#EF4444`

### Typography

- Font: Google Sans (loaded from `/fonts/`)
- H1: 24px SemiBold | H2: 18px Medium | Body: 14-16px Regular | Meta/SKU: 12px Regular

### Spacing & Layout

- Spacing scale: multiples of 8px (8, 16, 24, 32, 48, 64)
- Screen padding: 32px
- Card gap/gutter: 24px

### Components

- Border radius: 12px
- Card border: 1px solid `--color-border`
- Card shadow: `0px 4px 6px -1px rgba(0, 0, 0, 0.05)`
- Primary button: bg `--color-primary`, white text, padding 12px 24px
- Secondary button: transparent bg, 1px border `--color-primary`, text `--color-primary`
- Input focus: 2px ring `--color-primary` at 20% opacity
- Icons: Lucide Icons, stroke 1.5-2px, 20x20px, color `--color-text-secondary`

## Directory Layout
store-internal/

├── electron/

│   ├── main.ts

│   ├── preload.ts

│   └── database/

│       ├── connection.ts

│       ├── migrations/

│       └── repositories/

│           ├── products.ts

│           ├── categories.ts

│           ├── sales.ts

│           ├── credits.ts

│           ├── inventory.ts

│           ├── cashRegister.ts

│           └── settings.ts

├── src/

│   ├── App.tsx

│   ├── components/

│   │   ├── layout/

│   │   ├── pos/

│   │   ├── products/

│   │   ├── inventory/

│   │   ├── credits/

│   │   ├── cashRegister/

│   │   └── reports/

│   ├── hooks/

│   ├── lib/

│   ├── pages/

│   ├── types/

│   └── styles/

│       └── globals.css

├── package.json

├── electron-builder.yml

├── tsconfig.json

└── vite.config.ts


## Conventions

### Naming

| Thing | Convention | Example |
|-------|-----------|--------|
| React components (file + name) | PascalCase | `ProductForm.tsx` |
| Variables, functions, hooks | camelCase | `getProducts`, `useInventory` |
| General folders | camelCase | `hooks/`, `lib/`, `types/` |
| Component folders | PascalCase | `ProductForm/` (only if multi-file component) |
| CSS Module files | Match component | `ProductForm.module.css` |
| CSS classes | BEM | `product-form__input--disabled` |
| DB columns | snake_case | `cost_price`, `due_date` |
| TS interfaces/types | PascalCase | `Product`, `SaleItem` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_MARGIN` |
| Code language | English | All identifiers and comments in English |
| UI text | Spanish | User-facing labels and messages |

### Components

- Functional components only (hooks, no classes).
- Named exports (not default).
- One component per file unless tightly coupled small sub-components.
- Co-locate CSS Module next to its component.

### Styling

- CSS Modules with `.module.css` extension.
- BEM naming inside modules.
- Global variables in `src/styles/globals.css` as CSS custom properties.
- No inline styles unless value is truly dynamic.

### Error Handling

- try/catch around all IPC calls and database operations.
- Always notify the user on error (toast or notification). Never fail silently.
- Error Boundaries at route/page level.
- Console.log errors with context (operation name, relevant data).

### Database

- All DB access in main process only, through repository functions.
- Always use parameterized queries (never concatenate user input).
- `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`
- `products.sale_price` is a GENERATED STORED column. Never INSERT/UPDATE it directly.
- Snapshot `unit_price` into `sale_items` at sale time.

### IPC

- Typed IPC channels defined as constants in a shared file.
- Preload script exposes a typed API.
- Renderer never accesses Node.js or SQLite directly.

## Business Rules

### Pricing

- `sale_price = ROUND(cost_price * (1 + margin_percent / 100), 2)` (computed by SQLite)
- Sale items store a snapshot of the price at the moment of sale

### Credits

- Tied to registered customer
- `due_date` = sale date + configurable days (default from `settings.default_credit_days`)
- If overdue and `surcharge_applied = 0`: `total_due = original_amount * (1 + surcharge_percent/100)`, set `surcharge_applied = 1`, status to `overdue`
- Single surcharge level only (no compounding)
- Partial payments tracked in `credit_payments`; when `amount_paid >= total_due`, status = `paid`
- Surcharge check runs on app startup

### Inventory

- Sale -> automatic `out` movement
- Restocking -> `in` movement
- Corrections -> `adjustment` movement
- `products.stock` updated atomically with every movement
- Visual alert when `stock <= min_stock`

### Cash Register

- One open period at a time (monthly)
- All sales linked to current open period
- On close: auto-calculate totals from actual data
- Manually enter `closing_cash` for reconciliation

## AI Assistant Rules

1. NO emojis in code, comments, or commit messages.
2. NO new libraries without asking first.
3. NO refactoring code that was not part of the request.
4. NO over-engineering. Keep solutions simple and direct.
5. Output COMPLETE files, not diffs or partial snippets.
6. Follow existing patterns in the codebase.
7. Do not add unrequested features.
8. Write useful comments only (explain WHY, not WHAT).
9. Keep the app fully local. No network calls, no cloud services, no analytics.

### Security Principles

- **Always validate user input.** Even though the app is local, all user-entered data must be sanitized and validated before processing. Do not assume that offline data is trustworthy.
- **Parameterize all SQL queries.** Never concatenate values directly into SQL strings. Use prepared statements in every query without exception.
- **Do not store sensitive data in plain text.** If admin credentials are stored (app access password), use secure hashing (bcrypt or argon2). Never store passwords in plain text in SQLite or configuration files.
- **Restrict IPC channels.** Only expose strictly necessary methods in the preload. Do not expose direct access to the database, `fs`, `child_process`, or dangerous OS APIs.
- **Disable Node.js integration in the renderer.** Use `contextIsolation: true` and `nodeIntegration: false` in the BrowserWindow configuration. All communication must go through the preload.
- **Validate data on both sides.** Validate in the renderer (UX) and in the main process (real security). Renderer validation is cosmetic only; the main process validation is what actually protects.
- **Do not trust renderer content.** Treat IPC messages from the renderer as untrusted input. Validate types, ranges, and formats in every main process handler.
- **Protect the database.** Consider SQLite encryption (SQLCipher) if the business handles sensitive financial information. At minimum, ensure the `.db` file is not accessible by other OS users (restrictive file permissions).
- **Content Security Policy (CSP).** Configure a strict CSP in the renderer HTML to prevent script injection. Do not use `unsafe-inline` or `unsafe-eval` unless absolutely necessary.

### Post-Implementation Security Analysis

After every implementation (feature, fix, or significant change), a security analysis must be performed before the task can be considered done.

**Mandatory checklist after every implementation:**

- [ ]  **SQL Injection:** Verify that all new or modified queries use parameterized values (`?`). Look for string concatenations in SQL.
- [ ]  **Input validation:** Confirm that all user input is validated in the main process (types, ranges, max lengths, allowed characters).
- [ ]  **IPC channels:** Review that no unnecessary new channels were exposed. Verify that handlers validate their arguments.
- [ ]  **Renderer permissions:** Confirm that `nodeIntegration` was not enabled, `contextIsolation` was not disabled, and `webSecurity: false` was not added.
- [ ]  **Sensitive data:** Verify that sensitive data (passwords, credit amounts with personal data) is not being logged to console or log files.
- [ ]  **Financial data integrity:** Confirm that price, credit, and cash register calculations cannot be manipulated from the renderer. All financial logic must run in the main process.
- [ ]  **Error handling:** Verify that error messages exposed to the user do not reveal internal structure (table names, system paths, stack traces).
- [ ]  **Dependencies:** If any dependency was added or updated, verify it has no known vulnerabilities (`npm audit`).

### Security Rules for AI Assistants

1. **Never disable Electron protections.** Do not suggest or implement `nodeIntegration: true`, `contextIsolation: false`, or `webSecurity: false` under any circumstances.
2. **Never concatenate input in SQL.** If the proposed solution concatenates any value into a SQL string, the solution is incorrect. Period.
3. **Always validate in the main process.** If an IPC handler receives data and passes it directly to the database without validation, the solution is incorrect.
4. **Report security risks.** If an insecure pattern is detected in existing code during an implementation, report it as a comment even if fixing it was not requested.
5. **Security analysis is mandatory.** After completing any implementation, include a brief security analysis at the end stating: what was reviewed, what risks were identified (if any), and confirming that the security checklist was followed.