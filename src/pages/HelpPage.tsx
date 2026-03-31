import styles from './HelpPage.module.css';

export function HelpPage() {
  return (
    <div className={styles.page}>
      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Ayuda</h1>
      </div>

      <section className={styles.cards}>
        <article className={styles.card}>
          <div className={styles['card__header']}>
            <h2 className={styles['card__title']}>Reglas: Caja, ventas, créditos y abonos</h2>
            <p className={styles['card__subtitle']}>
              Guía rápida para entender qué se registra, en qué caja se guarda y qué números verás en el corte.
            </p>
          </div>

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
        </article>
      </section>
    </div>
  );
}
