import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Printer,
  Plus,
  Minus,
  Tag,
  X,
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { useProducts } from '../hooks/useProducts';
import type { Product } from '../types';
import { formatCurrency } from '../lib/formatters';
import styles from './BarcodeLabelPage.module.css';

interface LabelItem {
  product: Product;
  copies: number;
}

// Renders a single barcode SVG into the DOM
function BarcodeLabel({ product, showPrice }: { product: Product; showPrice: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current) {
      try {
        JsBarcode(svgRef.current, product.barcode, {
          format: 'CODE128',
          width: 1.5,
          height: 50,
          displayValue: true,
          fontSize: 11,
          margin: 4,
          font: 'monospace',
          textMargin: 2,
        });
      } catch {
        // Barcode rendering failed
      }
    }
  }, [product.barcode]);

  return (
    <div className={styles.label}>
      <div className={styles['label__name']}>{product.name}</div>
      <svg ref={svgRef} className={styles['label__barcode']} />
      {showPrice && (
        <div className={styles['label__price']}>{formatCurrency(product.sale_price)}</div>
      )}
    </div>
  );
}

export function BarcodeLabelPage() {
  const { products, fetchProducts } = useProducts();
  const [searchQuery, setSearchQuery] = useState('');
  const [labelItems, setLabelItems] = useState<LabelItem[]>([]);
  const [showPrice, setShowPrice] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  function showNotif(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return products.filter(
      p =>
        p.is_active === 1 &&
        (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  const addProduct = useCallback((product: Product) => {
    setLabelItems(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, copies: item.copies + 1 }
            : item
        );
      }
      return [...prev, { product, copies: 1 }];
    });
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  function updateCopies(productId: number, delta: number) {
    setLabelItems(prev =>
      prev
        .map(item => {
          if (item.product.id !== productId) return item;
          const newCopies = item.copies + delta;
          if (newCopies <= 0) return null;
          if (newCopies > 100) return item;
          return { ...item, copies: newCopies };
        })
        .filter((item): item is LabelItem => item !== null)
    );
  }

  function removeItem(productId: number) {
    setLabelItems(prev => prev.filter(item => item.product.id !== productId));
  }

  function clearAll() {
    setLabelItems([]);
  }

  const totalLabels = useMemo(
    () => labelItems.reduce((sum, item) => sum + item.copies, 0),
    [labelItems]
  );

  // Generate flat list of labels for print preview
  const printLabels = useMemo(() => {
    const labels: Product[] = [];
    for (const item of labelItems) {
      for (let i = 0; i < item.copies; i++) {
        labels.push(item.product);
      }
    }
    return labels;
  }, [labelItems]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const exactMatch = products.find(
        p => p.barcode === searchQuery.trim() && p.is_active === 1
      );
      if (exactMatch) {
        addProduct(exactMatch);
      } else if (filteredProducts.length === 1) {
        addProduct(filteredProducts[0]);
      }
    }
  }

  function handlePrint() {
    if (labelItems.length === 0) {
      showNotif('error', 'Agrega al menos un producto para imprimir');
      return;
    }
    window.print();
  }

  return (
    <div className={styles.page}>
      {/* Notification */}
      {notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className={styles['page__header']}>
        <div>
          <h1>Etiquetas de codigo de barras</h1>
          <p className={styles['page__subtitle']}>
            Selecciona productos y genera etiquetas para imprimir
          </p>
        </div>
        <div className={styles['page__header-actions']}>
          <label className={styles['page__toggle']}>
            <input
              type="checkbox"
              checked={showPrice}
              onChange={e => setShowPrice(e.target.checked)}
            />
            <span>Mostrar precio</span>
          </label>
          <button
            className={styles['page__btn-primary']}
            onClick={handlePrint}
            disabled={labelItems.length === 0}
          >
            <Printer size={16} />
            Imprimir ({totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''})
          </button>
        </div>
      </div>

      <div className={styles['page__content']}>
        {/* Left: product selection */}
        <div className={styles['page__selector']}>
          <div className={styles['page__search']}>
            <Search size={16} strokeWidth={1.5} className={styles['page__search-icon']} />
            <input
              ref={searchInputRef}
              className={styles['page__search-input']}
              type="text"
              placeholder="Buscar producto o escanear codigo..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          {/* Search results */}
          <div className={styles['page__results']}>
            {searchQuery.trim() !== '' && filteredProducts.length === 0 && (
              <div className={styles['page__empty']}>No se encontraron productos</div>
            )}
            {filteredProducts.map(product => (
              <div
                key={product.id}
                className={styles['page__result-item']}
                onClick={() => addProduct(product)}
              >
                <div className={styles['page__result-info']}>
                  <div className={styles['page__result-name']}>{product.name}</div>
                  <div className={styles['page__result-barcode']}>{product.barcode}</div>
                </div>
                <div className={styles['page__result-price']}>
                  {formatCurrency(product.sale_price)}
                </div>
                <Plus size={16} className={styles['page__result-add']} />
              </div>
            ))}
          </div>

          {/* Selected items list */}
          <div className={styles['page__selected']}>
            <div className={styles['page__selected-header']}>
              <h2>
                <Tag size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Productos seleccionados
              </h2>
              {labelItems.length > 0 && (
                <button className={styles['page__btn-clear']} onClick={clearAll}>
                  Limpiar
                </button>
              )}
            </div>

            {labelItems.length === 0 ? (
              <div className={styles['page__empty']}>
                Busca y agrega productos para generar etiquetas
              </div>
            ) : (
              <div className={styles['page__items']}>
                {labelItems.map(item => (
                  <div key={item.product.id} className={styles['page__item']}>
                    <div className={styles['page__item-info']}>
                      <div className={styles['page__item-name']}>{item.product.name}</div>
                      <div className={styles['page__item-barcode']}>{item.product.barcode}</div>
                    </div>
                    <div className={styles['page__item-controls']}>
                      <button
                        className={styles['page__qty-btn']}
                        onClick={() => updateCopies(item.product.id, -1)}
                      >
                        <Minus size={12} />
                      </button>
                      <span className={styles['page__qty']}>{item.copies}</span>
                      <button
                        className={styles['page__qty-btn']}
                        onClick={() => updateCopies(item.product.id, 1)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <button
                      className={styles['page__item-remove']}
                      onClick={() => removeItem(item.product.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: print preview */}
        <div className={styles['page__preview-container']}>
          <h2 className={styles['page__preview-title']}>Vista previa</h2>
          <div className={styles['page__preview']} id="barcode-labels-printable">
            {printLabels.length === 0 ? (
              <div className={styles['page__empty']}>
                Las etiquetas apareceran aqui
              </div>
            ) : (
              <div className={styles['page__label-grid']}>
                {printLabels.map((product, index) => (
                  <BarcodeLabel
                    key={`${product.id}-${index}`}
                    product={product}
                    showPrice={showPrice}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
