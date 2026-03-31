import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, DollarSign, RefreshCw, Search, User } from 'lucide-react';
import { useCredits } from '../hooks/useCredits';
import { useCustomers } from '../hooks/useCustomers';
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters';
import type { Credit, CreditPayment, Customer } from '../types';
import styles from './CreditsPage.module.css';

type ViewMode = 'list' | 'detail' | 'customer';
type TabFilter = 'all' | 'pending' | 'overdue' | 'paid';
type TimeRangeFilter = 'select' | '7d' | '30d' | '2m' | '3m' | 'all';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  overdue: 'Vencido',
  paid: 'Pagado',
};

function getRangeStartDate(range: TimeRangeFilter): Date | null {
  if (range === 'all' || range === 'select') {
    return null;
  }

  const start = new Date();

  if (range === '7d') {
    start.setDate(start.getDate() - 6);
  } else if (range === '30d') {
    start.setDate(start.getDate() - 29);
  } else if (range === '2m') {
    start.setMonth(start.getMonth() - 2);
  } else if (range === '3m') {
    start.setMonth(start.getMonth() - 3);
  }

  start.setHours(0, 0, 0, 0);
  return start;
}

interface CreditsPageProps {
  initialCreditId?: number | null;
  onInitialCreditHandled?: () => void;
}

export function CreditsPage({ initialCreditId, onInitialCreditHandled }: CreditsPageProps) {
  const { credits, loading, error, fetchCredits, fetchCreditsByCustomer, addPayment, getPayments, getCreditById, checkOverdue } = useCredits();
  const { customers } = useCustomers();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCustomerId, setFilterCustomerId] = useState<number | ''>('');
  const [timeRangeFilter, setTimeRangeFilter] = useState<TimeRangeFilter>('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Detail view state
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);

  // Customer view state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Customer lookup map
  const customerMap = useMemo(() => {
    const map = new Map<number, Customer>();
    customers.forEach(c => map.set(c.id, c));
    return map;
  }, [customers]);

  // Filter credits based on tab, customer, and search
  const filteredCredits = useMemo(() => {
    const hasCustomDateFilter = Boolean(startDateFilter || endDateFilter);
    const presetRangeStart = getRangeStartDate(timeRangeFilter);
    const customStartDate = startDateFilter ? new Date(`${startDateFilter}T00:00:00`) : null;
    const customEndDate = endDateFilter ? new Date(`${endDateFilter}T23:59:59.999`) : null;

    if (customStartDate && customEndDate && customStartDate > customEndDate) {
      return [];
    }

    let result = credits;

    if (activeTab !== 'all') {
      result = result.filter(c => c.status === activeTab);
    }

    if (filterCustomerId !== '') {
      result = result.filter(c => c.customer_id === filterCustomerId);
    }

    if (hasCustomDateFilter) {
      result = result.filter(c => {
        const creditDate = new Date(c.created_at);

        if (customStartDate && creditDate < customStartDate) {
          return false;
        }

        if (customEndDate && creditDate > customEndDate) {
          return false;
        }

        return true;
      });
    } else if (presetRangeStart) {
      result = result.filter(c => new Date(c.created_at) >= presetRangeStart);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c => {
        const customer = customerMap.get(c.customer_id);
        return customer?.name.toLowerCase().includes(query)
          || c.id.toString().includes(query)
          || c.sale_id.toString().includes(query);
      });
    }

    return result;
  }, [credits, activeTab, filterCustomerId, timeRangeFilter, startDateFilter, endDateFilter, searchQuery, customerMap]);

  const hasCustomDateFilter = Boolean(startDateFilter || endDateFilter);
  const hasInvalidDateRange = Boolean(
    startDateFilter
      && endDateFilter
      && new Date(`${startDateFilter}T00:00:00`) > new Date(`${endDateFilter}T23:59:59.999`),
  );

  function handleTimeRangeFilterChange(nextFilter: TimeRangeFilter) {
    setTimeRangeFilter(nextFilter);

    if (nextFilter !== 'select') {
      setStartDateFilter('');
      setEndDateFilter('');
    }
  }

  function handleStartDateFilterChange(value: string) {
    setStartDateFilter(value);

    if (value || endDateFilter) {
      setTimeRangeFilter('select');
    }
  }

  function handleEndDateFilterChange(value: string) {
    setEndDateFilter(value);

    if (value || startDateFilter) {
      setTimeRangeFilter('select');
    }
  }

  // Summary stats
  const summary = useMemo(() => {
    const totalPending = credits
      .filter(c => c.status === 'pending')
      .reduce((sum, c) => sum + (c.total_due - c.amount_paid), 0);
    const totalOverdue = credits
      .filter(c => c.status === 'overdue')
      .reduce((sum, c) => sum + (c.total_due - c.amount_paid), 0);
    const totalCollected = credits
      .filter(c => c.status === 'paid')
      .reduce((sum, c) => sum + c.total_due, 0);
    const countActive = credits.filter(c => c.status !== 'paid').length;

    return { totalPending, totalOverdue, totalCollected, countActive };
  }, [credits]);

  async function handleCheckOverdue() {
    try {
      const count = await checkOverdue();
      await fetchCredits();
      if (count > 0) {
        showNotification('success', `Se aplicaron recargos a ${count} credito(s) vencido(s)`);
      } else {
        showNotification('success', 'No hay creditos vencidos nuevos');
      }
    } catch {
      showNotification('error', 'Error al verificar creditos vencidos');
    }
  }

  const openDetail = useCallback(async (credit: Credit) => {
    setSelectedCredit(credit);
    setPaymentAmount('');
    setPaymentError(null);
    const payments = await getPayments(credit.id);
    setCreditPayments(payments);
    setViewMode('detail');
  }, [getPayments]);

  useEffect(() => {
    if (typeof initialCreditId !== 'number' || viewMode !== 'list') {
      return;
    }

    const creditId = initialCreditId;

    let cancelled = false;

    async function openInitialCreditDetail() {
      try {
        let targetCredit = credits.find(credit => credit.id === creditId);

        if (!targetCredit) {
          targetCredit = await getCreditById(creditId);
        }

        if (!targetCredit || cancelled) {
          return;
        }

        await openDetail(targetCredit);
      } finally {
        if (!cancelled) {
          onInitialCreditHandled?.();
        }
      }
    }

    void openInitialCreditDetail();

    return () => {
      cancelled = true;
    };
  }, [credits, getCreditById, initialCreditId, onInitialCreditHandled, openDetail, viewMode]);

  function openCustomerView(customer: Customer) {
    setSelectedCustomer(customer);
    setViewMode('customer');
    fetchCreditsByCustomer(customer.id);
  }

  function backToList() {
    setViewMode('list');
    setSelectedCredit(null);
    setSelectedCustomer(null);
    fetchCredits();
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    setPaymentError(null);

    if (!selectedCredit) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      setPaymentError('Ingresa un monto valido mayor a 0');
      return;
    }

    const remaining = selectedCredit.total_due - selectedCredit.amount_paid;
    if (amount > remaining) {
      setPaymentError(`El monto excede el saldo pendiente (${formatCurrency(remaining)})`);
      return;
    }

    setSubmitting(true);
    try {
      const updated = await addPayment(selectedCredit.id, amount);
      setSelectedCredit(updated);
      const payments = await getPayments(selectedCredit.id);
      setCreditPayments(payments);
      setPaymentAmount('');

      if (updated.status === 'paid') {
        showNotification('success', 'Credito liquidado completamente');
      } else {
        showNotification('success', `Abono de ${formatCurrency(amount)} registrado`);
      }
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al registrar abono');
    } finally {
      setSubmitting(false);
    }
  }

  function getPaymentPercent(credit: Credit): number {
    if (credit.total_due === 0) return 100;
    return Math.min(100, Math.round((credit.amount_paid / credit.total_due) * 100));
  }

  function getProgressClass(percent: number): string {
    if (percent >= 100) return styles['progress__fill--complete'];
    if (percent >= 60) return styles['progress__fill--high'];
    if (percent >= 30) return styles['progress__fill--mid'];
    return styles['progress__fill--low'];
  }

  // =====================================================
  // DETAIL VIEW
  // =====================================================
  if (viewMode === 'detail' && selectedCredit) {
    const customer = customerMap.get(selectedCredit.customer_id);
    const remaining = selectedCredit.total_due - selectedCredit.amount_paid;
    const percent = getPaymentPercent(selectedCredit);
    const isPaid = selectedCredit.status === 'paid';

    return (
      <div className={styles.page}>
        {notification && (
          <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
            {notification.message}
          </div>
        )}

        <div className={styles['page__header']}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
            <button className={styles['detail__back']} onClick={backToList}>
              <ArrowLeft size={16} strokeWidth={1.5} />
              Volver
            </button>
            <h1 className={styles['page__title']}>Credito #{selectedCredit.id}</h1>
            <span className={`${styles.badge} ${styles[`badge--${selectedCredit.status}`]}`}>
              {STATUS_LABELS[selectedCredit.status]}
            </span>
          </div>
        </div>

        <div className={styles.detail}>
          {/* Credit info */}
          <div className={styles['detail__card']}>
            <h2 className={styles['detail__title']}>Informacion del credito</h2>
            <div className={styles['detail__info']}>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Cliente</span>
                <span className={styles['detail__value']}>{customer?.name ?? 'Desconocido'}</span>
              </div>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Venta #</span>
                <span className={styles['detail__value']}>{selectedCredit.sale_id}</span>
              </div>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Fecha de credito</span>
                <span className={styles['detail__value']}>{formatDate(selectedCredit.created_at)}</span>
              </div>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Fecha limite</span>
                <span className={styles['detail__value']}>{formatDate(selectedCredit.due_date)}</span>
              </div>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Monto original</span>
                <span className={styles['detail__value']}>{formatCurrency(selectedCredit.original_amount)}</span>
              </div>
              {selectedCredit.surcharge_applied === 1 && (
                <div className={styles['detail__row']}>
                  <span className={styles['detail__label']}>Recargo ({selectedCredit.surcharge_percent}%)</span>
                  <span className={`${styles['detail__value']} ${styles['detail__value--error']}`}>
                    +{formatCurrency(selectedCredit.total_due - selectedCredit.original_amount)}
                  </span>
                </div>
              )}
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Total a pagar</span>
                <span className={`${styles['detail__value']} ${styles['detail__value--large']}`}>
                  {formatCurrency(selectedCredit.total_due)}
                </span>
              </div>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Pagado</span>
                <span className={`${styles['detail__value']} ${styles['detail__value--success']}`}>
                  {formatCurrency(selectedCredit.amount_paid)}
                </span>
              </div>
              <div className={styles['detail__row']}>
                <span className={styles['detail__label']}>Saldo pendiente</span>
                <span className={`${styles['detail__value']} ${styles['detail__value--large']} ${!isPaid ? styles['detail__value--error'] : styles['detail__value--success']}`}>
                  {formatCurrency(remaining)}
                </span>
              </div>
              <div style={{ marginTop: 'var(--spacing-xs)' }}>
                <div className={styles.progress}>
                  <div
                    className={`${styles['progress__fill']} ${getProgressClass(percent)}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {percent}% pagado
                </span>
              </div>
            </div>
          </div>

          {/* Payment form */}
          <div className={styles['detail__card']}>
            <h2 className={styles['detail__title']}>
              <DollarSign size={18} strokeWidth={1.5} />
              Registrar abono
            </h2>
            {isPaid ? (
              <div style={{ textAlign: 'center', padding: 'var(--spacing-md)', color: 'var(--color-success)' }}>
                <p style={{ fontWeight: 500 }}>Credito liquidado</p>
                {selectedCredit.paid_at && (
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    Pagado el {formatDateTime(selectedCredit.paid_at)}
                  </p>
                )}
              </div>
            ) : (
              <form className={styles['payment-form']} onSubmit={handlePayment}>
                <div className={styles['payment-form__field']}>
                  <label className={styles['payment-form__label']}>Monto del abono *</label>
                  <input
                    className={`${styles['payment-form__input']} ${paymentError ? styles['payment-form__input--error'] : ''}`}
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={remaining}
                    value={paymentAmount}
                    onChange={e => setPaymentAmount(e.target.value)}
                    placeholder={`Saldo: ${formatCurrency(remaining)}`}
                  />
                  {paymentError && <span className={styles['payment-form__error']}>{paymentError}</span>}
                </div>

                <div className={styles['payment-form__quick']}>
                  <button
                    type="button"
                    className={styles['payment-form__quick-btn']}
                    onClick={() => setPaymentAmount(remaining.toFixed(2))}
                  >
                    Liquidar todo ({formatCurrency(remaining)})
                  </button>
                  {remaining >= 100 && (
                    <button
                      type="button"
                      className={styles['payment-form__quick-btn']}
                      onClick={() => setPaymentAmount((remaining / 2).toFixed(2))}
                    >
                      Mitad ({formatCurrency(remaining / 2)})
                    </button>
                  )}
                </div>

                <button type="submit" className={styles['btn-primary']} disabled={submitting}>
                  <DollarSign size={16} strokeWidth={1.5} />
                  {submitting ? 'Registrando...' : 'Registrar abono'}
                </button>
              </form>
            )}
          </div>

          {/* Payment history */}
          <div className={`${styles['detail__card']} ${styles['detail__card--full']}`}>
            <h2 className={styles['detail__title']}>Historial de abonos</h2>
            <div className={styles['table-card']}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {creditPayments.length === 0 ? (
                    <tr><td colSpan={2} className={styles['table__empty']}>Sin abonos registrados</td></tr>
                  ) : (
                    creditPayments.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                          {formatDateTime(p.created_at)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 500, color: 'var(--color-success)' }}>
                          +{formatCurrency(p.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =====================================================
  // CUSTOMER ACCOUNT VIEW
  // =====================================================
  if (viewMode === 'customer' && selectedCustomer) {
    const customerCredits = credits;
    const totalDebt = customerCredits
      .filter(c => c.status !== 'paid')
      .reduce((sum, c) => sum + (c.total_due - c.amount_paid), 0);
    const totalPaid = customerCredits.reduce((sum, c) => sum + c.amount_paid, 0);
    const activeCount = customerCredits.filter(c => c.status !== 'paid').length;

    return (
      <div className={styles.page}>
        {notification && (
          <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
            {notification.message}
          </div>
        )}

        <div className={styles['page__header']}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
            <button className={styles['detail__back']} onClick={backToList}>
              <ArrowLeft size={16} strokeWidth={1.5} />
              Volver
            </button>
            <h1 className={styles['page__title']}>Estado de cuenta</h1>
          </div>
        </div>

        <div className={styles['detail__card']}>
          <div className={styles['customer-header']}>
            <div className={styles['customer-header__info']}>
              <span className={styles['customer-header__name']}>
                <User size={18} strokeWidth={1.5} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {selectedCustomer.name}
              </span>
              <span className={styles['customer-header__contact']}>
                {[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(' - ') || 'Sin datos de contacto'}
              </span>
            </div>
          </div>

          <div className={styles['customer-summary']}>
            <div className={styles['summary__card']}>
              <span className={styles['summary__label']}>Deuda total</span>
              <span className={`${styles['summary__value']} ${totalDebt > 0 ? styles['summary__value--error'] : ''}`}>
                {formatCurrency(totalDebt)}
              </span>
            </div>
            <div className={styles['summary__card']}>
              <span className={styles['summary__label']}>Total pagado</span>
              <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
                {formatCurrency(totalPaid)}
              </span>
            </div>
            <div className={styles['summary__card']}>
              <span className={styles['summary__label']}>Creditos activos</span>
              <span className={styles['summary__value']}>{activeCount}</span>
            </div>
          </div>
        </div>

        {/* Customer credits table */}
        <div className={styles['table-card']}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Vencimiento</th>
                <th>Total</th>
                <th>Pagado</th>
                <th>Saldo</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className={styles['table__empty']}>Cargando...</td></tr>
              ) : customerCredits.length === 0 ? (
                <tr><td colSpan={8} className={styles['table__empty']}>Este cliente no tiene creditos</td></tr>
              ) : (
                customerCredits.map(credit => {
                  const remaining = credit.total_due - credit.amount_paid;
                  return (
                    <tr key={credit.id} className={styles['table__row--clickable']} onClick={() => openDetail(credit)}>
                      <td>{credit.id}</td>
                      <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {formatDate(credit.created_at)}
                      </td>
                      <td style={{ fontSize: 'var(--font-size-xs)' }}>
                        {formatDate(credit.due_date)}
                      </td>
                      <td>{formatCurrency(credit.total_due)}</td>
                      <td style={{ color: 'var(--color-success)' }}>{formatCurrency(credit.amount_paid)}</td>
                      <td style={{ fontWeight: 500 }}>{formatCurrency(remaining)}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[`badge--${credit.status}`]}`}>
                          {STATUS_LABELS[credit.status]}
                        </span>
                      </td>
                      <td>
                        <button
                          className={styles['btn-secondary']}
                          style={{ padding: '4px 12px', fontSize: 'var(--font-size-xs)' }}
                          onClick={e => { e.stopPropagation(); openDetail(credit); }}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // =====================================================
  // LIST VIEW (Default)
  // =====================================================

  // Unique customers that have credits for the customer filter
  const creditCustomerIds = [...new Set(credits.map(c => c.customer_id))];
  const creditCustomers = creditCustomerIds
    .map(id => customerMap.get(id))
    .filter((c): c is Customer => c !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className={styles.page}>
      {notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
          {notification.message}
        </div>
      )}

      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Creditos y Cobranza</h1>
        <button className={styles['btn-secondary']} onClick={handleCheckOverdue}>
          <RefreshCw size={16} strokeWidth={1.5} />
          Verificar vencidos
        </button>
      </div>

      {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>}

      {/* Summary cards */}
      <div className={styles.summary}>
        <div className={styles['summary__card']}>
          <span className={styles['summary__label']}>Creditos activos</span>
          <span className={styles['summary__value']}>{summary.countActive}</span>
        </div>
        <div className={styles['summary__card']}>
          <span className={styles['summary__label']}>Por cobrar (vigentes)</span>
          <span className={`${styles['summary__value']} ${styles['summary__value--warning']}`}>
            {formatCurrency(summary.totalPending)}
          </span>
        </div>
        <div className={styles['summary__card']}>
          <span className={styles['summary__label']}>Vencidos</span>
          <span className={`${styles['summary__value']} ${styles['summary__value--error']}`}>
            {formatCurrency(summary.totalOverdue)}
          </span>
        </div>
        <div className={styles['summary__card']}>
          <span className={styles['summary__label']}>Total cobrado</span>
          <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
            {formatCurrency(summary.totalCollected)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {(['all', 'pending', 'overdue', 'paid'] as TabFilter[]).map(tab => (
          <button
            key={tab}
            className={`${styles['tabs__item']} ${activeTab === tab ? styles['tabs__item--active'] : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'all' ? 'Todos' : STATUS_LABELS[tab]}
            {tab !== 'all' && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                ({credits.filter(c => c.status === tab).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            strokeWidth={1.5}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-secondary)',
            }}
          />
          <input
            className={styles['toolbar__search']}
            type="text"
            placeholder="Buscar por cliente o # de credito..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 30 }}
          />
        </div>

        <select
          className={styles['toolbar__filter']}
          value={timeRangeFilter}
          onChange={(event) => handleTimeRangeFilterChange(event.target.value as TimeRangeFilter)}
          disabled={hasCustomDateFilter}
        >
          <option value="select">Seleccionar</option>
          <option value="30d">Ultimos 30 dias</option>
          <option value="7d">Ultimos 7 dias</option>
          <option value="2m">Ultimos 2 meses</option>
          <option value="3m">Ultimos 3 meses</option>
          <option value="all">Todo</option>
        </select>

        <div className={styles['toolbar__date-group']}>
          <input
            className={styles['toolbar__filter']}
            type="date"
            value={startDateFilter}
            onChange={(event) => handleStartDateFilterChange(event.target.value)}
            disabled={timeRangeFilter !== 'select' && !hasCustomDateFilter}
            aria-label="Fecha inicial"
          />
          <input
            className={styles['toolbar__filter']}
            type="date"
            value={endDateFilter}
            onChange={(event) => handleEndDateFilterChange(event.target.value)}
            disabled={timeRangeFilter !== 'select' && !hasCustomDateFilter}
            aria-label="Fecha final"
          />
        </div>

        <select
          className={styles['toolbar__filter']}
          value={filterCustomerId}
          onChange={e => setFilterCustomerId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Todos los clientes</option>
          {creditCustomers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {hasInvalidDateRange && (
        <p className={styles['toolbar__hint--error']}>
          La fecha inicial no puede ser mayor que la fecha final.
        </p>
      )}

      {/* Credits table */}
      <div className={styles['table-card']}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Vencimiento</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Progreso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={styles['table__empty']}>Cargando...</td></tr>
            ) : filteredCredits.length === 0 ? (
              <tr><td colSpan={9} className={styles['table__empty']}>No hay creditos{activeTab !== 'all' ? ` con estado "${STATUS_LABELS[activeTab]}"` : ''}</td></tr>
            ) : (
              filteredCredits.map(credit => {
                const customer = customerMap.get(credit.customer_id);
                const remaining = credit.total_due - credit.amount_paid;
                const percent = getPaymentPercent(credit);

                return (
                  <tr
                    key={credit.id}
                    className={styles['table__row--clickable']}
                    onClick={() => openDetail(credit)}
                  >
                    <td>{credit.id}</td>
                    <td>
                      <button
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-primary)',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-family)',
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 500,
                          padding: 0,
                          textDecoration: 'underline',
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          if (customer) openCustomerView(customer);
                        }}
                      >
                        {customer?.name ?? 'Desconocido'}
                      </button>
                    </td>
                    <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      {formatDate(credit.created_at)}
                    </td>
                    <td style={{ fontSize: 'var(--font-size-xs)' }}>
                      {formatDate(credit.due_date)}
                    </td>
                    <td>{formatCurrency(credit.total_due)}</td>
                    <td style={{ color: 'var(--color-success)' }}>{formatCurrency(credit.amount_paid)}</td>
                    <td style={{ fontWeight: 500 }}>{formatCurrency(remaining)}</td>
                    <td>
                      <div className={styles.progress}>
                        <div
                          className={`${styles['progress__fill']} ${getProgressClass(percent)}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge--${credit.status}`]}`}>
                        {STATUS_LABELS[credit.status]}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
