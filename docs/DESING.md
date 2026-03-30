# Especificaciones de Diseño: Sistema de Ventas (Papelería)
## Estilo: Modern Minimalist

Este documento detalla los lineamientos visuales y estructurales para la construcción de la interfaz de usuario, priorizando la legibilidad, el espacio negativo y la eficiencia operativa.

---

## 1. Fundamentos de Identidad Visual

### Paleta de Colores (Hexadecimal)
* **Superficie de Fondo:** `#F9F9F9` (Paper White)
* **Contenedores de Tarjetas:** `#FFFFFF` (Pure White)
* **Acción Primaria / Navegación:** `#1A2B3C` (Deep Ink Blue)
* **Texto Principal:** `#111827` (Near Black)
* **Texto Secundario / Labels:** `#6B7280` (Medium Gray)
* **Bordes y Líneas:** `#E5E7EB` (Light Gray)

### Estados de Sistema
* **Éxito / Stock Alto:** `#10B981`
* **Alerta / Stock Bajo:** `#F59E0B`
* **Error / Sin Stock:** `#EF4444`

### Tipografía
* **Fuente Principal:** Google Sans (/fonts/)
* **Títulos (H1):** 24px | SemiBold | Color: `#111827`
* **Subtítulos (H2):** 18px | Medium | Color: `#111827`
* **Cuerpo de Texto:** 14px - 16px | Regular | Color: `#111827`
* **Metadatos/SKU:** 12px | Regular | Color: `#6B7280`

---

## 2. Componentes de Interfaz (UI Kit)

### Contenedores y Elevación
* **Radio de Esquinas:** 12px (Border Radius).
* **Borde:** 1px sólido `#E5E7EB`.
* **Sombra:** `0px 4px 6px -1px rgba(0, 0, 0, 0.05)` (Sombra suave para profundidad).

### Botones (Buttons)
* **Primario:** Fondo `#1A2B3C`, Texto Blanco, 12px vertical / 24px horizontal.
* **Secundario:** Fondo transparente, Borde 1px `#1A2B3C`, Texto `#1A2B3C`.
* **Hover State:** Oscurecer fondo 10% o añadir opacidad suave.

### Campos de Entrada (Inputs)
* **Estilo:** Fondo blanco, borde 1px `#E5E7EB`.
* **Focus:** Anillo de 2px color `#1A2B3C` con opacidad del 20%.
* **Iconos:** Lineales (Stroke 1.5px), color `#6B7280`.

---

## 3. Rejilla y Espaciado (Layout Grid)
* **Sistema de Espaciado:** Múltiplos de 8px (8, 16, 24, 32, 48, 64).
* **Márgenes de Pantalla:** 32px de padding lateral y superior.
* **Gutter (Canal):** 24px entre tarjetas de producto.
---

## 4. Iconografía Recomendada
* **Librería:** Lucide Icons
* **Grosor de Trazo:** 1.5px o 2px.
* **Tamaño estándar:** 20px x 20px.