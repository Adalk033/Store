# Reglas: Caja, Ventas, Créditos y Abonos

Este documento define las reglas de negocio y de asociación entre **Caja (periodos)**, **Ventas**, **Créditos** y **Abonos** (cobros de créditos) en el POS.

## Objetivo

- Asegurar que **toda venta** quede asociada a un **periodo de caja correspondiente a la fecha de venta**.
- Separar correctamente:
  - **Ventas a crédito (devengadas)**: se registran cuando se vende, aunque el dinero no entre en ese momento.
  - **Abonos / cobros de crédito (caja real)**: se registran cuando se cobra y deben impactar la caja del momento.
- Permitir un **cuadre de caja** con números consistentes (ventas, gastos, cobros de crédito).

## Entidades y campos clave

- `cash_register_periods`
  - Periodo de caja (solo uno puede estar `open`).
  - Totales que se guardan al cierre: `total_cash_sales`, `total_credit_sales`, `total_credit_collected`, `total_expenses`, `closing_cash`.

- `sales`
  - Venta registrada en el sistema.
  - Campos clave: `sale_type` (`cash` | `credit`), `total`, `cash_received`, `cash_change`, `cash_register_id`.

- `credits`
  - Crédito creado cuando una venta es a crédito.
  - Campos clave: `sale_id`, `original_amount`, `total_due`, `amount_paid`, `due_date`, `status`.

- `credit_payments`
  - Registro de cada abono/cobro realizado a un crédito.
  - Campos clave: `credit_id`, `amount`, `cash_register_id`.

## Reglas del periodo de caja

1. **Un solo periodo abierto**
   - No se puede abrir un nuevo periodo si ya existe uno `open`.

2. **Fechas del periodo**
   - Inicio y cierre son inclusivos. La apertura y las correcciones comprueban los demás periodos, incluida la caja abierta.
   - Un cambio de fechas debe conservar dentro del periodo todas sus ventas, abonos y movimientos.

## Reglas de ventas y correcciones

- El punto de venta usa la caja abierta por defecto. Para capturar una venta pasada se elige la caja cerrada y se indica la fecha de venta. La fecha debe pertenecer al periodo y ser anterior o igual al día de hoy.
- La venta conserva la fecha efectiva en `created_at` y la fecha de captura en `captured_at`. La fecha de captura de ventas anteriores a esta función puede ser desconocida.
- En **Caja → Historial de Cortes → Editar corte** se corrigen fechas, efectivo inicial y contado. El periodo conserva su estado cerrado.
- **Mover venta** permite elegir otra caja y la fecha efectiva. Se recalculan ambas cajas en la misma transacción. El inventario, el vencimiento del crédito y la caja donde se recibió cada abono conservan su registro original.
- PostgreSQL guarda los valores anteriores y los solicitados para cada corrección en `cash_register_corrections`. La versión del periodo protege los cambios concurrentes y la clave de operación identifica reintentos.
- El efectivo esperado se calcula como efectivo inicial + ventas en efectivo + cobros + depósitos − gastos − retiros. La diferencia es el efectivo contado menos el esperado.

### Venta de contado (`sale_type = 'cash'`)

- Se registra con:
  - `cash_received` y `cash_change` validados (no puede ser menor al total y el cambio no puede ser negativo).
- Impacto en caja:
  - Suma dentro del periodo en `total_cash_sales` (al cierre) y en el resumen en vivo.

### Venta a crédito (`sale_type = 'credit'`)

- Se registra con `customer_id` obligatorio.
- Se crea un registro en `credits`:
  - `original_amount = subtotal`
  - `total_due` inicia en el subtotal (el recargo se aplicará si vence)
  - `due_date` = fecha de venta + `credit_days`
  - `status`:
    - `paid` si el abono inicial cubre el total
    - `pending` si queda saldo

- Impacto en caja:
  - La venta se incluye como **venta a crédito devengada** del periodo (`total_credit_sales`).

## Reglas de Abonos (cobros de crédito)

1. **Caja abierta obligatoria**
   - Para registrar un abono debe existir un periodo de caja `open`.

2. **Asociación del abono a la caja del momento**
   - Cada abono se registra en `credit_payments` con:
     - `cash_register_id = id` del periodo de caja abierto.

3. **Efecto contable en caja**
   - Los abonos NO incrementan `total_cash_sales` ni crean una nueva venta.
   - Los abonos incrementan el total de **cobros de crédito** del periodo:
     - `total_credit_collected` (se consolida al cierre del periodo y se muestra en vivo).

4. **Actualización del crédito**
   - Cada abono:
     - suma a `credits.amount_paid`
     - si `amount_paid >= total_due`, el crédito cambia a `status = 'paid'` y se registra `paid_at`.

### Abono inicial en venta a crédito

- Si una venta a crédito incluye `initial_payment > 0`:
  - se crea un registro en `credit_payments`.
  - el abono inicial queda en la caja elegida al capturar la venta, con la misma fecha de operación.

## Reglas de recargo por vencimiento (créditos)

- Al detectar un crédito vencido (con `status = 'pending'`, `surcharge_applied = 0` y `due_date` pasada):
  - se actualiza `credits.total_due` aplicando el recargo una sola vez.
  - se actualiza también la venta (`sales.surcharge` y `sales.total`) para reflejar el recargo.

## Cálculos del corte de caja

Al **cerrar** un periodo de caja, los totales se calculan desde datos reales:

- `total_cash_sales` = suma de `sales.total` donde `cash_register_id = periodo` y `sale_type = 'cash'`.
- `total_credit_sales` = suma de `sales.total` donde `cash_register_id = periodo` y `sale_type = 'credit'`.
- `total_credit_collected` = suma de `credit_payments.amount` donde `cash_register_id = periodo`.
- `total_expenses` = suma de `cash_movements.amount` donde `cash_register_id = periodo` y `type = 'expense'`.

## Resumen en vivo (Caja abierta)

Mientras el periodo está abierto, la pantalla de Caja consulta periódicamente los totales del periodo abierto para mostrar:

- Conteo de ventas del periodo.
- Ventas efectivo.
- Ventas crédito.
- Cobros crédito (abonos).

## Notas de datos existentes (antes de esta regla)

- Si existían abonos antiguos antes de agregar `credit_payments.cash_register_id`, pueden quedar con `NULL`.
- A partir de estas reglas, los abonos posteriores a la venta quedan asociados al periodo abierto en el que se reciben.
