import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, AlertTriangle, Pencil, Trash2, Layers, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProducts } from '../hooks/useProducts';
import { useCategories } from '../hooks/useCategories';
import { useSettings } from '../hooks/useSettings';
import { formatCurrency } from '../lib/formatters';
import { ProductForm } from '../components/products/ProductForm';
import { CategoryManager } from '../components/categories/CategoryManager';
import type { Product, PaginatedResponse } from '../types';
import styles from './ProductsPage.module.css';

type ViewMode = 'list' | 'form' | 'categories';

const ROWS_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

export function ProductsPage() {
  const {
    lowStockProducts,
    loading: productsLoading,
    error,
    fetchProductsPaginated,
    createProduct,
    updateProduct,
    deleteProduct,
    canDeleteProductPermanently,
    deleteProductPermanently,
  } = useProducts();
  const { categories, fetchCategories } = useCategories();
  const { settings, fetchSettings } = useSettings();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Product | null>(null);
  const [canDeletePermanently, setCanDeletePermanently] = useState(false);
  const [checkingPermanentDelete, setCheckingPermanentDelete] = useState(false);
  const [permanentDeleteCheckError, setPermanentDeleteCheckError] = useState<string | null>(null);
  const [openingNewProduct, setOpeningNewProduct] = useState(false);

  // Paginated state
  const [paginatedData, setPaginatedData] = useState<PaginatedResponse<Product> | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(15);
  const [loading, setLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFiltersRef = useRef<{
    category: number | '';
    status: 'all' | 'active' | 'inactive';
    lowStock: boolean;
  }>({
    category: '',
    status: 'active',
    lowStock: false,
  });
  const loadPageRef = useRef<((
    page: number,
    search: string,
    category: number | '',
    status: string,
    lowStock: boolean,
  ) => Promise<void>) | null>(null);

  // Fetch paginated data from server
  const loadPage = useCallback(async (page: number, search: string, category: number | '', status: string, lowStock: boolean) => {
    try {
      setLoading(true);
      const query: {
        page: number;
        pageSize: number;
        search?: string;
        status?: string;
        categoryId?: number;
        lowStock?: boolean;
      } = {
        page,
        pageSize: rowsPerPage,
      };

      if (search.trim()) query.search = search;
      if (status !== 'all') query.status = status;
      if (category !== '') query.categoryId = category;
      if (lowStock) query.lowStock = true;

      const result = await fetchProductsPaginated(query);
      setPaginatedData(result);
    } catch (err) {
      console.error('ProductsPage.loadPage:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchProductsPaginated, rowsPerPage]);

  // Reload current page
  const reloadCurrentPage = useCallback(() => {
    loadPage(currentPage, searchQuery, filterCategory, filterStatus, filterLowStock);
  }, [loadPage, currentPage, searchQuery, filterCategory, filterStatus, filterLowStock]);

  useEffect(() => {
    latestFiltersRef.current = {
      category: filterCategory,
      status: filterStatus,
      lowStock: filterLowStock,
    };
  }, [filterCategory, filterStatus, filterLowStock]);

  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);

  // Load data when filters or page change
  useEffect(() => {
    loadPage(currentPage, searchQuery, filterCategory, filterStatus, filterLowStock);
  }, [loadPage, currentPage, filterCategory, filterStatus, filterLowStock]);

  // Load persisted settings (including default margin percent for new products)
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Debounced search: reset page and reload on search change
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      const { category, status, lowStock } = latestFiltersRef.current;
      if (!loadPageRef.current) return;
      setCurrentPage(1);
      loadPageRef.current(1, searchQuery, category, status, lowStock);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Load persisted rows per page
  useEffect(() => {
    async function loadPersistedRows() {
      try {
        const persisted = await window.electronAPI.settings.get('products_rows_per_page');
        const parsed = Number(persisted);
        if (Number.isInteger(parsed) && ROWS_OPTIONS.includes(parsed as (typeof ROWS_OPTIONS)[number])) {
          setRowsPerPage(parsed);
        }
      } catch (err) {
        console.error('ProductsPage.loadPersistedRows:', err);
      }
    }
    void loadPersistedRows();
  }, []);

  async function handleRowsPerPageChange(value: number) {
    setRowsPerPage(value);
    setCurrentPage(1);
    try {
      await window.electronAPI.settings.set('products_rows_per_page', String(value));
    } catch (err) {
      console.error('ProductsPage.handleRowsPerPageChange:', err);
    }
  }

  const displayedProducts = paginatedData?.items ?? [];
  const totalProducts = paginatedData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalProducts / rowsPerPage));
  const isLoading = loading || productsLoading;

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Category name lookup
  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    categories.forEach(c => map.set(c.id, c.name));
    return map;
  }, [categories]);

  async function handleNewProduct() {
    setOpeningNewProduct(true);
    try {
      // Force latest cloud-managed defaults before opening create form.
      await fetchSettings();
      setEditingProduct(null);
      setViewMode('form');
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'No se pudo cargar configuracion');
    } finally {
      setOpeningNewProduct(false);
    }
  }

  function handleEditProduct(product: Product) {
    setEditingProduct(product);
    setViewMode('form');
  }

  function handleDeleteProduct(product: Product) {
    setDeleteCandidate(product);
  }

  async function handleConfirmDelete() {
    if (!deleteCandidate) return;
    try {
      await deleteProduct(deleteCandidate.id);
      showNotification('success', `"${deleteCandidate.name}" fue desactivado`);
      reloadCurrentPage();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setDeleteCandidate(null);
    }
  }

  async function handleConfirmPermanentDelete() {
    if (!deleteCandidate) return;
    try {
      await deleteProductPermanently(deleteCandidate.id);
      showNotification('success', `"${deleteCandidate.name}" fue eliminado permanentemente`);
      reloadCurrentPage();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al eliminar permanentemente');
    } finally {
      setDeleteCandidate(null);
    }
  }

  useEffect(() => {
    let isMounted = true;

    if (!deleteCandidate) {
      setCanDeletePermanently(false);
      setCheckingPermanentDelete(false);
      setPermanentDeleteCheckError(null);
      return;
    }

    setCheckingPermanentDelete(true);
    setCanDeletePermanently(false);
    setPermanentDeleteCheckError(null);

    canDeleteProductPermanently(deleteCandidate.id)
      .then(canDelete => {
        if (!isMounted) return;
        setCanDeletePermanently(canDelete);
      })
      .catch(err => {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : 'No se pudo validar la eliminacion permanente';
        setPermanentDeleteCheckError(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setCheckingPermanentDelete(false);
      });

    return () => {
      isMounted = false;
    };
  }, [deleteCandidate, canDeleteProductPermanently]);

  async function handleFormSubmit(data: {
    barcode: string;
    name: string;
    description?: string | null;
    category_id?: number | null;
    cost_price: number;
    margin_percent: number;
    stock?: number;
    min_stock?: number;
  }) {
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
        showNotification('success', `"${data.name}" actualizado`);
      } else {
        await createProduct(data);
        showNotification('success', `"${data.name}" creado`);
      }
      setViewMode('list');
      setEditingProduct(null);
      reloadCurrentPage();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al guardar');
    }
  }

  function handleCancel() {
    setViewMode('list');
    setEditingProduct(null);
  }

  function getStockClass(product: Product): string {
    if (product.stock === 0) return styles['table__stock--out'];
    if (product.min_stock < 0) return styles['table__stock--neutral'];
    if (product.stock <= product.min_stock) return styles['table__stock--low'];
    return styles['table__stock--ok'];
  }

  // Categories view
  if (viewMode === 'categories') {
    return (
      <div className={styles.page}>
        <div className={styles['page__header']}>
          <h1 className={styles['page__title']}>Categorias</h1>
          <button
            className={styles['btn-secondary']}
            onClick={() => { fetchCategories(); setViewMode('list'); }}
          >
            Volver a productos
          </button>
        </div>
        <CategoryManager showHeader={false} />
      </div>
    );
  }

  // Form view
  if (viewMode === 'form') {
    return (
      <div className={styles.page}>
        <div className={styles['page__header']}>
          <h1 className={styles['page__title']}>
            {editingProduct ? 'Editar producto' : 'Nuevo producto'}
          </h1>
          <button className={styles['btn-secondary']} onClick={handleCancel}>
            Cancelar
          </button>
        </div>
        <ProductForm
          product={editingProduct}
          categories={categories}
          defaultMarginPercent={
            Number.isFinite(Number(settings.default_margin_percent))
              ? Number(settings.default_margin_percent)
              : 50
          }
          onSubmit={handleFormSubmit}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  // List view
  return (
    <div className={styles.page}>
      {/* Notification toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: 24,
          right: 24,
          padding: '12px 20px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: notification.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
          color: '#fff',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {notification.message}
        </div>
      )}

      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Productos</h1>
        <div className={styles['page__actions']}>
          {lowStockProducts.length > 0 && (
            <button
              className={`${styles['low-stock-alert-btn']} ${filterLowStock ? styles['low-stock-alert-btn--active'] : ''}`}
              onClick={() => setFilterLowStock(!filterLowStock)}
              title="Filtrar por stock bajo"
            >
              <AlertTriangle size={14} strokeWidth={2} />
              {lowStockProducts.length}
            </button>
          )}
          <button className={styles['btn-secondary']} onClick={() => setViewMode('categories')}>
            <Layers size={16} strokeWidth={1.5} />
            Categorias
          </button>
          <button className={styles['btn-primary']} onClick={handleNewProduct} disabled={openingNewProduct}>
            <Plus size={16} strokeWidth={1.5} />
            {openingNewProduct ? 'Cargando...' : 'Nuevo producto'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles['toolbar__search']}>
          <Search size={16} strokeWidth={1.5} className={styles['toolbar__search-icon']} />
          <input
            className={styles['toolbar__search-input']}
            type="text"
            placeholder="Buscar por nombre, codigo de barras..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className={styles['toolbar__filter']}
          value={filterCategory}
          onChange={e => { setFilterCategory(e.target.value ? Number(e.target.value) : ''); setCurrentPage(1); }}
        >
          <option value="">Todas las categorias</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          className={styles['toolbar__filter']}
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value as 'all' | 'active' | 'inactive'); setCurrentPage(1); }}
        >
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <select
          className={styles['toolbar__filter']}
          value={filterLowStock ? 'low' : 'all'}
          onChange={e => { setFilterLowStock(e.target.value === 'low'); setCurrentPage(1); }}
        >
          <option value="all">Todos los productos</option>
          <option value="low">Solo stock bajo</option>
        </select>
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

      {/* Products table */}
      <div className={styles['table-card']}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoria</th>
              <th style={{ textAlign: 'right' }}>Costo</th>
              <th style={{ textAlign: 'right' }}>Precio venta</th>
              <th style={{ textAlign: 'center' }}>%</th>
              <th style={{ textAlign: 'center' }}>Stock</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className={styles['table__empty']}>Cargando productos...</td>
              </tr>
            ) : displayedProducts.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles['table__empty']}>
                  {searchQuery || filterCategory !== '' ? 'No se encontraron productos con esos filtros' : 'No hay productos registrados'}
                </td>
              </tr>
            ) : (
              displayedProducts.map(product => (
                <tr key={product.id} className={product.is_active === 0 ? styles['table__inactive'] : undefined}>
                  <td>
                    <div className={styles['table__name']}>{product.name}</div>
                    <div className={styles['table__barcode']}>{product.barcode}</div>
                  </td>
                  <td className={styles['table__category']}>
                    {product.category_id ? categoryMap.get(product.category_id) ?? '-' : '-'}
                  </td>
                  <td className={styles['table__cost']}>{formatCurrency(product.cost_price)}</td>
                  <td className={styles['table__price']}>{formatCurrency(product.sale_price)}</td>
                  <td style={{ textAlign: 'center', fontSize: 'var(--font-size-sm)' }}>
                    {product.margin_percent}%
                  </td>
                  <td className={`${styles['table__stock']} ${getStockClass(product)}`}>
                    {product.stock}
                    {product.min_stock < 0 && product.is_active === 1 && (
                      <span className={styles['table__meta-badge']}>Sin alerta</span>
                    )}
                    {product.min_stock >= 0 && product.stock <= product.min_stock && product.is_active === 1 && (
                      <AlertTriangle size={12} strokeWidth={2} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                    )}
                  </td>
                  <td>
                    <span className={`${styles['table__badge']} ${product.is_active === 1 ? styles['table__badge--active'] : styles['table__badge--inactive']}`}>
                      {product.is_active === 1 ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className={styles['table__actions']}>
                      <button className={styles['btn-icon']} onClick={() => handleEditProduct(product)} title="Editar">
                        <Pencil size={16} strokeWidth={1.5} />
                      </button>
                      {product.is_active === 1 && (
                        <button
                          className={`${styles['btn-icon']} ${styles['btn-icon--danger']}`}
                          onClick={() => handleDeleteProduct(product)}
                          title="Desactivar"
                        >
                          <Trash2 size={16} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <section className={styles.pagination}>
        <span className={styles['pagination__info']}>
          Mostrando {displayedProducts.length} de {totalProducts} productos
        </span>
        <div className={styles['pagination__actions']}>
          <button
            className={styles['pagination__btn']}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
            Anterior
          </button>
          <span className={styles['pagination__page']}>
            Pagina {currentPage} de {totalPages}
          </span>
          <button
            className={styles['pagination__btn']}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            Siguiente
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
        </div>
      </section>

      {deleteCandidate && (
        <div className={styles['modal-overlay']} role="dialog" aria-modal="true" aria-labelledby="delete-product-title">
          <div className={styles.modal}>
            <div className={styles['modal__header']}>
              <h3 id="delete-product-title" className={styles['modal__title']}>
                Confirmar desactivacion
              </h3>
              <button
                type="button"
                className={styles['modal__close']}
                onClick={() => setDeleteCandidate(null)}
                aria-label="Cerrar modal"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <p className={styles['modal__text']}>
              Estas seguro que deseas desactivar el producto &ldquo;{deleteCandidate.name}&rdquo;?
            </p>
            <p className={styles['modal__hint']}>
              El producto no se eliminara permanentemente, solo dejara de estar disponible.
            </p>
            {checkingPermanentDelete && (
              <p className={styles['modal__hint']}>Validando si se puede eliminar permanentemente...</p>
            )}
            {!checkingPermanentDelete && permanentDeleteCheckError && (
              <p className={styles['modal__hint']}>{permanentDeleteCheckError}</p>
            )}
            {!checkingPermanentDelete && !permanentDeleteCheckError && !canDeletePermanently && (
              <p className={styles['modal__hint']}>
                Este producto no se puede eliminar permanentemente porque esta asociado a una o mas ventas.
              </p>
            )}
            {!checkingPermanentDelete && !permanentDeleteCheckError && canDeletePermanently && (
              <p className={styles['modal__hint']}>
                Este producto no tiene ventas asociadas, puedes eliminarlo permanentemente si lo deseas.
              </p>
            )}
            <div className={styles['modal__actions']}>
              <button type="button" className={styles['btn-secondary']} onClick={() => setDeleteCandidate(null)}>
                Cancelar
              </button>
              <button type="button" className={styles['btn-danger']} onClick={handleConfirmDelete}>
                Desactivar producto
              </button>
              {!checkingPermanentDelete && !permanentDeleteCheckError && canDeletePermanently && (
                <button type="button" className={styles['btn-danger']} onClick={handleConfirmPermanentDelete}>
                  Eliminar permanentemente
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
