import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useReports } from '../hooks/useReports';
import { formatCurrency, formatDate } from '../lib/formatters';
import type {
  DailySalesRow,
  TopProductRow,
  ProfitRow,
  InventoryValueRow,
  InventorySummary,
  CreditsOverviewRow,
} from '../../electron/database/repositories/reports';
import type { PieLabelRenderProps } from 'recharts';
import styles from './ReportsPage.module.css';

type ReportTab = 'sales' | 'products' | 'profit' | 'inventory' | 'credits';

const CHART_COLORS = ['#1A2B3C', '#10B981', '#F59E0B', '#EF4444', '#6366F1', '#8B5CF6', '#EC4899', '#14B8A6'];

const TABLE_ROWS_OPTIONS = [5, 10, 15, 25] as const;

const CREDIT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  overdue: 'Vencido',
  paid: 'Pagado',
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function filterByQuery<T>(rows: T[], query: string, getValues: (row: T) => Array<unknown>): T[] {
  const q = normalizeText(query);
  if (!q) return rows;

  return rows.filter(row => {
    const values = getValues(row);
    return values.some(v => normalizeText(v).includes(q));
  });
}

function paginateRows<T>(rows: T[], page: number, rowsPerPage: number): { pageRows: T[]; totalPages: number } {
  const safeRowsPerPage = rowsPerPage > 0 ? rowsPerPage : 5;
  const totalPages = Math.max(1, Math.ceil(rows.length / safeRowsPerPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * safeRowsPerPage;
  const endIndex = startIndex + safeRowsPerPage;
  return { pageRows: rows.slice(startIndex, endIndex), totalPages };
}

function usePersistedRowsPerPage(tableId: string, defaultValue: number): [number, (value: number) => void] {
  const storageKey = `reports.table.rowsPerPage.${tableId}`;
  const [rowsPerPage, setRowsPerPage] = useState<number>(defaultValue);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      if (!TABLE_ROWS_OPTIONS.includes(parsed as (typeof TABLE_ROWS_OPTIONS)[number])) return;
      setRowsPerPage(parsed);
    } catch (err) {
      console.log('Failed to read table rowsPerPage from localStorage', { storageKey, err });
    }
  }, [storageKey]);

  const setPersistedRowsPerPage = useCallback((value: number) => {
    const next = TABLE_ROWS_OPTIONS.includes(value as (typeof TABLE_ROWS_OPTIONS)[number]) ? value : defaultValue;
    setRowsPerPage(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch (err) {
      console.log('Failed to write table rowsPerPage to localStorage', { storageKey, err });
    }
  }, [defaultValue, storageKey]);

  return [rowsPerPage, setPersistedRowsPerPage];
}

// Date helpers
function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPresetDates(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = toISODate(now);

  switch (preset) {
    case 'today': {
      return { start: end, end };
    }
    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { start: toISODate(start), end };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: toISODate(start), end };
    }
    case 'quarter': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      return { start: toISODate(start), end };
    }
    default: {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: toISODate(start), end };
    }
  }
}

export function ReportsPage() {
  const { loading, getSalesByDate, getTopProducts, getProfitReport, getInventoryReport, getInventorySummary, getCreditsOverview } = useReports();

  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [activePreset, setActivePreset] = useState('month');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Date range state
  const defaultDates = getPresetDates('month');
  const [startDate, setStartDate] = useState(defaultDates.start);
  const [endDate, setEndDate] = useState(defaultDates.end);

  // Data state
  const [salesData, setSalesData] = useState<DailySalesRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [profitData, setProfitData] = useState<ProfitRow[]>([]);
  const [inventoryData, setInventoryData] = useState<InventoryValueRow[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary | null>(null);
  const [creditsData, setCreditsData] = useState<CreditsOverviewRow[]>([]);

  // Per-table UI state (search + pagination)
  const [salesTopSearch, setSalesTopSearch] = useState('');
  const [salesTopPage, setSalesTopPage] = useState(1);
  const [salesTopRowsPerPage, setSalesTopRowsPerPage] = usePersistedRowsPerPage('sales.topProducts', 5);

  const [productsDetailSearch, setProductsDetailSearch] = useState('');
  const [productsDetailPage, setProductsDetailPage] = useState(1);
  const [productsDetailRowsPerPage, setProductsDetailRowsPerPage] = usePersistedRowsPerPage('products.detailTopProducts', 5);

  const [profitDetailSearch, setProfitDetailSearch] = useState('');
  const [profitDetailPage, setProfitDetailPage] = useState(1);
  const [profitDetailRowsPerPage, setProfitDetailRowsPerPage] = usePersistedRowsPerPage('profit.detail', 5);

  const [inventoryDetailSearch, setInventoryDetailSearch] = useState('');
  const [inventoryDetailPage, setInventoryDetailPage] = useState(1);
  const [inventoryDetailRowsPerPage, setInventoryDetailRowsPerPage] = usePersistedRowsPerPage('inventory.detail', 5);

  const [creditsSummarySearch, setCreditsSummarySearch] = useState('');
  const [creditsSummaryPage, setCreditsSummaryPage] = useState(1);
  const [creditsSummaryRowsPerPage, setCreditsSummaryRowsPerPage] = usePersistedRowsPerPage('credits.summaryByStatus', 5);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Load data based on active tab
  const loadSalesReport = useCallback(async () => {
    try {
      const [sales, top] = await Promise.all([
        getSalesByDate(startDate, endDate),
        getTopProducts(startDate, endDate, 100),
      ]);
      setSalesData(sales);
      setTopProducts(top);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar ventas';
      showNotification('error', message);
    }
  }, [startDate, endDate, getSalesByDate, getTopProducts]);

  const loadTopProductsReport = useCallback(async () => {
    try {
      const data = await getTopProducts(startDate, endDate, 200);
      setTopProducts(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar productos';
      showNotification('error', message);
    }
  }, [startDate, endDate, getTopProducts]);

  const salesTopFiltered = useMemo(() => {
    return filterByQuery(topProducts, salesTopSearch, r => [r.product_name, r.total_quantity, r.total_revenue]);
  }, [topProducts, salesTopSearch]);
  const salesTopPagination = useMemo(() => {
    return paginateRows(salesTopFiltered, salesTopPage, salesTopRowsPerPage);
  }, [salesTopFiltered, salesTopPage, salesTopRowsPerPage]);

  const productsDetailFiltered = useMemo(() => {
    return filterByQuery(topProducts, productsDetailSearch, r => [r.product_name, r.total_quantity, r.total_revenue]);
  }, [topProducts, productsDetailSearch]);
  const productsDetailPagination = useMemo(() => {
    return paginateRows(productsDetailFiltered, productsDetailPage, productsDetailRowsPerPage);
  }, [productsDetailFiltered, productsDetailPage, productsDetailRowsPerPage]);

  const profitDetailFiltered = useMemo(() => {
    return filterByQuery(profitData, profitDetailSearch, r => [
      r.product_name,
      r.total_quantity,
      r.total_revenue,
      r.total_cost,
      r.profit,
      r.margin,
    ]);
  }, [profitData, profitDetailSearch]);
  const profitDetailPagination = useMemo(() => {
    return paginateRows(profitDetailFiltered, profitDetailPage, profitDetailRowsPerPage);
  }, [profitDetailFiltered, profitDetailPage, profitDetailRowsPerPage]);

  const inventoryDetailFiltered = useMemo(() => {
    return filterByQuery(inventoryData, inventoryDetailSearch, r => [
      r.product_name,
      r.stock,
      r.cost_price,
      r.sale_price,
      r.stock_value_cost,
      r.stock_value_sale,
    ]);
  }, [inventoryData, inventoryDetailSearch]);
  const inventoryDetailPagination = useMemo(() => {
    return paginateRows(inventoryDetailFiltered, inventoryDetailPage, inventoryDetailRowsPerPage);
  }, [inventoryDetailFiltered, inventoryDetailPage, inventoryDetailRowsPerPage]);

  const creditsSummaryFiltered = useMemo(() => {
    return filterByQuery(creditsData, creditsSummarySearch, r => [
      r.status,
      CREDIT_STATUS_LABELS[r.status] || r.status,
      r.count,
      r.total_due,
      r.total_paid,
      r.total_remaining,
    ]);
  }, [creditsData, creditsSummarySearch]);
  const creditsSummaryPagination = useMemo(() => {
    return paginateRows(creditsSummaryFiltered, creditsSummaryPage, creditsSummaryRowsPerPage);
  }, [creditsSummaryFiltered, creditsSummaryPage, creditsSummaryRowsPerPage]);

  // Clamp pages when data/filter changes
  useEffect(() => {
    if (salesTopPage > salesTopPagination.totalPages) setSalesTopPage(1);
  }, [salesTopPage, salesTopPagination.totalPages]);
  useEffect(() => {
    if (productsDetailPage > productsDetailPagination.totalPages) setProductsDetailPage(1);
  }, [productsDetailPage, productsDetailPagination.totalPages]);
  useEffect(() => {
    if (profitDetailPage > profitDetailPagination.totalPages) setProfitDetailPage(1);
  }, [profitDetailPage, profitDetailPagination.totalPages]);
  useEffect(() => {
    if (inventoryDetailPage > inventoryDetailPagination.totalPages) setInventoryDetailPage(1);
  }, [inventoryDetailPage, inventoryDetailPagination.totalPages]);
  useEffect(() => {
    if (creditsSummaryPage > creditsSummaryPagination.totalPages) setCreditsSummaryPage(1);
  }, [creditsSummaryPage, creditsSummaryPagination.totalPages]);

  const loadProfitReport = useCallback(async () => {
    try {
      const data = await getProfitReport(startDate, endDate);
      setProfitData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar utilidades';
      showNotification('error', message);
    }
  }, [startDate, endDate, getProfitReport]);

  const loadInventoryReport = useCallback(async () => {
    try {
      const [items, summary] = await Promise.all([
        getInventoryReport(),
        getInventorySummary(),
      ]);
      setInventoryData(items);
      setInventorySummary(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar inventario';
      showNotification('error', message);
    }
  }, [getInventoryReport, getInventorySummary]);

  const loadCreditsReport = useCallback(async () => {
    try {
      const data = await getCreditsOverview();
      setCreditsData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar creditos';
      showNotification('error', message);
    }
  }, [getCreditsOverview]);

  // Load data when tab or date range changes
  useEffect(() => {
    switch (activeTab) {
      case 'sales': loadSalesReport(); break;
      case 'products': loadTopProductsReport(); break;
      case 'profit': loadProfitReport(); break;
      case 'inventory': loadInventoryReport(); break;
      case 'credits': loadCreditsReport(); break;
    }
  }, [activeTab, loadSalesReport, loadTopProductsReport, loadProfitReport, loadInventoryReport, loadCreditsReport]);

  // Apply preset
  function handlePreset(preset: string) {
    setActivePreset(preset);
    const dates = getPresetDates(preset);
    setStartDate(dates.start);
    setEndDate(dates.end);
  }

  // Computed summary values for sales
  const salesSummary = useMemo(() => {
    const totalSales = salesData.reduce((sum, d) => sum + d.count, 0);
    const totalRevenue = salesData.reduce((sum, d) => sum + d.total, 0);
    const totalCash = salesData.reduce((sum, d) => sum + d.total_cash, 0);
    const totalCredit = salesData.reduce((sum, d) => sum + d.total_credit, 0);
    return { totalSales, totalRevenue, totalCash, totalCredit };
  }, [salesData]);

  // Computed summary for profit
  const profitSummary = useMemo(() => {
    const totalRevenue = profitData.reduce((sum, d) => sum + d.total_revenue, 0);
    const totalCost = profitData.reduce((sum, d) => sum + d.total_cost, 0);
    const totalProfit = profitData.reduce((sum, d) => sum + d.profit, 0);
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    return { totalRevenue, totalCost, totalProfit, avgMargin };
  }, [profitData]);

  // Credits summary totals
  const creditsSummary = useMemo(() => {
    const totalDue = creditsData.reduce((sum, d) => sum + d.total_due, 0);
    const totalPaid = creditsData.reduce((sum, d) => sum + d.total_paid, 0);
    const totalRemaining = creditsData.reduce((sum, d) => sum + d.total_remaining, 0);
    const totalCount = creditsData.reduce((sum, d) => sum + d.count, 0);
    return { totalDue, totalPaid, totalRemaining, totalCount };
  }, [creditsData]);

  // Tabs that require date range
  const needsDateRange = activeTab === 'sales' || activeTab === 'products' || activeTab === 'profit';

  function renderDateFilters() {
    if (!needsDateRange) return null;

    return (
      <div className={styles.filters}>
        <div className={styles['form-field']}>
          <label className={styles['form-field__label']}>Desde</label>
          <input
            type="date"
            className={styles['form-field__input']}
            value={startDate}
            onChange={e => { setStartDate(e.target.value); setActivePreset(''); }}
          />
        </div>
        <div className={styles['form-field']}>
          <label className={styles['form-field__label']}>Hasta</label>
          <input
            type="date"
            className={styles['form-field__input']}
            value={endDate}
            onChange={e => { setEndDate(e.target.value); setActivePreset(''); }}
          />
        </div>
        <div className={styles['date-presets']}>
          {[
            { id: 'today', label: 'Hoy' },
            { id: 'week', label: '7 dias' },
            { id: 'month', label: 'Este mes' },
            { id: 'quarter', label: '3 meses' },
          ].map(preset => (
            <button
              key={preset.id}
              className={`${styles['date-preset-btn']} ${activePreset === preset.id ? styles['date-preset-btn--active'] : ''}`}
              onClick={() => handlePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderSalesTab() {
    return (
      <>
        <div className={styles.summary}>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Total Ventas</span>
            <span className={styles.summary__value}>{salesSummary.totalSales}</span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Ingresos Totales</span>
            <span className={styles.summary__value}>{formatCurrency(salesSummary.totalRevenue)}</span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Ventas Efectivo</span>
            <span className={`${styles.summary__value} ${styles['summary__value--success']}`}>
              {formatCurrency(salesSummary.totalCash)}
            </span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Ventas Credito</span>
            <span className={`${styles.summary__value} ${styles['summary__value--warning']}`}>
              {formatCurrency(salesSummary.totalCredit)}
            </span>
          </div>
        </div>

        {salesData.length > 0 ? (
          <div className={styles['chart-card']}>
            <h3 className={styles['chart-card__title']}>Ventas por Dia</h3>
            <div className={styles['chart-container']}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(val: string) => formatDate(val)}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(val: number) => `$${val}`} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelFormatter={(label) => formatDate(String(label))}
                  />
                  <Legend />
                  <Bar dataKey="total_cash" name="Efectivo" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="total_credit" name="Credito" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className={styles['empty-state']}>
            <p className={styles['empty-state__text']}>No hay ventas en el periodo seleccionado</p>
          </div>
        )}

        {topProducts.length > 0 && (
          <div className={styles['table-card']}>
            <h3 className={styles['table-card__title']}>Productos Mas Vendidos</h3>

            <div className={styles['table-controls']}>
              <input
                type="text"
                className={styles['table-controls__search']}
                placeholder="Buscar..."
                value={salesTopSearch}
                onChange={e => { setSalesTopSearch(e.target.value); setSalesTopPage(1); }}
              />

              <div className={styles['table-controls__right']}>
                <label className={styles['table-controls__label']}>
                  Filas
                  <select
                    className={styles['table-controls__select']}
                    value={salesTopRowsPerPage}
                    onChange={e => { setSalesTopRowsPerPage(Number(e.target.value)); setSalesTopPage(1); }}
                  >
                    {TABLE_ROWS_OPTIONS.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>

                <div className={styles.pager}>
                  <button
                    className={styles['pager__btn']}
                    onClick={() => setSalesTopPage(p => Math.max(1, p - 1))}
                    disabled={salesTopPage <= 1}
                  >
                    Anterior
                  </button>
                  <span className={styles['pager__text']}>
                    Pagina {Math.min(salesTopPage, salesTopPagination.totalPages)} de {salesTopPagination.totalPages}
                  </span>
                  <button
                    className={styles['pager__btn']}
                    onClick={() => setSalesTopPage(p => Math.min(salesTopPagination.totalPages, p + 1))}
                    disabled={salesTopPage >= salesTopPagination.totalPages}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {salesTopPagination.pageRows.length > 0 ? (
                  salesTopPagination.pageRows.map((p, i) => (
                    <tr key={p.product_id}>
                      <td>{(Math.min(salesTopPage, salesTopPagination.totalPages) - 1) * salesTopRowsPerPage + i + 1}</td>
                      <td>{p.product_name}</td>
                      <td>{p.total_quantity}</td>
                      <td>{formatCurrency(p.total_revenue)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.table__empty} colSpan={4}>No hay resultados</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  function renderTopProductsTab() {
    return (
      <>
        {topProducts.length > 0 ? (
          <div className={styles['charts-row']}>
            <div className={styles['chart-card']}>
              <h3 className={styles['chart-card__title']}>Top 10 por Ingresos</h3>
              <div className={styles['chart-container']}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" tickFormatter={(val: number) => `$${val}`} tick={{ fontSize: 12 }} />
                    <YAxis
                      dataKey="product_name"
                      type="category"
                      width={120}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Bar dataKey="total_revenue" name="Ingresos" fill="#1A2B3C" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={styles['chart-card']}>
              <h3 className={styles['chart-card__title']}>Top 10 por Cantidad</h3>
              <div className={styles['chart-container']}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={topProducts.slice(0, 10)}
                      dataKey="total_quantity"
                      nameKey="product_name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(props: PieLabelRenderProps) => {
                        const name = props.name ?? '';
                        const value = props.value ?? 0;
                        return `${name}: ${value}`;
                      }}
                      labelLine
                    >
                      {topProducts.slice(0, 10).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles['empty-state']}>
            <p className={styles['empty-state__text']}>No hay productos vendidos en el periodo seleccionado</p>
          </div>
        )}

        {topProducts.length > 0 && (
          <div className={styles['table-card']}>
            <h3 className={styles['table-card__title']}>Detalle de Productos Vendidos</h3>

            <div className={styles['table-controls']}>
              <input
                type="text"
                className={styles['table-controls__search']}
                placeholder="Buscar..."
                value={productsDetailSearch}
                onChange={e => { setProductsDetailSearch(e.target.value); setProductsDetailPage(1); }}
              />

              <div className={styles['table-controls__right']}>
                <label className={styles['table-controls__label']}>
                  Filas
                  <select
                    className={styles['table-controls__select']}
                    value={productsDetailRowsPerPage}
                    onChange={e => { setProductsDetailRowsPerPage(Number(e.target.value)); setProductsDetailPage(1); }}
                  >
                    {TABLE_ROWS_OPTIONS.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>

                <div className={styles.pager}>
                  <button
                    className={styles['pager__btn']}
                    onClick={() => setProductsDetailPage(p => Math.max(1, p - 1))}
                    disabled={productsDetailPage <= 1}
                  >
                    Anterior
                  </button>
                  <span className={styles['pager__text']}>
                    Pagina {Math.min(productsDetailPage, productsDetailPagination.totalPages)} de {productsDetailPagination.totalPages}
                  </span>
                  <button
                    className={styles['pager__btn']}
                    onClick={() => setProductsDetailPage(p => Math.min(productsDetailPagination.totalPages, p + 1))}
                    disabled={productsDetailPage >= productsDetailPagination.totalPages}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Producto</th>
                  <th>Cantidad Vendida</th>
                  <th>Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {productsDetailPagination.pageRows.length > 0 ? (
                  productsDetailPagination.pageRows.map((p, i) => (
                    <tr key={p.product_id}>
                      <td>{(Math.min(productsDetailPage, productsDetailPagination.totalPages) - 1) * productsDetailRowsPerPage + i + 1}</td>
                      <td>{p.product_name}</td>
                      <td>{p.total_quantity}</td>
                      <td>{formatCurrency(p.total_revenue)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.table__empty} colSpan={4}>No hay resultados</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  function renderProfitTab() {
    return (
      <>
        <div className={styles.summary}>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Ingresos Totales</span>
            <span className={styles.summary__value}>{formatCurrency(profitSummary.totalRevenue)}</span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Costo Total</span>
            <span className={`${styles.summary__value} ${styles['summary__value--error']}`}>
              {formatCurrency(profitSummary.totalCost)}
            </span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Utilidad Total</span>
            <span className={`${styles.summary__value} ${profitSummary.totalProfit >= 0 ? styles['summary__value--success'] : styles['summary__value--error']}`}>
              {formatCurrency(profitSummary.totalProfit)}
            </span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Margen Promedio</span>
            <span className={styles.summary__value}>{profitSummary.avgMargin.toFixed(1)}%</span>
          </div>
        </div>

        {profitData.length > 0 ? (
          <>
            <div className={styles['chart-card']}>
              <h3 className={styles['chart-card__title']}>Utilidad por Producto</h3>
              <div className={styles['chart-container']}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitData.slice(0, 15)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="product_name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tickFormatter={(val: number) => `$${val}`} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend />
                    <Bar dataKey="total_revenue" name="Ingresos" fill="#1A2B3C" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total_cost" name="Costo" fill="#EF4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="profit" name="Utilidad" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={styles['table-card']}>
              <h3 className={styles['table-card__title']}>Detalle de Utilidades</h3>

              <div className={styles['table-controls']}>
                <input
                  type="text"
                  className={styles['table-controls__search']}
                  placeholder="Buscar..."
                  value={profitDetailSearch}
                  onChange={e => { setProfitDetailSearch(e.target.value); setProfitDetailPage(1); }}
                />

                <div className={styles['table-controls__right']}>
                  <label className={styles['table-controls__label']}>
                    Filas
                    <select
                      className={styles['table-controls__select']}
                      value={profitDetailRowsPerPage}
                      onChange={e => { setProfitDetailRowsPerPage(Number(e.target.value)); setProfitDetailPage(1); }}
                    >
                      {TABLE_ROWS_OPTIONS.map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>

                  <div className={styles.pager}>
                    <button
                      className={styles['pager__btn']}
                      onClick={() => setProfitDetailPage(p => Math.max(1, p - 1))}
                      disabled={profitDetailPage <= 1}
                    >
                      Anterior
                    </button>
                    <span className={styles['pager__text']}>
                      Pagina {Math.min(profitDetailPage, profitDetailPagination.totalPages)} de {profitDetailPagination.totalPages}
                    </span>
                    <button
                      className={styles['pager__btn']}
                      onClick={() => setProfitDetailPage(p => Math.min(profitDetailPagination.totalPages, p + 1))}
                      disabled={profitDetailPage >= profitDetailPagination.totalPages}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </div>

              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cant.</th>
                    <th>Ingresos</th>
                    <th>Costo</th>
                    <th>Utilidad</th>
                    <th>Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {profitDetailPagination.pageRows.length > 0 ? (
                    profitDetailPagination.pageRows.map(p => (
                      <tr key={p.product_id}>
                        <td>{p.product_name}</td>
                        <td>{p.total_quantity}</td>
                        <td>{formatCurrency(p.total_revenue)}</td>
                        <td>{formatCurrency(p.total_cost)}</td>
                        <td>
                          <span className={p.profit >= 0 ? styles['profit--positive'] : styles['profit--negative']}>
                            {formatCurrency(p.profit)}
                          </span>
                        </td>
                        <td>{p.margin.toFixed(1)}%</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className={styles.table__empty} colSpan={6}>No hay resultados</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className={styles['empty-state']}>
            <p className={styles['empty-state__text']}>No hay datos de utilidades en el periodo seleccionado</p>
          </div>
        )}
      </>
    );
  }

  function renderInventoryTab() {
    return (
      <>
        {inventorySummary && (
          <div className={styles.summary}>
            <div className={styles.summary__card}>
              <span className={styles.summary__label}>Productos Activos</span>
              <span className={styles.summary__value}>{inventorySummary.total_active}</span>
            </div>
            <div className={styles.summary__card}>
              <span className={styles.summary__label}>Unidades en Stock</span>
              <span className={styles.summary__value}>{inventorySummary.total_stock_units}</span>
            </div>
            <div className={styles.summary__card}>
              <span className={styles.summary__label}>Valor (Costo)</span>
              <span className={styles.summary__value}>{formatCurrency(inventorySummary.total_value_cost)}</span>
            </div>
            <div className={styles.summary__card}>
              <span className={styles.summary__label}>Valor (Venta)</span>
              <span className={`${styles.summary__value} ${styles['summary__value--success']}`}>
                {formatCurrency(inventorySummary.total_value_sale)}
              </span>
            </div>
          </div>
        )}

        {inventorySummary && inventorySummary.low_stock_count > 0 && (
          <div className={`${styles.summary} ${styles['summary--three']}`}>
            <div className={styles.summary__card}>
              <span className={styles.summary__label}>Alerta Bajo Stock</span>
              <span className={`${styles.summary__value} ${styles['summary__value--error']}`}>
                {inventorySummary.low_stock_count} productos
              </span>
            </div>
          </div>
        )}

        {inventoryData.length > 0 ? (
          <>
            <div className={styles['chart-card']}>
              <h3 className={styles['chart-card__title']}>Top 15 Productos por Valor en Inventario</h3>
              <div className={styles['chart-container']}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={inventoryData.slice(0, 15)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="product_name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tickFormatter={(val: number) => `$${val}`} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend />
                    <Bar dataKey="stock_value_cost" name="Valor Costo" fill="#1A2B3C" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="stock_value_sale" name="Valor Venta" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={styles['table-card']}>
              <h3 className={styles['table-card__title']}>Detalle de Inventario</h3>

              <div className={styles['table-controls']}>
                <input
                  type="text"
                  className={styles['table-controls__search']}
                  placeholder="Buscar..."
                  value={inventoryDetailSearch}
                  onChange={e => { setInventoryDetailSearch(e.target.value); setInventoryDetailPage(1); }}
                />

                <div className={styles['table-controls__right']}>
                  <label className={styles['table-controls__label']}>
                    Filas
                    <select
                      className={styles['table-controls__select']}
                      value={inventoryDetailRowsPerPage}
                      onChange={e => { setInventoryDetailRowsPerPage(Number(e.target.value)); setInventoryDetailPage(1); }}
                    >
                      {TABLE_ROWS_OPTIONS.map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>

                  <div className={styles.pager}>
                    <button
                      className={styles['pager__btn']}
                      onClick={() => setInventoryDetailPage(p => Math.max(1, p - 1))}
                      disabled={inventoryDetailPage <= 1}
                    >
                      Anterior
                    </button>
                    <span className={styles['pager__text']}>
                      Pagina {Math.min(inventoryDetailPage, inventoryDetailPagination.totalPages)} de {inventoryDetailPagination.totalPages}
                    </span>
                    <button
                      className={styles['pager__btn']}
                      onClick={() => setInventoryDetailPage(p => Math.min(inventoryDetailPagination.totalPages, p + 1))}
                      disabled={inventoryDetailPage >= inventoryDetailPagination.totalPages}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </div>

              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Stock</th>
                    <th>Costo Unit.</th>
                    <th>Precio Venta</th>
                    <th>Valor Costo</th>
                    <th>Valor Venta</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryDetailPagination.pageRows.length > 0 ? (
                    inventoryDetailPagination.pageRows.map(p => (
                      <tr key={p.product_id}>
                        <td>{p.product_name}</td>
                        <td>
                          <span className={p.stock <= 5 ? styles['stock--low'] : styles['stock--ok']}>
                            {p.stock}
                          </span>
                        </td>
                        <td>{formatCurrency(p.cost_price)}</td>
                        <td>{formatCurrency(p.sale_price)}</td>
                        <td>{formatCurrency(p.stock_value_cost)}</td>
                        <td>{formatCurrency(p.stock_value_sale)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className={styles.table__empty} colSpan={6}>No hay resultados</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className={styles['empty-state']}>
            <p className={styles['empty-state__text']}>No hay productos en inventario</p>
          </div>
        )}
      </>
    );
  }

  function renderCreditsTab() {
    return (
      <>
        <div className={styles.summary}>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Total Creditos</span>
            <span className={styles.summary__value}>{creditsSummary.totalCount}</span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Monto Total</span>
            <span className={styles.summary__value}>{formatCurrency(creditsSummary.totalDue)}</span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Cobrado</span>
            <span className={`${styles.summary__value} ${styles['summary__value--success']}`}>
              {formatCurrency(creditsSummary.totalPaid)}
            </span>
          </div>
          <div className={styles.summary__card}>
            <span className={styles.summary__label}>Por Cobrar</span>
            <span className={`${styles.summary__value} ${styles['summary__value--error']}`}>
              {formatCurrency(creditsSummary.totalRemaining)}
            </span>
          </div>
        </div>

        {creditsData.length > 0 ? (
          <div className={styles['charts-row']}>
            <div className={styles['chart-card']}>
              <h3 className={styles['chart-card__title']}>Creditos por Estado</h3>
              <div className={styles['chart-container']}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={creditsData.map(d => ({ ...d, name: CREDIT_STATUS_LABELS[d.status] || d.status }))}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(props: PieLabelRenderProps) => {
                        const name = props.name ?? '';
                        const value = props.value ?? 0;
                        return `${name}: ${value}`;
                      }}
                      labelLine
                    >
                      {creditsData.map((d, i) => {
                        const colorMap: Record<string, string> = { overdue: '#EF4444', pending: '#F59E0B', paid: '#10B981' };
                        return <Cell key={i} fill={colorMap[d.status] || CHART_COLORS[i]} />;
                      })}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={styles['chart-card']}>
              <h3 className={styles['chart-card__title']}>Montos por Estado</h3>
              <div className={styles['chart-container']}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={creditsData.map(d => ({ ...d, name: CREDIT_STATUS_LABELS[d.status] || d.status }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(val: number) => `$${val}`} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend />
                    <Bar dataKey="total_due" name="Total Adeudo" fill="#1A2B3C" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total_paid" name="Pagado" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total_remaining" name="Restante" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles['empty-state']}>
            <p className={styles['empty-state__text']}>No hay creditos registrados</p>
          </div>
        )}

        {creditsData.length > 0 && (
          <div className={styles['table-card']}>
            <h3 className={styles['table-card__title']}>Resumen por Estado</h3>

            <div className={styles['table-controls']}>
              <input
                type="text"
                className={styles['table-controls__search']}
                placeholder="Buscar..."
                value={creditsSummarySearch}
                onChange={e => { setCreditsSummarySearch(e.target.value); setCreditsSummaryPage(1); }}
              />

              <div className={styles['table-controls__right']}>
                <label className={styles['table-controls__label']}>
                  Filas
                  <select
                    className={styles['table-controls__select']}
                    value={creditsSummaryRowsPerPage}
                    onChange={e => { setCreditsSummaryRowsPerPage(Number(e.target.value)); setCreditsSummaryPage(1); }}
                  >
                    {TABLE_ROWS_OPTIONS.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>

                <div className={styles.pager}>
                  <button
                    className={styles['pager__btn']}
                    onClick={() => setCreditsSummaryPage(p => Math.max(1, p - 1))}
                    disabled={creditsSummaryPage <= 1}
                  >
                    Anterior
                  </button>
                  <span className={styles['pager__text']}>
                    Pagina {Math.min(creditsSummaryPage, creditsSummaryPagination.totalPages)} de {creditsSummaryPagination.totalPages}
                  </span>
                  <button
                    className={styles['pager__btn']}
                    onClick={() => setCreditsSummaryPage(p => Math.min(creditsSummaryPagination.totalPages, p + 1))}
                    disabled={creditsSummaryPage >= creditsSummaryPagination.totalPages}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Cantidad</th>
                  <th>Total Adeudo</th>
                  <th>Pagado</th>
                  <th>Restante</th>
                </tr>
              </thead>
              <tbody>
                {creditsSummaryPagination.pageRows.length > 0 ? (
                  creditsSummaryPagination.pageRows.map(d => (
                    <tr key={d.status}>
                      <td>
                        <span className={`${styles.badge} ${styles[`badge--${d.status}`]}`}>
                          {CREDIT_STATUS_LABELS[d.status] || d.status}
                        </span>
                      </td>
                      <td>{d.count}</td>
                      <td>{formatCurrency(d.total_due)}</td>
                      <td>{formatCurrency(d.total_paid)}</td>
                      <td>{formatCurrency(d.total_remaining)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.table__empty} colSpan={5}>No hay resultados</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  function renderTabContent() {
    if (loading) {
      return (
        <div className={styles['empty-state']}>
          <p className={styles['empty-state__text']}>Cargando reporte...</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'sales': return renderSalesTab();
      case 'products': return renderTopProductsTab();
      case 'profit': return renderProfitTab();
      case 'inventory': return renderInventoryTab();
      case 'credits': return renderCreditsTab();
      default: return null;
    }
  }

  return (
    <div className={styles.page}>
      {notification && (
        <div className={`${styles.notification} ${styles[`notification--${notification.type}`]}`}>
          {notification.message}
        </div>
      )}

      <div className={styles.page__header}>
        <h1 className={styles.page__title}>Reportes y Estadisticas</h1>
      </div>

      <div className={styles.tabs}>
        {([
          { id: 'sales' as ReportTab, label: 'Ventas' },
          { id: 'products' as ReportTab, label: 'Productos' },
          { id: 'profit' as ReportTab, label: 'Utilidades' },
          { id: 'inventory' as ReportTab, label: 'Inventario' },
          { id: 'credits' as ReportTab, label: 'Creditos' },
        ]).map(tab => (
          <button
            key={tab.id}
            className={`${styles.tabs__item} ${activeTab === tab.id ? styles['tabs__item--active'] : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {renderDateFilters()}
      {renderTabContent()}
    </div>
  );
}
