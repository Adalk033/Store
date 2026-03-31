# Futuras Implementaciones

## Pendientes del plan original

### Escaneo de codigo de barras por camara (quagga2)
- Instalar libreria `quagga2` para lectura de codigos de barras usando la camara de la PC
- El soporte de scanner USB (dispositivos HID) ya funciona
- Requiere aprobacion para instalar nueva dependencia

## Ideas para despues

### Impresora termica
- Integrar `electron-pos-printer` para impresion directa en impresora termica
- Actualmente los tickets se imprimen via `window.print()` con CSS para formato de 80mm

### Mejoras generales
- Logo de la tienda en tickets (cargar imagen desde configuracion)
- Exportar reportes a CSV/Excel
- Backup automatico programado (actualmente es manual desde Configuracion)
