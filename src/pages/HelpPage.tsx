import styles from './HelpPage.module.css';
import { ChevronDown } from 'lucide-react';

export function HelpPage() {
  return (
    <div className={styles.page}>
      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Ayuda</h1>
      </div>

      <section className={styles.cards}>
        <details className={styles.card}>
          <summary className={styles['card__summary']}>
            <div className={styles['card__header']}>
              <h2 className={styles['card__title']}>Reglas: Caja, ventas, créditos y abonos</h2>
              <p className={styles['card__subtitle']}>
                Guía rápida para entender qué se registra, en qué caja se guarda y qué números verás en el corte.
              </p>
            </div>
            <ChevronDown size={18} strokeWidth={1.75} className={styles['card__chevron']} />
          </summary>

          <div className={styles['card__content']}>
            <div className={styles.section}>
              <h3 className={styles['section__title']}>Regla principal</h3>
              <ul className={styles.list}>
                <li>No se puede registrar una venta si no hay una caja (periodo) abierta.</li>
                <li>No se puede registrar un abono (cobro de crédito) si no hay una caja abierta.</li>
              </ul>
              <p className={styles.note}>
                Esto existe para que todo lo que pase en el día quede asociado a una caja específica y el corte sea confiable.
              </p>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Ventas: ¿a qué se asocian?</h3>
              <ul className={styles.list}>
                <li>
                  Toda venta (contado o crédito) se guarda con la caja abierta en ese momento.
                </li>
                <li>
                  En otras palabras: cada venta queda registrada dentro de la caja que tengas abierta, para que el corte salga bien.
                </li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Venta de contado</h3>
              <ul className={styles.list}>
                <li>El dinero entra de inmediato a caja.</li>
                <li>En Caja verás ese importe dentro de <strong>Ventas efectivo</strong>.</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Venta a crédito (venta devengada)</h3>
              <ul className={styles.list}>
                <li>La venta se registra hoy, aunque el dinero se cobre después.</li>
                <li>En Caja verás ese importe dentro de <strong>Ventas crédito</strong>.</li>
                <li>Al crear un crédito, el sistema guarda su vencimiento, recargo y estado (pendiente / vencido / pagado).</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Abonos (cobros de crédito)</h3>
              <ul className={styles.list}>
                <li>Un abono es dinero que entra a caja, pero proviene de un crédito anterior.</li>
                <li>
                  Cada abono se asocia a la <strong>caja abierta del momento del cobro</strong>.
                </li>
                <li>En Caja se muestra como <strong>Cobros crédito</strong>.</li>
                <li>El crédito acumula el pago; si se liquida, cambia a estado <strong>Pagado</strong>.</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Cierre de caja (corte)</h3>
              <p className={styles.paragraph}>
                Al cerrar un periodo, el sistema calcula los totales desde los datos reales asociados a esa caja:
              </p>
              <ul className={styles.list}>
                <li><strong>Ventas efectivo</strong>: suma de ventas de contado de esa caja.</li>
                <li><strong>Ventas crédito</strong>: suma de ventas a crédito de esa caja.</li>
                <li><strong>Cobros crédito</strong>: suma de abonos cobrados en esa caja.</li>
                <li><strong>Gastos</strong>: suma de movimientos tipo gasto del periodo.</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Ejemplos rápidos</h3>
              <ul className={styles.list}>
                <li>
                  Vendes a crédito hoy por $100: verás +$100 en <strong>Ventas crédito</strong>, pero no aumenta el efectivo.
                </li>
                <li>
                  Mañana cobran $40 de ese crédito: verás +$40 en <strong>Cobros crédito</strong> en la caja de mañana.
                </li>
              </ul>
            </div>
          </div>
        </details>

        <details className={styles.card}>
          <summary className={styles['card__summary']}>
            <div className={styles['card__header']}>
              <h2 className={styles['card__title']}>Punto de venta: búsqueda y cobro</h2>
              <p className={styles['card__subtitle']}>
                Cómo agregar productos, manejar cantidades y usar atajos.
              </p>
            </div>
            <ChevronDown size={18} strokeWidth={1.75} className={styles['card__chevron']} />
          </summary>

          <div className={styles['card__content']}>
            <div className={styles.section}>
              <h3 className={styles['section__title']}>Buscar o escanear</h3>
              <ul className={styles.list}>
                <li>Escribe el nombre, categoría, descripción o código de barras para buscar.</li>
                <li>Si usas escáner USB, normalmente puedes escanear directamente y presionar Enter para agregar.</li>
                <li>
                  Atajo: <strong>F2</strong> enfoca la búsqueda (útil si se perdió el foco).
                </li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Cantidades y stock</h3>
              <ul className={styles.list}>
                <li>Puedes sumar o restar cantidad con los botones <strong>+</strong> y <strong>-</strong> del carrito.</li>
                <li>El sistema evita vender más unidades de las que hay en stock.</li>
                <li>Si el producto tiene stock 0, no se agrega al carrito.</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Atajos (POS)</h3>
              <ul className={styles.list}>
                <li><strong>F1</strong>: cobrar venta (efectivo).</li>
                <li><strong>F3</strong>: venta a crédito.</li>
                <li><strong>F4</strong>: limpiar carrito.</li>
                <li><strong>Esc</strong>: cerrar modal actual (o cerrar ticket si está abierto).</li>
              </ul>
            </div>
          </div>
        </details>

        <details className={styles.card}>
          <summary className={styles['card__summary']}>
            <div className={styles['card__header']}>
              <h2 className={styles['card__title']}>Productos: precios, códigos y stock mínimo</h2>
              <p className={styles['card__subtitle']}>
                Cómo se calcula el precio y cómo usar el código de barras interno.
              </p>
            </div>
            <ChevronDown size={18} strokeWidth={1.75} className={styles['card__chevron']} />
          </summary>

          <div className={styles['card__content']}>
            <div className={styles.section}>
              <h3 className={styles['section__title']}>Precio de venta</h3>
              <ul className={styles.list}>
                <li>
                  El precio de venta se calcula automáticamente a partir de <strong>costo</strong> + <strong>margen (%)</strong>.
                </li>
                <li>
                  Si ajustas el margen, el sistema recalcula el precio sugerido; si ajustas el precio sugerido, el sistema recalcula el margen.
                </li>
              </ul>
              <p className={styles.note}>
                Nota: el dato que se guarda para el cálculo es el costo y el margen; el precio final se deriva de esos valores.
              </p>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Código de barras interno</h3>
              <ul className={styles.list}>
                <li>Al crear un producto nuevo, se genera un código automáticamente.</li>
                <li>Antes de guardar, puedes regenerarlo si necesitas otro código.</li>
                <li>Ese código es el que puedes escanear en el Punto de Venta o en Etiquetas.</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Stock mínimo (alerta)</h3>
              <ul className={styles.list}>
                <li>Cuando el stock llega a <strong>stock mínimo</strong> o menos, el producto se considera “bajo stock”.</li>
                <li>Si no quieres alertas para un producto, puedes desactivar el mínimo de stock.</li>
              </ul>
            </div>
          </div>
        </details>

        <details className={styles.card}>
          <summary className={styles['card__summary']}>
            <div className={styles['card__header']}>
              <h2 className={styles['card__title']}>Inventario: entradas, salidas y ajustes</h2>
              <p className={styles['card__subtitle']}>
                Cuándo registrar una entrada y cuándo usar un ajuste.
              </p>
            </div>
            <ChevronDown size={18} strokeWidth={1.75} className={styles['card__chevron']} />
          </summary>

          <div className={styles['card__content']}>
            <div className={styles.section}>
              <h3 className={styles['section__title']}>Movimientos</h3>
              <ul className={styles.list}>
                <li><strong>Entrada</strong>: cuando llega mercancía (sube el stock).</li>
                <li><strong>Salida</strong>: se genera automáticamente al vender (baja el stock).</li>
                <li><strong>Ajuste</strong>: para correcciones por conteo (puede ser + o -).</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Buenas prácticas</h3>
              <ul className={styles.list}>
                <li>Usa <strong>Ajuste</strong> cuando el stock real no coincide con el sistema.</li>
                <li>Agrega una nota breve (por ejemplo: “conteo”, “merma”, “dañado”) para entender el motivo después.</li>
              </ul>
            </div>
          </div>
        </details>

        <details className={styles.card}>
          <summary className={styles['card__summary']}>
            <div className={styles['card__header']}>
              <h2 className={styles['card__title']}>Respaldo y datos</h2>
              <p className={styles['card__subtitle']}>
                Cómo crear un respaldo y por qué conviene hacerlo.
              </p>
            </div>
            <ChevronDown size={18} strokeWidth={1.75} className={styles['card__chevron']} />
          </summary>

          <div className={styles['card__content']}>
            <div className={styles.section}>
              <h3 className={styles['section__title']}>Crear un respaldo</h3>
              <ul className={styles.list}>
                <li>Ve a <strong>Configuración</strong> y usa la sección <strong>Respaldo de datos</strong>.</li>
                <li>El sistema crea una copia de la base de datos en una carpeta llamada <strong>backups</strong>.</li>
              </ul>
            </div>

            <div className={styles.section}>
              <h3 className={styles['section__title']}>Recomendación</h3>
              <ul className={styles.list}>
                <li>Haz un respaldo al final del día o antes de actualizar la app.</li>
                <li>Si puedes, copia el archivo de respaldo a una USB para tenerlo fuera de la PC.</li>
              </ul>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
