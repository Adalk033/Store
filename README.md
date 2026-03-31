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

- Node.js 20+
- npm 10+

## Instalacion

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Build

```bash
npm run build
npm run electron:build
```

## Estructura principal

- electron/: proceso principal, preload y base de datos
- src/: interfaz React, hooks, componentes y paginas
- docs/: documentacion funcional y de diseno

## Licencia

Este proyecto esta licenciado bajo Apache 2.0.
Consulta el archivo LICENSE para mas detalles.