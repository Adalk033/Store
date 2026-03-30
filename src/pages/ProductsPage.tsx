import { useState, useMemo } from 'react';
import { Plus, Search, AlertTriangle, Pencil, Trash2, Layers } from 'lucide-react';
import { useProducts } from '../hooks/useProducts';
import { useCategories } from '../hooks/useCategories';
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
  const { categories } = useCategories();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
  }, [products, searchQuery, filterCategory, filterStatus]);

  function handleNewProduct() {
    setEditingProduct(null);
    setViewMode('form');
  }

  function handleEditProduct(product: Product) {
    setEditingProduct(product);
    setViewMode('form');
  }

  async function handleDeleteProduct(product: Product) {
    try {
      await deleteProduct(product.id);
      showNotification('success', `"${product.name}" fue desactivado`);
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al eliminar');
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
    if (product.stock <= product.min_stock) return styles['table__stock--low'];
    return styles['table__stock--ok'];
  }

  // Categories view
  if (viewMode === 'categories') {
    return (
      <div className={styles.page}>
        <div className={styles['page__header']}>
          <h1 className={styles['page__title']}>Categorias</h1>
          <button className={styles['btn-secondary']} onClick={() => setViewMode('list')}>
            Volver a productos
          </button>
        </div>
        <CategoryManager />
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

      {/* Low stock alert */}
      {lowStockProducts.length > 0 && (
        <div className={styles['low-stock-banner']}>
          <AlertTriangle size={20} strokeWidth={1.5} className={styles['low-stock-banner__icon']} />
          <span>
            <span className={styles['low-stock-banner__count']}>{lowStockProducts.length}</span>
            {' '}producto{lowStockProducts.length !== 1 ? 's' : ''} con stock bajo
          </span>
        </div>
      )}

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
                    {product.stock <= product.min_stock && product.is_active === 1 && (
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
    </div>
  );
}
