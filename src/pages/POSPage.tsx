import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  ShoppingCart,
  Trash2,
  X,
  Minus,
  Plus,
  DollarSign,
  Users,
  Printer,
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { useProducts } from '../hooks/useProducts';
import { useCustomers } from '../hooks/useCustomers';
import { useSales } from '../hooks/useSales';
import type { CartItem } from '../hooks/useSales';
import type { Product, Sale, Customer } from '../types';
import { formatCurrency, formatDateTime } from '../lib/formatters';
import styles from './POSPage.module.css';

interface TicketData {
  sale: Sale;
  items: CartItem[];
  customer?: Customer;
  storeName: string;
  storeAddress: string;
  footerText: string;
}

export function POSPage() {
  const { products, fetchProducts } = useProducts();
  const { customers, createCustomer } = useCustomers();
  const { createSale, loading: saleLoading } = useSales();

  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Credit sale modal
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditCustomerId, setCreditCustomerId] = useState<number | ''>('');
  const [creditDays, setCreditDays] = useState(5);
  const [creditSurcharge, setCreditSurcharge] = useState(10);
  // New customer form inside credit modal
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  // Ticket view
  const [ticketData, setTicketData] = useState<TicketData | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load default settings for credit
  useEffect(() => {
    async function loadDefaults() {
      try {
        const days = await window.electronAPI.settings.get('default_credit_days');
        if (days) setCreditDays(Number(days));
        const surcharge = await window.electronAPI.settings.get('default_surcharge_percent');
        if (surcharge) setCreditSurcharge(Number(surcharge));
      } catch (err) {
        console.error('POSPage.loadDefaults:', err);
      }
    }
    loadDefaults();
  }, []);

  // Focus search on mount and refocus after interactions
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Global keyboard listener: refocus search input when typing starts
  // This ensures USB barcode scanners work even if focus was lost
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Ignore if focus is on another input/select/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ignore modifier keys and special keys
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;

      // Redirect keystroke to search input
      searchInputRef.current?.focus();
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return products.filter(
      p =>
        p.is_active === 1 &&
        (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  // Cart totals
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0),
    [cart]
  );
  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  // Add product to cart
  const addToCart = useCallback(
    (product: Product) => {
      if (product.stock <= 0) return;

      setCart(prev => {
        const existing = prev.find(item => item.product_id === product.id);
        if (existing) {
          // Don't exceed available stock
          if (existing.quantity >= product.stock) return prev;
          return prev.map(item =>
            item.product_id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item
          );
        }
        return [
          ...prev,
          {
            product_id: product.id,
            name: product.name,
            barcode: product.barcode,
            unit_price: product.sale_price,
            quantity: 1,
            stock: product.stock,
          },
        ];
      });

      setSearchQuery('');
      searchInputRef.current?.focus();
    },
    []
  );

  // Handle barcode direct match (Enter key)
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && searchQuery.trim()) {
        const exactMatch = products.find(
          p => p.barcode === searchQuery.trim() && p.is_active === 1
        );
        if (exactMatch) {
          addToCart(exactMatch);
        } else if (filteredProducts.length === 1) {
          addToCart(filteredProducts[0]);
        }
      }
    },
    [searchQuery, products, filteredProducts, addToCart]
  );

  function updateQuantity(productId: number, delta: number) {
    setCart(prev =>
      prev
        .map(item => {
          if (item.product_id !== productId) return item;
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (newQty > item.stock) return item;
          return { ...item, quantity: newQty };
        })
        .filter((item): item is CartItem => item !== null)
    );
  }

  function removeFromCart(productId: number) {
    setCart(prev => prev.filter(item => item.product_id !== productId));
  }

  function clearCart() {
    setCart([]);
    searchInputRef.current?.focus();
  }

  // Process cash sale
  async function handleCashSale() {
    if (cart.length === 0) return;

    try {
      const sale = await createSale({
        sale_type: 'cash',
        items: cart.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      });

      // Show ticket
      const storeName = (await window.electronAPI.settings.get('store_name')) ?? 'Mi Papeleria';
      const storeAddress = (await window.electronAPI.settings.get('store_address')) ?? '';
      const footerText = (await window.electronAPI.settings.get('ticket_footer_text')) ?? '';

      setTicketData({
        sale,
        items: [...cart],
        storeName,
        storeAddress,
        footerText,
      });

      showNotification('success', `Venta #${sale.id} registrada`);
      setCart([]);
      await fetchProducts();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al procesar venta');
    }
  }

  // Open credit modal
  function handleCreditSaleStart() {
    if (cart.length === 0) return;
    setCreditCustomerId('');
    setShowNewCustomer(false);
    setNewCustomerName('');
    setNewCustomerPhone('');
    setShowCreditModal(true);
  }

  // Process credit sale
  async function handleCreditSale() {
    if (cart.length === 0 || creditCustomerId === '') return;

    try {
      const sale = await createSale({
        sale_type: 'credit',
        customer_id: Number(creditCustomerId),
        items: cart.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
        credit_days: creditDays,
        surcharge_percent: creditSurcharge,
      });

      // Show ticket
      const customer = customers.find(c => c.id === Number(creditCustomerId));
      const storeName = (await window.electronAPI.settings.get('store_name')) ?? 'Mi Papeleria';
      const storeAddress = (await window.electronAPI.settings.get('store_address')) ?? '';
      const footerText = (await window.electronAPI.settings.get('ticket_footer_text')) ?? '';

      setTicketData({
        sale,
        items: [...cart],
        customer,
        storeName,
        storeAddress,
        footerText,
      });

      showNotification('success', `Venta a credito #${sale.id} registrada`);
      setCart([]);
      setShowCreditModal(false);
      await fetchProducts();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al procesar venta a credito');
    }
  }

  // Create new customer from credit modal
  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) return;

    try {
      const customer = await createCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || null,
      });
      setCreditCustomerId(customer.id);
      setShowNewCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      showNotification('success', `Cliente "${customer.name}" registrado`);
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al crear cliente');
    }
  }

  function getStockClass(product: Product): string {
    if (product.stock === 0) return styles['pos__result-stock--out'];
    if (product.stock <= product.min_stock) return styles['pos__result-stock--low'];
    return styles['pos__result-stock--ok'];
  }

  return (
    <div className={styles.pos}>
      {/* Notification */}
      {notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
          {notification.message}
        </div>
      )}

      {/* Left panel: product search */}
      <div className={styles['pos__products']}>
        <div className={styles['pos__search']}>
          <Search size={16} strokeWidth={1.5} className={styles['pos__search-icon']} />
          <input
            ref={searchInputRef}
            className={styles['pos__search-input']}
            type="text"
            placeholder="Buscar producto o escanear codigo de barras..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>

        <div className={styles['pos__results']}>
          {searchQuery.trim() === '' ? (
            <div className={styles['pos__empty']}>
              Escribe un nombre o escanea un codigo de barras para buscar
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className={styles['pos__empty']}>
              No se encontraron productos
            </div>
          ) : (
            filteredProducts.map(product => (
              <div
                key={product.id}
                className={`${styles['pos__result-item']} ${product.stock <= 0 ? styles['pos__result-item--no-stock'] : ''}`}
                onClick={() => addToCart(product)}
              >
                <div className={styles['pos__result-info']}>
                  <div className={styles['pos__result-name']}>{product.name}</div>
                  <div className={styles['pos__result-meta']}>
                    <span>{product.barcode}</span>
                    <span className={`${styles['pos__result-stock']} ${getStockClass(product)}`}>
                      Stock: {product.stock}
                    </span>
                  </div>
                </div>
                <div className={styles['pos__result-price']}>
                  {formatCurrency(product.sale_price)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel: cart */}
      <div className={styles['pos__cart']}>
        <div className={styles['cart__header']}>
          <div className={styles['cart__title']}>
            <ShoppingCart size={18} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Carrito
          </div>
          <span className={styles['cart__count']}>
            {cartItemCount} articulo{cartItemCount !== 1 ? 's' : ''}
          </span>
        </div>

        <div className={styles['cart__items']}>
          {cart.length === 0 ? (
            <div className={styles['cart__empty']}>
              Agrega productos para iniciar una venta
            </div>
          ) : (
            cart.map(item => (
              <div key={item.product_id} className={styles['cart-item']}>
                <div className={styles['cart-item__info']}>
                  <div className={styles['cart-item__name']}>{item.name}</div>
                  <div className={styles['cart-item__price']}>
                    {formatCurrency(item.unit_price)} c/u
                  </div>
                </div>
                <div className={styles['cart-item__controls']}>
                  <button
                    className={styles['cart-item__qty-btn']}
                    onClick={() => updateQuantity(item.product_id, -1)}
                  >
                    <Minus size={12} />
                  </button>
                  <span className={styles['cart-item__qty']}>{item.quantity}</span>
                  <button
                    className={styles['cart-item__qty-btn']}
                    onClick={() => updateQuantity(item.product_id, 1)}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className={styles['cart-item__subtotal']}>
                  {formatCurrency(item.unit_price * item.quantity)}
                </div>
                <button
                  className={styles['cart-item__remove']}
                  onClick={() => removeFromCart(item.product_id)}
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className={styles['cart__footer']}>
          <div className={styles['cart__total-row']}>
            <span className={styles['cart__total-label']}>Subtotal</span>
            <span className={styles['cart__total-value']}>{formatCurrency(cartSubtotal)}</span>
          </div>
          <div className={`${styles['cart__total-row']} ${styles['cart__total-row--grand']}`}>
            <span className={styles['cart__total-label']}>Total</span>
            <span className={styles['cart__total-value']}>{formatCurrency(cartSubtotal)}</span>
          </div>

          <div className={styles['cart__actions']}>
            <button
              className={styles['cart__btn-cash']}
              disabled={cart.length === 0 || saleLoading}
              onClick={handleCashSale}
            >
              <DollarSign size={16} />
              Cobrar
            </button>
            <button
              className={styles['cart__btn-credit']}
              disabled={cart.length === 0 || saleLoading}
              onClick={handleCreditSaleStart}
            >
              <Users size={16} />
              Credito
            </button>
            <button
              className={styles['cart__btn-clear']}
              disabled={cart.length === 0}
              onClick={clearCart}
              title="Limpiar carrito"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Credit sale modal */}
      {showCreditModal && (
        <div className={styles['modal-overlay']} onClick={() => setShowCreditModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles['modal__header']}>
              <h2 className={styles['modal__title']}>Venta a credito</h2>
              <button className={styles['modal__close']} onClick={() => setShowCreditModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles['modal__body']}>
              {/* Customer selection */}
              <div className={styles['modal__field']}>
                <label className={styles['modal__label']}>Cliente</label>
                <select
                  className={styles['modal__select']}
                  value={creditCustomerId}
                  onChange={e => setCreditCustomerId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Seleccionar cliente...</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {!showNewCustomer ? (
                <button
                  className={styles['modal__btn-secondary']}
                  onClick={() => setShowNewCustomer(true)}
                  style={{ alignSelf: 'flex-start' }}
                >
                  + Nuevo cliente
                </button>
              ) : (
                <>
                  <div className={styles['modal__divider']}>Nuevo cliente</div>
                  <div className={styles['modal__field']}>
                    <label className={styles['modal__label']}>Nombre</label>
                    <input
                      className={styles['modal__input']}
                      type="text"
                      value={newCustomerName}
                      onChange={e => setNewCustomerName(e.target.value)}
                      placeholder="Nombre completo"
                    />
                  </div>
                  <div className={styles['modal__field']}>
                    <label className={styles['modal__label']}>Telefono (opcional)</label>
                    <input
                      className={styles['modal__input']}
                      type="text"
                      value={newCustomerPhone}
                      onChange={e => setNewCustomerPhone(e.target.value)}
                      placeholder="Telefono"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className={styles['modal__btn-primary']}
                      onClick={handleCreateCustomer}
                      disabled={!newCustomerName.trim()}
                    >
                      Guardar cliente
                    </button>
                    <button
                      className={styles['modal__btn-secondary']}
                      onClick={() => setShowNewCustomer(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}

              {/* Credit terms */}
              <div className={styles['modal__divider']}>Condiciones del credito</div>
              <div className={styles['modal__row']}>
                <div className={styles['modal__field']}>
                  <label className={styles['modal__label']}>Dias de plazo</label>
                  <input
                    className={styles['modal__input']}
                    type="number"
                    min={1}
                    value={creditDays}
                    onChange={e => setCreditDays(Number(e.target.value))}
                  />
                </div>
                <div className={styles['modal__field']}>
                  <label className={styles['modal__label']}>% Recargo por atraso</label>
                  <input
                    className={styles['modal__input']}
                    type="number"
                    min={0}
                    step={0.5}
                    value={creditSurcharge}
                    onChange={e => setCreditSurcharge(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Summary */}
              <div style={{
                padding: 'var(--spacing-sm)',
                backgroundColor: 'var(--color-bg)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-sm)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Total de la venta:</span>
                  <strong>{formatCurrency(cartSubtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-secondary)' }}>
                  <span>Si se atrasa ({creditSurcharge}%):</span>
                  <span>{formatCurrency(cartSubtotal * (1 + creditSurcharge / 100))}</span>
                </div>
              </div>
            </div>
            <div className={styles['modal__footer']}>
              <button
                className={styles['modal__btn-secondary']}
                onClick={() => setShowCreditModal(false)}
              >
                Cancelar
              </button>
              <button
                className={styles['modal__btn-primary']}
                disabled={creditCustomerId === '' || saleLoading}
                onClick={handleCreditSale}
              >
                Confirmar venta a credito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket / Receipt view */}
      {ticketData && (
        <div className={styles['ticket-overlay']} onClick={() => setTicketData(null)}>
          <div className={styles.ticket} onClick={e => e.stopPropagation()}>
            <div className={styles['ticket__printable']} id="ticket-printable">
              <div className={styles['ticket__header']}>
                <div className={styles['ticket__store-name']}>{ticketData.storeName}</div>
                {ticketData.storeAddress && (
                  <div className={styles['ticket__store-info']}>{ticketData.storeAddress}</div>
                )}
              </div>

              <hr className={styles['ticket__divider']} />

              <div className={styles['ticket__meta']}>
                <span>Venta #{ticketData.sale.id}</span>
                <span>{formatDateTime(ticketData.sale.created_at)}</span>
              </div>

              {ticketData.customer && (
                <div className={styles['ticket__meta']} style={{ marginTop: 4 }}>
                  <span>Cliente: {ticketData.customer.name}</span>
                  <span style={{ textTransform: 'capitalize' }}>{ticketData.sale.sale_type === 'credit' ? 'Credito' : 'Contado'}</span>
                </div>
              )}

              {ticketData.sale.sale_type === 'cash' && (
                <div className={styles['ticket__type-badge']}>CONTADO</div>
              )}
              {ticketData.sale.sale_type === 'credit' && (
                <div className={`${styles['ticket__type-badge']} ${styles['ticket__type-badge--credit']}`}>CREDITO</div>
              )}

              <hr className={styles['ticket__divider']} />

              <div className={styles['ticket__items']}>
                {ticketData.items.map(item => (
                  <div key={item.product_id} className={styles['ticket__item']}>
                    <div className={styles['ticket__item-row']}>
                      <span className={styles['ticket__item-name']}>{item.name}</span>
                      <span className={styles['ticket__item-total']}>
                        {formatCurrency(item.unit_price * item.quantity)}
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
                  <span>{formatCurrency(ticketData.sale.subtotal)}</span>
                </div>
                <div className={`${styles['ticket__total-row']} ${styles['ticket__total-row--grand']}`}>
                  <span>Total:</span>
                  <span>{formatCurrency(ticketData.sale.total)}</span>
                </div>
              </div>

              <hr className={styles['ticket__divider']} />

              {/* Barcode for sale ID */}
              <div className={styles['ticket__barcode']}>
                <svg ref={el => {
                  if (el) {
                    try {
                      JsBarcode(el, String(ticketData.sale.id).padStart(6, '0'), {
                        format: 'CODE128',
                        width: 1.5,
                        height: 40,
                        displayValue: true,
                        fontSize: 10,
                        margin: 0,
                        font: 'monospace',
                      });
                    } catch {
                      // Barcode rendering failed silently
                    }
                  }
                }} />
              </div>

              {ticketData.footerText && (
                <div className={styles['ticket__footer']}>{ticketData.footerText}</div>
              )}
            </div>

            <div className={styles['ticket__actions']}>
              <button
                className={styles['modal__btn-secondary']}
                onClick={() => setTicketData(null)}
              >
                Cerrar
              </button>
              <button
                className={styles['modal__btn-primary']}
                onClick={() => window.print()}
              >
                <Printer size={14} style={{ marginRight: 4 }} />
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
