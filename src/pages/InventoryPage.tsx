import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, PackagePlus, SlidersHorizontal, X } from 'lucide-react';
import { useInventory } from '../hooks/useInventory';
import { useProducts } from '../hooks/useProducts';
import { formatDateTime } from '../lib/formatters';
import type { Product } from '../types';
import styles from './InventoryPage.module.css';

type TabId = 'movements' | 'restock' | 'adjustment';
const MAX_FORM_PRODUCT_OPTIONS = 100;

const TYPE_LABELS: Record<string, string> = {
  in: 'Entrada',
  out: 'Salida',
  adjustment: 'Ajuste',
};

export function InventoryPage() {
  const { movements, loading, error, fetchMovements, addMovement } = useInventory();
  const { products, fetchProducts } = useProducts();

  const [activeTab, setActiveTab] = useState<TabId>('movements');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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

  // Filter for movements list
  const [filterProductId, setFilterProductId] = useState<number | ''>('');

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

  // Clear form every time the active tab changes
  useEffect(() => {
    clearForm();
  }, [activeTab, clearForm]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Product lookup map
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

  // Filtered movements
  const filteredMovements = useMemo(() => {
    if (filterProductId === '') return movements;
    return movements.filter(m => m.product_id === filterProductId);
  }, [movements, filterProductId]);

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
      await fetchMovements();

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

      {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>}

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
            <select
              className={styles['toolbar__filter']}
              value={filterProductId}
              onChange={e => setFilterProductId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Todos los productos</option>
              {activeProducts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

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
                {loading ? (
                  <tr><td colSpan={5} className={styles['table__empty']}>Cargando...</td></tr>
                ) : filteredMovements.length === 0 ? (
                  <tr><td colSpan={5} className={styles['table__empty']}>No hay movimientos registrados</td></tr>
                ) : (
                  filteredMovements.map(mov => {
                    const product = productMap.get(mov.product_id);
                    const isPositive = mov.type === 'in' || (mov.type === 'adjustment' && mov.quantity > 0);
                    return (
                      <tr key={mov.id}>
                        <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                          {formatDateTime(mov.created_at)}
                        </td>
                        <td>{product?.name ?? `Producto #${mov.product_id}`}</td>
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
        </>
      )}
    </div>
  );
}
