# CLAUDE.md - MichiPapeleria POS

## Project Overview

MichiPapeleria is a fully local, single-PC point-of-sale (POS) desktop application for a stationery store (papeleria). It runs entirely offline with no server or cloud dependency. Single store, single admin user.

### Core Features

- Product catalog with categories/subcategories
- Automatic sale price calculation: cost_price * (1 + margin_percent / 100)
- Internal barcode generation per product (EAN-13 / Code128)
- Inventory control (entries, exits, adjustments, low-stock alerts)
- Counter sales (anonymous, cash) and credit sales (registered customer)
- Credit system: normal price within deadline, surcharge applied after due_date
- Monthly cash register periods (opening, closing, expenses tracking)
- Digital sale tickets (thermal printer ready for future)
- Reports: sales by day/week/month, top products, profit margins, inventory value

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron |
| Frontend | React 18+ with TypeScript |
| Bundler | Vite (handles all compilation) |
| Database | SQLite via sqlite3 (Node.js native) |
| Styling | CSS Modules with BEM naming + global CSS variables |
| Barcode | JsBarcode (generation), quagga2 (future scanning) |
| Tickets | electron-pos-printer or jsPDF |
| Charts | Recharts or Chart.js |

Do NOT add Tailwind, styled-components, shadcn/ui, or any other styling/compilation library.

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

## Project Structure
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


## Naming Conventions

- **React components**: PascalCase for both file names and component names (`ProductForm.tsx`, `SaleTicket.tsx`)
- **Variables, functions, hooks**: camelCase (`getProducts`, `handleSale`, `useInventory`)
- **Folders**: camelCase for general folders (`hooks/`, `lib/`, `types/`), PascalCase ONLY if the folder IS a React component folder
- **CSS Module files**: same name as component (`ProductForm.module.css`)
- **CSS classes**: BEM notation (`product-form__input`, `product-form__input--error`)
- **Database columns**: snake_case (`cost_price`, `sale_type`, `created_at`)
- **TypeScript interfaces/types**: PascalCase with prefix (`Product`, `SaleItem`, `CreditPayment`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_CREDIT_DAYS`, `DEFAULT_MARGIN`)
- **All code in English** (variable names, function names, comments, type names). Only user-facing strings (UI labels, messages) are in Spanish.

## Coding Standards

### General

- Always use TypeScript with strict mode. No `any` unless absolutely unavoidable (and add a comment explaining why).
- Always use functional components with hooks. No class components.
- Keep components focused and small. If a component exceeds ~150 lines, consider splitting.
- Export components as named exports, not default exports.
- Use explicit return types on functions that are non-trivial.

### CSS Modules + BEM

- One `.module.css` file per component, co-located next to the component file.
- Use BEM naming: `block__element--modifier`.
- Global variables (colors, fonts, spacing, shadows) live in `src/styles/globals.css` using CSS custom properties (`--color-primary`, `--spacing-md`, etc.).
- Import CSS modules as: `import styles from './ProductForm.module.css'`
- Never use inline styles except for truly dynamic values (e.g., calculated widths).

### Error Handling

- Wrap all IPC calls (renderer -> main) in try/catch.
- Wrap all database operations in try/catch in the repository layer.
- Always surface errors to the user via toast/notification. Never fail silently.
- Use React Error Boundaries at the page/route level to catch rendering crashes.
- Log errors to console with enough context to debug (include operation name + relevant IDs).

### IPC Communication (Electron)

- All database access happens in the main process via repositories.
- The renderer communicates with main through typed IPC channels.
- Define channel names as constants in a shared file.
- The preload script exposes a typed API object to the renderer.

### Database (SQLite)

- All queries live in repository files under `electron/database/repositories/`.
- Use parameterized queries always. Never concatenate user input into SQL strings.
- The migration script creates all tables on first run.
- Use WAL journal mode and enforce foreign keys (`PRAGMA foreign_keys = ON`).
- `sale_price` on products is a GENERATED STORED column: `ROUND(cost_price * (1 + margin_percent / 100.0), 2)`. Do not try to INSERT/UPDATE it directly.

## Business Logic Rules

### Pricing

- Each product has `cost_price` (what we paid) and `margin_percent` (desired profit %).
- `sale_price` is auto-calculated by SQLite: `cost_price * (1 + margin_percent / 100)`.
- When recording a sale, snapshot the `unit_price` at the moment of sale into `sale_items.unit_price`. Do not reference `products.sale_price` later for historical sales.

### Credit System

- Credit sales are tied to a registered customer.
- Each credit has a `due_date` (typically sale_date + N days, default from settings: `default_credit_days`).
- If the customer pays within `due_date`, they pay `original_amount`.
- If `due_date` passes and `surcharge_applied = 0`, apply surcharge: `total_due = original_amount * (1 + surcharge_percent / 100)`. Set `surcharge_applied = 1` and `status = 'overdue'`.
- Surcharge check runs on app startup and can be triggered manually.
- Only ONE surcharge level (no compounding). Once applied, `total_due` is final.
- Customers can make partial payments (`credit_payments` table). When `amount_paid >= total_due`, mark `status = 'paid'`.

### Inventory

- Every sale automatically creates an `inventory_movements` record with `type = 'out'`.
- Manual restocking creates records with `type = 'in'`.
- Adjustments (corrections) use `type = 'adjustment'`.
- `products.stock` must always reflect the current quantity. Update it atomically with every movement.
- Products with `stock <= min_stock` should trigger a visual low-stock alert in the UI.

### Cash Register

- One open period at a time (monthly).
- All sales are linked to the current open `cash_register_periods` record.
- On period close, calculate totals from actual sales/movements data.
- Track `opening_cash`, `total_cash_sales`, `total_credit_sales`, `total_credit_collected`, `total_expenses`, and `closing_cash` (manually entered).

## Strict Rules for AI Assistants

1. **No emojis** in code, comments, or commit messages. Ever.
2. **No new libraries** without explicit approval. If you think a library would help, ask first.
3. **No unsolicited refactoring**. Only change what was requested. If you see something that could be improved, mention it in a comment but do not change it.
4. **No over-engineering**. Keep it simple. No abstract factory patterns, no dependency injection containers, no complex generics unless truly needed. This is a small local app.
5. **Output complete files**. When creating or modifying a file, output the entire file content, not diffs or fragments.
6. **Respect existing patterns**. If the codebase already does something a certain way, follow that pattern unless explicitly asked to change it.
7. **Do not add features that were not requested**. Stick to the task at hand.
8. **Comments should be useful**, not obvious. Do not comment `// increment counter` above `counter++`. Do comment business logic decisions and non-obvious behavior.