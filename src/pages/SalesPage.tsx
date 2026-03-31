import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { useSales } from '../hooks/useSales';
import { formatCurrency, formatDateTime } from '../lib/formatters';
import type { SaleDetail, SaleListItem } from '../types';
import styles from './SalesPage.module.css';

type ViewMode = 'list' | 'detail';
type SaleTypeFilter = 'all' | 'cash' | 'credit';

interface TicketStoreSettings {
  storeName: string;
  storeAddress: string;
  footerText: string;
}

const SALE_TYPE_LABEL: Record<'cash' | 'credit', string> = {
  cash: 'Contado',
  credit: 'Credito',
};

export function SalesPage() {
  const { getAllSales, getSaleDetailById } = useSales();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sales, setSales] = useState<SaleListItem[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [saleTypeFilter, setSaleTypeFilter] = useState<SaleTypeFilter>('all');
  const [showTicket, setShowTicket] = useState(false);

  const [storeSettings, setStoreSettings] = useState<TicketStoreSettings>({
    storeName: 'Mi Papeleria',
    storeAddress: '',
    footerText: '',
  });

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const loadSales = useCallback(async () => {
    setLoadingSales(true);
    try {
      const data = await getAllSales(300, 0);
      setSales(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al cargar ventas';
      showNotification('error', message);
    } finally {
      setLoadingSales(false);
    }
  }, [getAllSales, showNotification]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  useEffect(() => {
    async function loadStoreSettings() {
      try {
        const [storeName, storeAddress, footerText] = await Promise.all([
          window.electronAPI.settings.get('store_name'),
          window.electronAPI.settings.get('store_address'),
          window.electronAPI.settings.get('ticket_footer_text'),
        ]);

        setStoreSettings({
          storeName: storeName ?? 'Mi Papeleria',
          storeAddress: storeAddress ?? '',
          footerText: footerText ?? '',
        });
      } catch (error) {
        console.error('SalesPage.loadStoreSettings:', error);
      }
    }

    void loadStoreSettings();
  }, []);

  const filteredSales = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sales.filter((sale) => {
      if (saleTypeFilter !== 'all' && sale.sale_type !== saleTypeFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return sale.id.toString().includes(query)
        || sale.customer_name?.toLowerCase().includes(query)
        || sale.total.toFixed(2).includes(query);
    });
  }, [sales, saleTypeFilter, searchQuery]);

  const summary = useMemo(() => {
    const totalSales = filteredSales.length;
    const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
    const cashRevenue = filteredSales
      .filter((sale) => sale.sale_type === 'cash')
      .reduce((sum, sale) => sum + sale.total, 0);
    const creditRevenue = filteredSales
      .filter((sale) => sale.sale_type === 'credit')
      .reduce((sum, sale) => sum + sale.total, 0);

    return { totalSales, totalRevenue, cashRevenue, creditRevenue };
  }, [filteredSales]);

  const openSaleDetail = useCallback(async (saleId: number): Promise<boolean> => {
    setLoadingDetail(true);
    try {
      const detail = await getSaleDetailById(saleId);
      if (!detail) {
        showNotification('error', `No se encontro la venta #${saleId}`);
        return false;
      }

      setSelectedSale(detail);
      setViewMode('detail');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar el detalle de la venta';
      showNotification('error', message);
      return false;
    } finally {
      setLoadingDetail(false);
    }
  }, [getSaleDetailById, showNotification]);

  const openTicketFromList = useCallback(async (saleId: number) => {
    const opened = await openSaleDetail(saleId);
    if (opened) {
      setShowTicket(true);
    }
  }, [openSaleDetail]);

  function backToList() {
    setViewMode('list');
    setSelectedSale(null);
    setShowTicket(false);
  }

  if (viewMode === 'detail' && selectedSale) {
    const totalItems = selectedSale.items.reduce((sum, item) => sum + item.quantity, 0);

    return (
      <div className={styles.page}>
        {notification && (
          <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
            {notification.message}
          </div>
        )}

        <div className={styles['page__header']}>
          <div className={styles['page__header-left']}>
            <button className={styles['btn-back']} onClick={backToList}>
              <ArrowLeft size={16} strokeWidth={1.5} />
              Volver a ventas
            </button>
            <h1 className={styles['page__title']}>Venta #{selectedSale.id}</h1>
            <span className={`${styles.badge} ${styles[`badge--${selectedSale.sale_type}`]}`}>
              {SALE_TYPE_LABEL[selectedSale.sale_type]}
            </span>
          </div>
          <div className={styles['page__header-actions']}>
            <button className={styles['btn-secondary']} onClick={() => setShowTicket(true)}>
              <Receipt size={16} strokeWidth={1.5} />
              Ver ticket
            </button>
            <button className={styles['btn-primary']} onClick={() => window.print()}>
              <Printer size={16} strokeWidth={1.5} />
              Imprimir ticket
            </button>
          </div>
        </div>

        <div className={styles.detail}>
          <section className={styles['detail-card']}>
            <h2 className={styles['detail-card__title']}>Informacion general</h2>
            <div className={styles['detail-card__rows']}>
              <div className={styles['detail-card__row']}>
                <span className={styles['detail-card__label']}>Fecha</span>
                <span className={styles['detail-card__value']}>
                  <CalendarDays size={14} strokeWidth={1.5} />
                  {formatDateTime(selectedSale.created_at)}
                </span>
              </div>
              <div className={styles['detail-card__row']}>
                <span className={styles['detail-card__label']}>Tipo</span>
                <span className={styles['detail-card__value']}>{SALE_TYPE_LABEL[selectedSale.sale_type]}</span>
              </div>
              <div className={styles['detail-card__row']}>
                <span className={styles['detail-card__label']}>Cliente</span>
                <span className={styles['detail-card__value']}>
                  <User size={14} strokeWidth={1.5} />
                  {selectedSale.customer_name ?? 'Venta mostrador'}
                </span>
              </div>
              <div className={styles['detail-card__row']}>
                <span className={styles['detail-card__label']}>Articulos</span>
                <span className={styles['detail-card__value']}>{totalItems}</span>
              </div>
            </div>
          </section>

          <section className={styles['detail-card']}>
            <h2 className={styles['detail-card__title']}>Totales</h2>
            <div className={styles['totals']}>
              <div className={styles['totals__row']}>
                <span>Subtotal</span>
                <strong>{formatCurrency(selectedSale.subtotal)}</strong>
              </div>
              <div className={styles['totals__row']}>
                <span>Recargo</span>
                <strong>{formatCurrency(selectedSale.surcharge)}</strong>
              </div>
              <div className={`${styles['totals__row']} ${styles['totals__row--grand']}`}>
                <span>Total</span>
                <strong>{formatCurrency(selectedSale.total)}</strong>
              </div>
            </div>
          </section>
        </div>

        <section className={styles['table-card']}>
          <div className={styles['table-card__title']}>Articulos de la venta</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Codigo</th>
                <th>Cantidad</th>
                <th>Precio unitario</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {selectedSale.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles['table__empty']}>
                    No hay articulos registrados para esta venta
                  </td>
                </tr>
              ) : (
                selectedSale.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.product_name}</td>
                    <td className={styles['table__meta']}>{item.product_barcode || 'N/D'}</td>
                    <td>{item.quantity}</td>
                    <td>{formatCurrency(item.unit_price)}</td>
                    <td className={styles['table__strong']}>{formatCurrency(item.line_total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {showTicket && (
          <div className={styles['ticket-overlay']} onClick={() => setShowTicket(false)}>
            <div className={styles.ticket} onClick={(event) => event.stopPropagation()}>
              <div className={styles['ticket__printable']}>
                <div className={styles['ticket__header']}>
                  <div className={styles['ticket__store-name']}>{storeSettings.storeName}</div>
                  {storeSettings.storeAddress && (
                    <div className={styles['ticket__store-info']}>{storeSettings.storeAddress}</div>
                  )}
                </div>

                <hr className={styles['ticket__divider']} />

                <div className={styles['ticket__meta']}>
                  <span>Venta #{selectedSale.id}</span>
                  <span>{formatDateTime(selectedSale.created_at)}</span>
                </div>
                <div className={styles['ticket__meta']}>
                  <span>Cliente: {selectedSale.customer_name ?? 'Mostrador'}</span>
                  <span>{SALE_TYPE_LABEL[selectedSale.sale_type].toUpperCase()}</span>
                </div>

                <hr className={styles['ticket__divider']} />

                <div className={styles['ticket__items']}>
                  {selectedSale.items.map((item) => (
                    <div key={item.id} className={styles['ticket__item']}>
                      <div className={styles['ticket__item-row']}>
                        <span className={styles['ticket__item-name']}>{item.product_name}</span>
                        <span className={styles['ticket__item-total']}>
                          {formatCurrency(item.line_total)}
                        </span>
                      </div>
                      <div className={styles['ticket__item-detail']}>
                        {item.quantity} x {formatCurrency(item.unit_price)}
                      </div>
                    </div>
                  ))}
                </div>

                <hr className={styles['ticket__divider']} />

                <div className={styles['ticket__totals']}>
                  <div className={styles['ticket__total-row']}>
                    <span>Subtotal:</span>
                    <span>{formatCurrency(selectedSale.subtotal)}</span>
                  </div>
                  <div className={styles['ticket__total-row']}>
                    <span>Recargo:</span>
                    <span>{formatCurrency(selectedSale.surcharge)}</span>
                  </div>
                  <div className={`${styles['ticket__total-row']} ${styles['ticket__total-row--grand']}`}>
                    <span>Total:</span>
                    <span>{formatCurrency(selectedSale.total)}</span>
                  </div>
                </div>

                <hr className={styles['ticket__divider']} />

                <div className={styles['ticket__barcode']}>
                  <svg
                    ref={(element) => {
                      if (element) {
                        try {
                          JsBarcode(element, String(selectedSale.id).padStart(6, '0'), {
                            format: 'CODE128',
                            width: 1.5,
                            height: 40,
                            displayValue: true,
                            fontSize: 10,
                            margin: 0,
                            font: 'monospace',
                          });
                        } catch {
                          // Barcode rendering can fail for invalid values.
                        }
                      }
                    }}
                  />
                </div>

                {storeSettings.footerText && (
                  <div className={styles['ticket__footer']}>{storeSettings.footerText}</div>
                )}
              </div>

              <div className={styles['ticket__actions']}>
                <button className={styles['btn-secondary']} onClick={() => setShowTicket(false)}>
                  Cerrar
                </button>
                <button className={styles['btn-primary']} onClick={() => window.print()}>
                  <Printer size={14} strokeWidth={1.5} />
                  Imprimir
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
          {notification.message}
        </div>
      )}

      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Ventas</h1>
        <button className={styles['btn-secondary']} onClick={() => void loadSales()} disabled={loadingSales}>
          <RefreshCw size={16} strokeWidth={1.5} className={loadingSales ? styles['icon--spin'] : ''} />
          Actualizar
        </button>
      </div>

      <section className={styles['summary-grid']}>
        <article className={styles['summary-card']}>
          <span className={styles['summary-card__label']}>Ventas encontradas</span>
          <strong className={styles['summary-card__value']}>{summary.totalSales}</strong>
        </article>
        <article className={styles['summary-card']}>
          <span className={styles['summary-card__label']}>Total vendido</span>
          <strong className={styles['summary-card__value']}>{formatCurrency(summary.totalRevenue)}</strong>
        </article>
        <article className={styles['summary-card']}>
          <span className={styles['summary-card__label']}>Contado</span>
          <strong className={styles['summary-card__value']}>{formatCurrency(summary.cashRevenue)}</strong>
        </article>
        <article className={styles['summary-card']}>
          <span className={styles['summary-card__label']}>Credito</span>
          <strong className={styles['summary-card__value']}>{formatCurrency(summary.creditRevenue)}</strong>
        </article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles['search-box']}>
          <Search className={styles['search-box__icon']} size={16} strokeWidth={1.5} />
          <input
            className={styles['search-box__input']}
            type="text"
            placeholder="Buscar por # venta, cliente o monto"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <select
          className={styles['toolbar__filter']}
          value={saleTypeFilter}
          onChange={(event) => setSaleTypeFilter(event.target.value as SaleTypeFilter)}
        >
          <option value="all">Todos los tipos</option>
          <option value="cash">Solo contado</option>
          <option value="credit">Solo credito</option>
        </select>
      </section>

      <section className={styles['table-card']}>
        <div className={styles['table-card__title']}>Historial de ventas</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Cliente</th>
              <th>Articulos</th>
              <th>Total</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {loadingSales ? (
              <tr>
                <td colSpan={7} className={styles['table__empty']}>Cargando ventas...</td>
              </tr>
            ) : filteredSales.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles['table__empty']}>No hay ventas con los filtros actuales</td>
              </tr>
            ) : (
              filteredSales.map((sale) => (
                <tr key={sale.id} className={styles['table__row--clickable']} onClick={() => void openSaleDetail(sale.id)}>
                  <td className={styles['table__strong']}>#{sale.id}</td>
                  <td>{formatDateTime(sale.created_at)}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge--${sale.sale_type}`]}`}>
                      {SALE_TYPE_LABEL[sale.sale_type]}
                    </span>
                  </td>
                  <td>{sale.customer_name ?? 'Mostrador'}</td>
                  <td>{sale.item_count}</td>
                  <td className={styles['table__strong']}>{formatCurrency(sale.total)}</td>
                  <td>
                    <button
                      className={styles['btn-link']}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openTicketFromList(sale.id);
                      }}
                      disabled={loadingDetail}
                    >
                      Recuperar ticket
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
