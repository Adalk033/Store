# CLAUDE.md - store-internal POS

## Project Overview

store-internal is a fully local, single-PC point-of-sale (POS) desktop application for a stationery store (papeleria). It runs entirely offline with no server or cloud dependency. Single store, single admin user.

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

## Security

Security is a priority in every phase of development. Every implementation must be verified before it can be considered complete.

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