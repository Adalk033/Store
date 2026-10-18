# store-internal POS

Aplicacion de punto de venta (POS) local para papeleria, construida con Electron + React + TypeScript + SQLite.

## Caracteristicas

- Gestion de productos y categorias
- Control de inventario
- Ventas de mostrador y ventas a credito
- Caja mensual
- Reportes basicos

## Stack

- Electron
- React 19 + TypeScript
- Vite
- SQLite (better-sqlite3)

## Requisitos

- Node.js 24.12+
- pnpm 11.15.0

El proyecto usa pnpm como unico gestor de paquetes. `pnpm-lock.yaml` es el
archivo de bloqueo oficial; no se usan `package-lock.json`, Yarn ni npm para
instalar o ejecutar scripts.

## Instalacion

```bash
pnpm install --frozen-lockfile
```

La instalacion no ejecuta scripts `preinstall`, `install` ni `postinstall` de
dependencias. Si se requiere reconstruir una dependencia nativa para Electron,
hagalo de forma consciente y manual:

```bash
pnpm run rebuild:native
```

Los comandos de pnpm fallan, en lugar de instalar dependencias automaticamente,
si `node_modules` no coincide con el lockfile.

## Desarrollo

```bash
pnpm run dev
```

## Build

```bash
pnpm run build
pnpm run electron:build
```

## Estructura principal

- electron/: proceso principal, preload y base de datos
- src/: interfaz React, hooks, componentes y paginas
- docs/: documentacion funcional y de diseno

## Licencia

Este proyecto esta licenciado bajo Apache 2.0.
Consulta el archivo LICENSE para mas detalles.
