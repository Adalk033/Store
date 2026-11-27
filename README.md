# store-internal POS

Aplicación de punto de venta (POS) para papelería. El cliente Electron consulta y registra las operaciones mediante la API de AWS.

## Características

- Gestion de productos y categorias
- Control de inventario
- Ventas de mostrador y ventas a credito
- Caja mensual con ventas históricas, edición de cortes cerrados y traslado de ventas entre cajas. Consulta las [reglas de Caja, Ventas y Créditos](docs/reglas-caja-ventas-creditos.md).
- Reportes basicos

## Stack

- Electron
- React 19 + TypeScript
- Vite
- AWS API Gateway, Lambda y PostgreSQL

## Requisitos

- Node.js 24.x desde 24.12.0 o 26.x desde 26.13.1
- pnpm 12.21.0
- Conexión a la API de AWS y credenciales del servicio

El proyecto usa pnpm como unico gestor de paquetes. `pnpm-lock.yaml` es el
archivo de bloqueo oficial; no se usan `package-lock.json`, Yarn ni npm para
instalar o ejecutar scripts.

## Instalacion

```bash
pnpm install --frozen-lockfile
```

La instalacion no ejecuta scripts `preinstall`, `install` ni `postinstall` de
dependencias.

Los comandos de pnpm fallan, en lugar de instalar dependencias automaticamente,
si `node_modules` no coincide con el lockfile.

## Desarrollo

```bash
pnpm run dev
```

### Pruebas locales

Las suites de Caja y del prototipo de DynamoDB usan datos sintéticos y servicios simulados.

```bash
pnpm exec node --test tests/cashCorrections.test.mjs tests/cashRegisterDates.test.mjs
pnpm exec node --test cloud/prototype-dynamodb/contract.test.mjs cloud/prototype-dynamodb/migration.test.mjs
```

La [documentación del prototipo de DynamoDB](cloud/prototype-dynamodb/README.md) describe su contrato, su entorno de pruebas y los ensayos de migración y recuperación.

## Build

```bash
pnpm run build
pnpm run electron:build
```

## Estructura principal

- electron/: proceso principal, preload y cliente de la API
- cloud/: backend Lambda y esquema PostgreSQL
- src/: interfaz React, hooks, componentes y paginas
- docs/: documentacion funcional y de diseno

## Licencia

Este proyecto esta licenciado bajo Apache 2.0.
Consulta el archivo LICENSE para mas detalles.
