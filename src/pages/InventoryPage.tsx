import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, PackagePlus, SlidersHorizontal, X, Search } from 'lucide-react';
import { useInventory } from '../hooks/useInventory';
import { useProducts } from '../hooks/useProducts';
import { formatDateTime } from '../lib/formatters';
import type { Product, PaginatedQuery, InventoryMovementListItem } from '../types';
import styles from './InventoryPage.module.css';

type TabId = 'movements' | 'restock' | 'adjustment';
type MovementTypeFilter = 'all' | 'in' | 'out' | 'adjustment';
const MAX_FORM_PRODUCT_OPTIONS = 100;
const ROWS_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

const TYPE_LABELS: Record<string, string> = {
  in: 'Entrada',
  out: 'Salida',
  adjustment: 'Ajuste',
};

export function InventoryPage() {
  const { fetchMovementsPaginated, addMovement } = useInventory();
  const { products, fetchProducts } = useProducts();

  const [activeTab, setActiveTab] = useState<TabId>('movements');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Movements list state (server-side pagination)
  const [movementItems, setMovementItems] = useState<InventoryMovementListItem[]>([]);
  const [totalMovements, setTotalMovements] = useState(0);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(15);

  // Search and filters for movements
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<MovementTypeFilter>('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form state
  const [formProductId, setFormProductId] = useState<number | ''>('');
  const [formProductQuery, setFormProductQuery] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formCostPrice, setFormCostPrice] = useState('');
  const [formMarginPercent, setFormMarginPercent] = useState('');
  const [formSalePrice, setFormSalePrice] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clearForm = useCallback(() => {
    setFormProductId('');
    setFormProductQuery('');
    setFormQuantity('');
    setFormCostPrice('');
    setFormMarginPercent('');
    setFormSalePrice('');
    setFormNotes('');
    setFormError(null);
  }, []);

  useEffect(() => {
    clearForm();
  }, [activeTab, clearForm]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 350);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Load persisted rows per page
  useEffect(() => {
    async function loadPersistedRows() {
      try {
        const persisted = await window.electronAPI.settings.get('inventory_rows_per_page');
        const parsed = Number(persisted);
        if (Number.isInteger(parsed) && ROWS_OPTIONS.includes(parsed as (typeof ROWS_OPTIONS)[number])) {
          setRowsPerPage(parsed);
        }
      } catch (err) {
        console.error('InventoryPage.loadPersistedRows:', err);
      }
    }
    void loadPersistedRows();
  }, []);

  async function handleRowsPerPageChange(value: number) {
    setRowsPerPage(value);
    setCurrentPage(1);
    try {
      await window.electronAPI.settings.set('inventory_rows_per_page', String(value));
    } catch (err) {
      console.error('InventoryPage.handleRowsPerPageChange:', err);
    }
  }

  const hasInvalidDateRange = Boolean(
    startDateFilter
      && endDateFilter
      && new Date(`${startDateFilter}T00:00:00`) > new Date(`${endDateFilter}T23:59:59.999`),
  );

  // Load movements with server-side pagination
  const loadMovements = useCallback(async () => {
    setLoadingMovements(true);
    setMovementsError(null);
    try {
      const query: PaginatedQuery = {
        page: currentPage,
        pageSize: rowsPerPage,
        search: debouncedSearch || undefined,
        type: movementTypeFilter !== 'all' ? movementTypeFilter : undefined,
        dateFrom: startDateFilter || undefined,
        dateTo: endDateFilter || undefined,
      };

      const result = await fetchMovementsPaginated(query);
      setMovementItems(result.items);
      setTotalMovements(result.total);
    } catch (err) {
      console.error('InventoryPage.loadMovements:', err);
      setMovementsError('Error al cargar movimientos');
    } finally {
      setLoadingMovements(false);
    }
  }, [currentPage, rowsPerPage, debouncedSearch, movementTypeFilter, startDateFilter, endDateFilter, fetchMovementsPaginated]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalMovements / rowsPerPage)),
    [totalMovements, rowsPerPage],
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function handleTypeFilterChange(value: MovementTypeFilter) {
    setMovementTypeFilter(value);
    setCurrentPage(1);
  }

  function handleStartDateFilterChange(value: string) {
    setStartDateFilter(value);
    setCurrentPage(1);
  }

  function handleEndDateFilterChange(value: string) {
    setEndDateFilter(value);
    setCurrentPage(1);
  }

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Product lookup map (still needed for form)
  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach(p => map.set(p.id, p));
    return map;
  }, [products]);

  // Active products for selection
  const activeProducts = useMemo(() => {
    return products.filter(p => p.is_active === 1).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const formProductOptions = useMemo(() => {
    const query = formProductQuery.trim().toLowerCase();
    if (!query) {
      return activeProducts.slice(0, MAX_FORM_PRODUCT_OPTIONS);
    }

    return activeProducts
      .filter(product => {
        const nameMatches = product.name.toLowerCase().includes(query);
        const barcodeMatches = product.barcode.toLowerCase().includes(query);
        return nameMatches || barcodeMatches;
      })
      .slice(0, MAX_FORM_PRODUCT_OPTIONS);
  }, [activeProducts, formProductQuery]);

  const selectedProduct = formProductId !== '' ? productMap.get(formProductId) : null;

  const handleCostPriceChange = useCallback((value: string) => {
    setFormCostPrice(value);

    const cost = Number(value);
    if (!Number.isFinite(cost) || cost <= 0) {
      setFormMarginPercent('');
      setFormSalePrice('');
      return;
    }

    const sale = Number(formSalePrice);
    if (Number.isFinite(sale) && sale > 0) {
      const margin = ((sale / cost) - 1) * 100;
      setFormMarginPercent(margin.toFixed(2));
      return;
    }

    const margin = Number(formMarginPercent);
    if (formMarginPercent.trim() !== '' && Number.isFinite(margin)) {
      const nextSalePrice = cost * (1 + margin / 100);
      setFormSalePrice(nextSalePrice.toFixed(2));
    } else {
      setFormSalePrice('');
    }
  }, [formMarginPercent, formSalePrice]);

  const handleMarginPercentChange = useCallback((value: string) => {
    setFormMarginPercent(value);

    const cost = Number(formCostPrice);
    const margin = Number(value);

    if (!Number.isFinite(cost) || cost <= 0 || value.trim() === '' || !Number.isFinite(margin)) {
      setFormSalePrice('');
      return;
    }

    const nextSalePrice = cost * (1 + margin / 100);
    setFormSalePrice(nextSalePrice.toFixed(2));
  }, [formCostPrice]);

  const handleSalePriceChange = useCallback((value: string) => {
    setFormSalePrice(value);

    const cost = Number(formCostPrice);
    const sale = Number(value);

    if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(sale) || sale <= 0) {
      setFormMarginPercent('');
      return;
    }

    const nextMargin = ((sale / cost) - 1) * 100;
    setFormMarginPercent(nextMargin.toFixed(2));
  }, [formCostPrice]);

  useEffect(() => {
    if (activeTab !== 'restock' || !selectedProduct) {
      return;
    }

    setFormCostPrice(selectedProduct.cost_price.toFixed(2));
    setFormMarginPercent(selectedProduct.margin_percent.toFixed(2));
    setFormSalePrice(selectedProduct.sale_price.toFixed(2));
  }, [activeTab, selectedProduct]);

  function getMovementType(): 'in' | 'adjustment' {
    return activeTab === 'restock' ? 'in' : 'adjustment';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (formProductId === '') {
      setFormError('Selecciona un producto');
      return;
    }

    const qty = parseInt(formQuantity);
    if (isNaN(qty) || qty === 0) {
      setFormError('La cantidad debe ser mayor a 0');
      return;
    }

    // For restock, quantity is always positive
    // For adjustment, it can be positive (add) or negative (remove)
    const movementType = getMovementType();
    const finalQuantity = movementType === 'in' ? Math.abs(qty) : qty;

    let costPrice: number | undefined;
    let marginPercent: number | undefined;

    if (movementType === 'in') {
      const parsedCost = Number(formCostPrice);
      const parsedMargin = Number(formMarginPercent);

      if (!Number.isFinite(parsedCost) || parsedCost <= 0) {
        setFormError('El precio de costo debe ser mayor a 0');
        return;
      }

      if (formMarginPercent.trim() === '') {
        setFormError('El % de utilidad es requerido');
        return;
      }

      if (!Number.isFinite(parsedMargin) || parsedMargin < 0) {
        setFormError('El % de utilidad no puede ser negativo');
        return;
      }

      costPrice = Number(parsedCost.toFixed(2));
      marginPercent = Number(parsedMargin.toFixed(2));
    }

    setSubmitting(true);
    try {
      await addMovement({
        product_id: formProductId as number,
        type: movementType,
        quantity: finalQuantity,
        notes: formNotes.trim() || null,
        cost_price: costPrice,
        margin_percent: marginPercent,
      });

      // Refresh products to reflect updated stock
      await fetchProducts();
      await loadMovements();

      const productName = selectedProduct?.name ?? 'Producto';
      showNotification('success',
        movementType === 'in'
          ? `+${finalQuantity} unidades de "${productName}" registradas`
          : `Ajuste de ${finalQuantity > 0 ? '+' : ''}${finalQuantity} unidades en "${productName}"`
      );

      // Reset form
      clearForm();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al registrar movimiento');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* Notification */}
      {notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
          {notification.message}
        </div>
      )}

      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Inventario</h1>
      </div>

      {movementsError && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{movementsError}</p>}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles['tabs__item']} ${activeTab === 'movements' ? styles['tabs__item--active'] : ''}`}
          onClick={() => setActiveTab('movements')}
        >
          Historial
        </button>
        <button
          className={`${styles['tabs__item']} ${activeTab === 'restock' ? styles['tabs__item--active'] : ''}`}
          onClick={() => setActiveTab('restock')}
        >
          <PackagePlus size={14} strokeWidth={1.5} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Entrada de mercancia
        </button>
        <button
          className={`${styles['tabs__item']} ${activeTab === 'adjustment' ? styles['tabs__item--active'] : ''}`}
          onClick={() => setActiveTab('adjustment')}
        >
          <SlidersHorizontal size={14} strokeWidth={1.5} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Ajuste
        </button>
      </div>

      {/* Restock / Adjustment form */}
      {(activeTab === 'restock' || activeTab === 'adjustment') && (
        <div className={styles['form-card']}>
          <h2 className={styles['form-card__title']}>
            {activeTab === 'restock' ? 'Registrar entrada de mercancia' : 'Ajuste de inventario'}
          </h2>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles['form__field']}>
              <label className={styles['form__label']}>Producto *</label>
              <input
                className={styles['form__input']}
                type="search"
                value={formProductQuery}
                onChange={e => setFormProductQuery(e.target.value)}
                placeholder="Buscar por nombre o codigo..."
              />
              <select
                className={styles['form__select']}
                value={formProductId}
                onChange={e => setFormProductId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Seleccionar producto...</option>
                {formProductOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>
                ))}
              </select>
              <span className={styles['form__hint']}>
                Mostrando hasta {MAX_FORM_PRODUCT_OPTIONS} productos por busqueda.
              </span>
            </div>

            {selectedProduct && (
              <div className={styles['form__product-info']}>
                <strong>{selectedProduct.name}</strong> - Codigo: {selectedProduct.barcode} - Stock actual: <strong>{selectedProduct.stock}</strong>
              </div>
            )}

            <div className={styles['form__row']}>
              <div className={styles['form__field']}>
                <label className={styles['form__label']}>
                  Cantidad *
                </label>
                <input
                  className={`${styles['form__input']} ${formError ? styles['form__input--error'] : ''}`}
                  type="number"
                  value={formQuantity}
                  onChange={e => setFormQuantity(e.target.value)}
                  placeholder={activeTab === 'adjustment' ? 'Positivo o negativo' : 'Unidades a agregar'}
                  min={activeTab === 'restock' ? '1' : undefined}
                />
                {activeTab === 'adjustment' && (
                  <span className={styles['form__hint']}>Positivo = agregar, negativo = quitar</span>
                )}
              </div>

              {activeTab === 'restock' && (
                <div className={styles['form__field']}>
                  <label className={styles['form__label']}>Precio de costo *</label>
                  <input
                    className={`${styles['form__input']} ${formError ? styles['form__input--error'] : ''}`}
                    type="number"
                    value={formCostPrice}
                    onChange={e => handleCostPriceChange(e.target.value)}
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>

            {activeTab === 'restock' && (
              <>
                <div className={styles['form__field']}>
                  <label className={styles['form__label']}>% de utilidad *</label>
                  <input
                    className={`${styles['form__input']} ${formError ? styles['form__input--error'] : ''}`}
                    type="number"
                    value={formMarginPercent}
                    onChange={e => handleMarginPercentChange(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>

                <div className={styles['form__price-preview']}>
                  <div className={styles['form__price-preview-item']}>
                    <span className={styles['form__hint']}>Precio venta actual</span>
                    <strong>
                      {selectedProduct ? `$${selectedProduct.sale_price.toFixed(2)}` : '-'}
                    </strong>
                  </div>
                  <div className={styles['form__price-preview-item']}>
                    <span className={styles['form__hint']}>Precio venta nuevo</span>
                    <input
                      className={styles['form__price-input']}
                      type="number"
                      value={formSalePrice}
                      onChange={e => handleSalePriceChange(e.target.value)}
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </>
            )}

            <div className={styles['form__field']}>
              <label className={styles['form__label']}>Notas</label>
              <textarea
                className={styles['form__textarea']}
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Razon del movimiento (opcional)"
              />
            </div>

            {formError && <p className={styles['form__error']}>{formError}</p>}

            <div className={styles['form__actions']}>
              <button type="submit" className={styles['btn-primary']} disabled={submitting}>
                <Plus size={16} strokeWidth={1.5} />
                {activeTab === 'restock' ? 'Registrar entrada' : 'Registrar ajuste'}
              </button>
              <button type="button" className={styles['btn-ghost']} onClick={clearForm}>
                <X size={14} strokeWidth={1.5} />
                Limpiar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Movements history */}
      {activeTab === 'movements' && (
        <>
          <div className={styles.toolbar}>
            <div className={styles['search-box']}>
              <Search size={16} strokeWidth={1.5} className={styles['search-box__icon']} />
              <input
                className={styles['search-box__input']}
                type="search"
                placeholder="Buscar por producto o codigo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className={styles['toolbar__filter']}
              value={movementTypeFilter}
              onChange={(e) => handleTypeFilterChange(e.target.value as MovementTypeFilter)}
            >
              <option value="all">Todos los tipos</option>
              <option value="in">Entradas</option>
              <option value="out">Salidas</option>
              <option value="adjustment">Ajustes</option>
            </select>

            <div className={styles['toolbar__date-group']}>
              <input
                className={styles['toolbar__filter']}
                type="date"
                value={startDateFilter}
                onChange={(e) => handleStartDateFilterChange(e.target.value)}
              />
              <span>-</span>
              <input
                className={styles['toolbar__filter']}
                type="date"
                value={endDateFilter}
                onChange={(e) => handleEndDateFilterChange(e.target.value)}
              />
            </div>

            <select
              className={styles['toolbar__filter']}
              value={rowsPerPage}
              onChange={(e) => void handleRowsPerPageChange(Number(e.target.value))}
            >
              {ROWS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} filas
                </option>
              ))}
            </select>
          </div>

          {hasInvalidDateRange && (
            <p className={styles['toolbar__hint--error']}>
              La fecha inicial no puede ser posterior a la fecha final
            </p>
          )}

          <div className={styles['table-card']}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'center' }}>Cantidad</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {loadingMovements ? (
                  <tr><td colSpan={5} className={styles['table__empty']}>Cargando...</td></tr>
                ) : movementItems.length === 0 ? (
                  <tr><td colSpan={5} className={styles['table__empty']}>No hay movimientos con los filtros actuales</td></tr>
                ) : (
                  movementItems.map(mov => {
                    const isPositive = mov.type === 'in' || (mov.type === 'adjustment' && mov.quantity > 0);
                    return (
                      <tr key={mov.id}>
                        <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                          {formatDateTime(mov.created_at)}
                        </td>
                        <td>{mov.product_name}</td>
                        <td>
                          <span className={`${styles['table__badge']} ${styles[`table__badge--${mov.type}`]}`}>
                            {TYPE_LABELS[mov.type] ?? mov.type}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={isPositive ? styles['table__quantity--positive'] : styles['table__quantity--negative']}>
                            {isPositive ? '+' : ''}{mov.quantity}
                          </span>
                        </td>
                        <td style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                          {mov.notes ?? '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <section className={styles.pagination}>
            <span className={styles['pagination__meta']}>
              Mostrando {movementItems.length} de {totalMovements} movimientos
            </span>
            <div className={styles['pagination__actions']}>
              <button
                className={styles['btn-secondary']}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
              >
                Anterior
              </button>
              <span className={styles['pagination__page']}>
                Pagina {currentPage} de {totalPages}
              </span>
              <button
                className={styles['btn-secondary']}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Siguiente
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
