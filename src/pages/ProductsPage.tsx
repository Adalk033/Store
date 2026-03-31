import { useState, useMemo } from 'react';
import { Plus, Search, AlertTriangle, Pencil, Trash2, Layers, X } from 'lucide-react';
import { useProducts } from '../hooks/useProducts';
import { useCategories } from '../hooks/useCategories';
import { useSettings } from '../hooks/useSettings';
import { formatCurrency } from '../lib/formatters';
import { ProductForm } from '../components/products/ProductForm';
import { CategoryManager } from '../components/categories/CategoryManager';
import type { Product } from '../types';
import styles from './ProductsPage.module.css';

type ViewMode = 'list' | 'form' | 'categories';

export function ProductsPage() {
  const {
    products,
    lowStockProducts,
    loading,
    error,
    createProduct,
    updateProduct,
    deleteProduct,
  } = useProducts();
  const { categories, fetchCategories } = useCategories();
  const { settings } = useSettings();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Product | null>(null);

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

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // Status filter
      if (filterStatus === 'active' && p.is_active !== 1) return false;
      if (filterStatus === 'inactive' && p.is_active !== 0) return false;

      // Category filter
      if (filterCategory !== '' && p.category_id !== filterCategory) return false;

      // Low stock filter
      if (filterLowStock && p.min_stock >= 0 && p.stock > p.min_stock) return false;
      if (filterLowStock && p.min_stock < 0) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [products, searchQuery, filterCategory, filterStatus, filterLowStock]);

  function handleNewProduct() {
    setEditingProduct(null);
    setViewMode('form');
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
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setDeleteCandidate(null);
    }
  }

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
          <button className={styles['btn-primary']} onClick={handleNewProduct}>
            <Plus size={16} strokeWidth={1.5} />
            Nuevo producto
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
          onChange={e => setFilterCategory(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Todas las categorias</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          className={styles['toolbar__filter']}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
        >
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <select
          className={styles['toolbar__filter']}
          value={filterLowStock ? 'low' : 'all'}
          onChange={e => setFilterLowStock(e.target.value === 'low')}
        >
          <option value="all">Todos los productos</option>
          <option value="low">Solo stock bajo</option>
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
            {loading ? (
              <tr>
                <td colSpan={8} className={styles['table__empty']}>Cargando productos...</td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles['table__empty']}>
                  {searchQuery || filterCategory !== '' ? 'No se encontraron productos con esos filtros' : 'No hay productos registrados'}
                </td>
              </tr>
            ) : (
              filteredProducts.map(product => (
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
            <div className={styles['modal__actions']}>
              <button type="button" className={styles['btn-secondary']} onClick={() => setDeleteCandidate(null)}>
                Cancelar
              </button>
              <button type="button" className={styles['btn-danger']} onClick={handleConfirmDelete}>
                Desactivar producto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
