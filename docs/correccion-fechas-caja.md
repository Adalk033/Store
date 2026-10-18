# Fechas de inicio y cierre de caja

Las fechas de un periodo representan dias de calendario. Una caja que empieza el
1 de mayo debe conservar ese dia al mostrarse y al validar los formularios,
independientemente de la zona horaria del equipo.

## Error reproducido

El formato anterior mostraba `2026-05-01T00:00:00.000Z` como 30 de abril al
convertirlo a `America/Mexico_City`. La misma conversion afectaba la fecha minima
de movimientos y cierre. Con una fecha local `2026-05-01` no ocurria.

Se verifico el comportamiento con datos sinteticos. No se consulto AWS ni se
confirmo el movimiento de utilidades de abril del cliente.

## Cambio

- Lambda devuelve `start_date` y `end_date` como texto de PostgreSQL (`YYYY-MM-DD`)
  al consultar, abrir y cerrar periodos.
- El cliente admite tambien las respuestas antiguas que serializaban esos campos
  como timestamps, conservando el dia escrito en el campo.
- La pantalla de caja usa ese mismo dia para mostrar limites e informar las
  fechas. El cierre se muestra como fecha, sin inventar una hora.
- Las fechas y horas de ventas, gastos y abonos mantienen su conversion habitual
  a la zona horaria del negocio.

Este cambio no actualiza registros ni corrige automaticamente fechas guardadas
incorrectamente en la base de datos.

## Despliegue

1. Publicar el archivo actualizado `cloud/lambda-v1-handler.mjs` usando el proceso
   habitual de despliegue de Lambda y sus dependencias existentes.
2. Compilar y distribuir la aplicacion de escritorio actualizada.

No se requieren cambios de esquema, migraciones ni cambios en API Gateway para
esta correccion. El cliente actualizado admite el formato de la Lambda anterior.

## Verificacion local

```sh
pnpm exec node --test tests/cashRegisterDates.test.mjs
pnpm exec node --check cloud/lambda-v1-handler.mjs
pnpm run build
```

Las pruebas usan respuestas HTTP simuladas y no se conectan a servicios externos.
La verificacion de la Lambda desplegada y de los datos reales queda pendiente.

## Revision de seguridad

Se reviso la lista de seguridad del proyecto para este cambio: las consultas
modificadas conservan sus parametros; no se agregan escrituras, canales IPC,
registros de datos sensibles, dependencias ni cambios de permisos. Las fechas
recibidas se validan antes de usarse como limites de formulario. Los calculos
financieros y los controles de pnpm no se modifican.

Se identificaron riesgos anteriores a esta correccion: Electron configura
`sandbox: false`, la conexion PostgreSQL usa `rejectUnauthorized: false` y los
handlers IPC de caja no validan sistematicamente sus argumentos en el proceso
principal. Estos puntos no se corrigen en este cambio de fechas; deben abordarse
al proteger las operaciones de caja.
