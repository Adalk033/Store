# POS de pruebas con DynamoDB

El prototipo usa el conjunto sintético `michi-synthetic-full-2026-11-26` en las cuatro tablas `michi-poc-*` de México Central. La Lambda requiere `APP_ENV=test`, la etapa `test` y una clave exclusiva de pruebas de al menos 32 caracteres. Usa el SDK incluido en el runtime de AWS Lambda para Node.js. Esta carpeta contiene el código que se puede empaquetar para una función de pruebas con entrada `handler.handler`.

Las operaciones de negocio corren con los datos de ese conjunto. Las consultas de producto por ID y por código de barras, cliente por ID, caja abierta, detalle de venta, crédito e historiales asociados usan lecturas fuertes por clave. Las lecturas relacionadas comprueban que la revisión sea la misma al inicio y al final. La búsqueda general, los reportes y las escrituras todavía cargan las cuatro tablas. Las escrituras confirman la revisión y aplican el cambio completo en una transacción.

## Contrato local

Ejecutar desde un workspace con la versión de pnpm y las dependencias verificadas.

```bash
pnpm exec node --test cloud/prototype-dynamodb/contract.test.mjs
```

La suite coteja el Swagger y la ruta de edición de crédito utilizada por Electron. También ejecuta operaciones con el cliente `CloudApi` del POS contra un handler local. Un adaptador simulado permite comprobar las condiciones que genera la Lambda. Los resultados de esta suite cubren el contrato y la lógica local.

## Ensayo de migración

`export-snapshot.sql` devuelve las 13 tablas, posiciones de secuencia y totales independientes de caja y ventas por día. Ejecútalo con una identidad de lectura en una copia aislada. El consumidor debe proteger la salida porque contiene datos de negocio.

`migration.mjs` importa el resultado en tablas de ensayo vacías mediante transacciones con puntos de control y verifica la carga al terminar. El importador compara la huella del origen al reanudar. El manifiesto y los contadores se publican juntos después del último lote. Mantén el destino fuera del tráfico hasta que la conciliación termine.

La variante `MICHI_DYNAMO_LAYOUT=collections` usa el esquema de claves del importador. Las búsquedas, los reportes y las escrituras cargan sus colecciones con `Query`. Para empaquetar la Lambda de pruebas incluye `handler.mjs`, `domain.mjs`, `store.mjs`, `collection-store.mjs` y `recovery.mjs`.

## Candidato para producción

El paquete agrega `production-handler.mjs` y `migration.mjs`, y usa la entrada `production-handler.handler`. El candidato verifica `APP_ENV=prod`, México Central y el ID de la API REST en `MICHI_POS_API_ID`. Reutiliza la configuración de claves de la API mediante `EXPECTED_API_KEY` o `EXPECTED_API_KEYS`. Las lecturas requieren un manifiesto de importación completo en las tablas `michi-prod-*`. Mantén `MICHI_DYNAMO_WRITES_ENABLED` desactivado hasta aprobar la validación de solo lectura.

La importación admite `cashCollectionAdjustments` con `id`, `storedCents` y `ledgerCents`. Solo aplica el total conciliado si coincide con la evidencia de una caja abierta. El manifiesto registra los dos valores. La lista de cierres muestra los totales guardados y el endpoint de resumen conserva el cálculo desde los movimientos, igual que en Aurora.

Cada escritura productiva incluye un registro de la misma transacción en la partición `RECOVERY#WRITES`, junto con la revisión. Para recuperar, congela las escrituras, toma la última revisión confirmada y verifica que el registro esté completo. Usa `replayRecoveryJournal` sobre un destino aislado que ya contenga el snapshot de partida y concilia el resultado antes de conectar tráfico. La suite local verifica venta, abono, movimiento, traspaso y el rechazo de registros incompletos o corruptos.

## Ensayo con la aplicación

El lanzador usa una compilación existente del POS y crea una carpeta temporal propia para la configuración de Electron. Recibe de manera privada `MICHI_POC_API_ID` y `MICHI_POC_API_KEY`. La clave se guarda cifrada con Electron. La URL se construye con el ID de la API de pruebas y la etapa `test`. Cada solicitud del cliente al destino de pruebas muestra su método, ruta y efectos internos y pide autorización. Las solicitudes rechazadas o vencidas se cancelan.

```bash
pnpm run build
pnpm exec electron cloud/prototype-dynamodb/launch-pos.cjs
```

Después de desplegar la API y la Lambda de pruebas con autorización, comenzar con salud y catálogo. Ejecutar una venta de contado, verificar el ticket, el movimiento, stock y caja, y repetir la solicitud para comprobar idempotencia. Continuar con una venta a crédito, recargo, abono, cierre, venta histórica, corrección, traspaso, reversión y reportes. Registrar por separado qué se comprobó en el POS y qué se comprobó por el contrato local.
