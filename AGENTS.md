# AGENTS.md - MichiPapeleria POS

## Project Overview

MichiPapeleria is a fully local, offline desktop POS (point-of-sale) application for a stationery store. Built with Electron + React + TypeScript + SQLite. Runs on a single PC, single store, no cloud.

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

Do NOT introduce: Tailwind, styled-components, shadcn/ui, Babel, any ORM, any additional styling framework.

## Directory Layout
michipapeleria/

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