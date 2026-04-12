import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, DollarSign, Edit3, RefreshCw, Search, Trash2, User } from 'lucide-react';
import { useCredits } from '../hooks/useCredits';
import { useCustomers } from '../hooks/useCustomers';
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters';
import type { Credit, CreditPayment, CreditListItem, CreditsSummary, Customer, PaginatedQuery } from '../types';
import styles from './CreditsPage.module.css';

type ViewMode = 'list' | 'detail' | 'customer';
type TabFilter = 'all' | 'pending' | 'overdue' | 'paid';
type TimeRangeFilter = 'select' | '7d' | '30d' | '2m' | '3m' | 'all';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  overdue: 'Vencido',
  paid: 'Pagado',
};

const ROWS_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

function formatDateYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayLocalDateInput(): string {
  return formatDateYMD(new Date());
}

function getRangeDateFrom(range: TimeRangeFilter): string | undefined {
  if (range === 'all' || range === 'select') return undefined;
  const start = new Date();
  if (range === '7d') start.setDate(start.getDate() - 6);
  else if (range === '30d') start.setDate(start.getDate() - 29);
  else if (range === '2m') start.setMonth(start.getMonth() - 2);
  else if (range === '3m') start.setMonth(start.getMonth() - 3);
  return formatDateYMD(start);
}

interface CreditsPageProps {
  initialCreditId?: number | null;
  onInitialCreditHandled?: () => void;
}

export function CreditsPage({ initialCreditId, onInitialCreditHandled }: CreditsPageProps) {
  const {
    loading, error,
    addPayment, getPayments, getCreditById, checkOverdue,
    fetchCreditsPaginated, fetchCreditsByCustomerPaginated, fetchSummary,
    deleteCredit, updateCredit,
  } = useCredits();
  const { customers } = useCustomers();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRangeFilter, setTimeRangeFilter] = useState<TimeRangeFilter>('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Paginated list state
  const [creditItems, setCreditItems] = useState<CreditListItem[]>([]);
  const [totalCredits, setTotalCredits] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(15);
  const [summary, setSummary] = useState<CreditsSummary>({ countActive: 0, totalPending: 0, totalOverdue: 0, totalCollected: 0 });

  // Detail view state
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);

  // Customer view state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerCredits, setCustomerCredits] = useState<CreditListItem[]>([]);
  const [customerCreditsTotal, setCustomerCreditsTotal] = useState(0);
  const [customerPage, setCustomerPage] = useState(1);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(getTodayLocalDateInput());
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit credit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDueDate, setEditDueDate] = useState('');
  const [editSurchargePercent, setEditSurchargePercent] = useState('');

  // Debounced search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Load persisted rows per page
  useEffect(() => {
    async function loadPersistedRows() {
      try {
        const persisted = await window.electronAPI.settings.get('credits_rows_per_page');
        const parsed = Number(persisted);
        if (Number.isInteger(parsed) && ROWS_OPTIONS.includes(parsed as (typeof ROWS_OPTIONS)[number])) {
          setRowsPerPage(parsed);
        }
      } catch (err) {
        console.error('CreditsPage.loadPersistedRows:', err);
      }
    }
    void loadPersistedRows();
  }, []);

  async function handleRowsPerPageChange(value: number) {
    setRowsPerPage(value);
    setCurrentPage(1);
    try {
      await window.electronAPI.settings.set('credits_rows_per_page', String(value));
    } catch (err) {
      console.error('CreditsPage.handleRowsPerPageChange:', err);
    }
  }

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

  // Effective date filters
  const effectiveDates = useMemo(() => {
    if (startDateFilter || endDateFilter) {
      return { dateFrom: startDateFilter || undefined, dateTo: endDateFilter || undefined };
    }
    return { dateFrom: getRangeDateFrom(timeRangeFilter), dateTo: undefined };
  }, [startDateFilter, endDateFilter, timeRangeFilter]);

  // Load paginated credits
  const loadCredits = useCallback(async () => {
    const query: PaginatedQuery = {
      page: currentPage,
      pageSize: rowsPerPage,
      search: debouncedSearch || undefined,
      status: activeTab !== 'all' ? activeTab : undefined,
      dateFrom: effectiveDates.dateFrom,
      dateTo: effectiveDates.dateTo,
    };

    const [result, summaryResult] = await Promise.all([
      fetchCreditsPaginated(query),
      fetchSummary({
        search: query.search,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    ]);

    if (result) {
      setCreditItems(result.items);
      setTotalCredits(result.total);
    }
    if (summaryResult) {
      setSummary(summaryResult);
    }
  }, [currentPage, rowsPerPage, debouncedSearch, activeTab, effectiveDates, fetchCreditsPaginated, fetchSummary]);

  useEffect(() => {
    if (viewMode === 'list') {
      void loadCredits();
    }
  }, [loadCredits, viewMode]);

  const hasInvalidDateRange = Boolean(
    startDateFilter && endDateFilter
      && new Date(`${startDateFilter}T00:00:00`) > new Date(`${endDateFilter}T23:59:59.999`),
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCredits / rowsPerPage)),
    [totalCredits, rowsPerPage],
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  function handleTimeRangeFilterChange(nextFilter: TimeRangeFilter) {
    setTimeRangeFilter(nextFilter);
    setCurrentPage(1);
    if (nextFilter !== 'select') {
      setStartDateFilter('');
      setEndDateFilter('');
    }
  }

  function handleStartDateFilterChange(value: string) {
    setStartDateFilter(value);
    setCurrentPage(1);
    if (value || endDateFilter) setTimeRangeFilter('select');
  }

  function handleEndDateFilterChange(value: string) {
    setEndDateFilter(value);
    setCurrentPage(1);
    if (value || startDateFilter) setTimeRangeFilter('select');
  }

  function handleTabChange(tab: TabFilter) {
    setActiveTab(tab);
    setCurrentPage(1);
  }

  async function handleCheckOverdue() {
    try {
      const count = await checkOverdue();
      await loadCredits();
      if (count > 0) {
        showNotification('success', `Se aplicaron recargos a ${count} credito(s) vencido(s)`);
      } else {
        showNotification('success', 'No hay creditos vencidos nuevos');
      }
    } catch {
      showNotification('error', 'Error al verificar creditos vencidos');
    }
  }

  // Handle initialCreditId prop
  useEffect(() => {
    if (typeof initialCreditId !== 'number' || viewMode !== 'list') return;
    let cancelled = false;
    async function openInitialCreditDetail() {
      try {
        const targetCredit = await getCreditById(initialCreditId!);
        if (!targetCredit || cancelled) return;
        await openDetail(targetCredit);
      } finally {
        if (!cancelled) onInitialCreditHandled?.();
      }
    }
    void openInitialCreditDetail();
    return () => { cancelled = true; };
  }, [initialCreditId, viewMode]);

  const openDetail = useCallback(async (credit: Credit) => {
    setSelectedCredit(credit);
    setPaymentAmount('');
    setPaymentDate(getTodayLocalDateInput());
    setPaymentError(null);
    const payments = await getPayments(credit.id);
    setCreditPayments(payments);
    setViewMode('detail');
  }, [getPayments]);

  async function openCustomerView(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerPage(1);
    setViewMode('customer');
    const result = await fetchCreditsByCustomerPaginated(customer.id, { page: 1, pageSize: rowsPerPage });
    if (result) {
      setCustomerCredits(result.items);
      setCustomerCreditsTotal(result.total);
    }
  }

  async function loadCustomerCreditsPage(customerId: number, page: number) {
    const result = await fetchCreditsByCustomerPaginated(customerId, { page, pageSize: rowsPerPage });
    if (result) {
      setCustomerCredits(result.items);
      setCustomerCreditsTotal(result.total);
      setCustomerPage(page);
    }
  }

  function backToList() {
    setViewMode('list');
    setSelectedCredit(null);
    setSelectedCustomer(null);
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    setPaymentError(null);

    if (!selectedCredit) return;

    const amount = Math.round((parseFloat(paymentAmount) + Number.EPSILON) * 100) / 100;
    if (isNaN(amount) || amount <= 0) {
      setPaymentError('Ingresa un monto valido mayor a 0');
      return;
    }

    const remaining = selectedCredit.total_due - selectedCredit.amount_paid;
    if (amount > remaining) {
      setPaymentError(`El monto excede el saldo pendiente (${formatCurrency(remaining)})`);
      return;
    }

    if (!paymentDate) {
      setPaymentError('Selecciona una fecha de abono valida');
      return;
    }

    if (new Date(`${paymentDate}T00:00:00`) > new Date()) {
      setPaymentError('La fecha del abono no puede ser futura');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await addPayment(selectedCredit.id, amount, paymentDate);
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

  async function handleDeleteCredit(creditId: number, saleId: number) {
    const confirmed = window.confirm(
      `Se eliminara el credito #${creditId} y su venta asociada #${saleId}.\nEl stock de los productos se restablecera automaticamente.\n\nEsta accion no se puede deshacer.`
    );
    if (!confirmed) return;

    try {
      await deleteCredit(creditId);
      showNotification('success', `Credito #${creditId} y venta #${saleId} eliminados`);
      backToList();
      void loadCredits();
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al eliminar credito');
    }
  }

  function openEditModal(credit: Credit) {
    setEditDueDate(credit.due_date);
    setEditSurchargePercent(String(credit.surcharge_percent));
    setShowEditModal(true);
  }

  async function handleEditCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCredit) return;

    const updateData: { due_date?: string; surcharge_percent?: number } = {};

    if (editDueDate && editDueDate !== selectedCredit.due_date) {
      updateData.due_date = editDueDate;
    }

    const parsedSurcharge = parseFloat(editSurchargePercent);
    if (Number.isFinite(parsedSurcharge) && parsedSurcharge !== selectedCredit.surcharge_percent) {
      updateData.surcharge_percent = parsedSurcharge;
    }

    if (Object.keys(updateData).length === 0) {
      setShowEditModal(false);
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateCredit(selectedCredit.id, updateData);
      setSelectedCredit(updated);
      setShowEditModal(false);
      showNotification('success', 'Credito actualizado');
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al actualizar credito');
    } finally {
      setSubmitting(false);
    }
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
          <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
            {!isPaid && (
              <button
                className={styles['btn-secondary']}
                onClick={() => openEditModal(selectedCredit)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Edit3 size={14} strokeWidth={1.5} />
                Editar
              </button>
            )}
            <button
              className={styles['btn-danger']}
              onClick={() => void handleDeleteCredit(selectedCredit.id, selectedCredit.sale_id)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              Eliminar
            </button>
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

                <div className={styles['payment-form__field']}>
                  <label className={styles['payment-form__label']}>Fecha del abono *</label>
                  <input
                    className={styles['payment-form__input']}
                    type="date"
                    value={paymentDate}
                    max={getTodayLocalDateInput()}
                    onChange={e => setPaymentDate(e.target.value)}
                  />
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

        {/* Edit credit modal */}
        {showEditModal && (
          <div
            className={styles['modal-overlay'] ?? ''}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowEditModal(false)}
          >
            <div
              style={{
                backgroundColor: 'var(--color-card)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--spacing-lg)',
                width: '100%',
                maxWidth: 420,
                boxShadow: 'var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15))',
              }}
              onClick={e => e.stopPropagation()}
            >
              <h2 style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-lg)' }}>
                Editar credito #{selectedCredit.id}
              </h2>
              <form onSubmit={handleEditCredit}>
                <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                  <label className={styles['payment-form__label']}>Fecha limite</label>
                  <input
                    className={styles['payment-form__input']}
                    type="date"
                    value={editDueDate}
                    onChange={e => setEditDueDate(e.target.value)}
                    required
                  />
                </div>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                  <label className={styles['payment-form__label']}>% Recargo por atraso</label>
                  <input
                    className={styles['payment-form__input']}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={editSurchargePercent}
                    onChange={e => setEditSurchargePercent(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-xs)' }}>
                  <button
                    type="button"
                    className={styles['btn-secondary']}
                    onClick={() => setShowEditModal(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={styles['btn-primary']}
                    disabled={submitting}
                  >
                    {submitting ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =====================================================
  // CUSTOMER ACCOUNT VIEW
  // =====================================================
  if (viewMode === 'customer' && selectedCustomer) {
    const totalDebt = customerCredits
      .filter(c => c.status !== 'paid')
      .reduce((sum, c) => sum + (c.total_due - c.amount_paid), 0);
    const totalPaid = customerCredits.reduce((sum, c) => sum + c.amount_paid, 0);
    const activeCount = customerCredits.filter(c => c.status !== 'paid').length;
    const customerTotalPages = Math.max(1, Math.ceil(customerCreditsTotal / rowsPerPage));

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

        {customerCreditsTotal > rowsPerPage && (
          <div className={styles.pagination}>
            <span className={styles['pagination__meta']}>
              {customerCreditsTotal} credito(s) del cliente
            </span>
            <div className={styles['pagination__actions']}>
              <button className={styles['btn-secondary']} disabled={customerPage <= 1} onClick={() => loadCustomerCreditsPage(selectedCustomer.id, customerPage - 1)}>
                Anterior
              </button>
              <span className={styles['pagination__page']}>
                Pagina {customerPage} de {customerTotalPages}
              </span>
              <button className={styles['btn-secondary']} disabled={customerPage >= customerTotalPages} onClick={() => loadCustomerCreditsPage(selectedCustomer.id, customerPage + 1)}>
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =====================================================
  // LIST VIEW (Default)
  // =====================================================

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
            onClick={() => handleTabChange(tab)}
          >
            {tab === 'all' ? 'Todos' : STATUS_LABELS[tab]}
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
            aria-label="Fecha inicial"
          />
          <input
            className={styles['toolbar__filter']}
            type="date"
            value={endDateFilter}
            onChange={(event) => handleEndDateFilterChange(event.target.value)}
            aria-label="Fecha final"
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
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className={styles['table__empty']}>Cargando...</td></tr>
            ) : creditItems.length === 0 ? (
              <tr><td colSpan={10} className={styles['table__empty']}>No hay creditos{activeTab !== 'all' ? ` con estado "${STATUS_LABELS[activeTab]}"` : ''}</td></tr>
            ) : (
              creditItems.map(credit => {
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
                          const customer = customerMap.get(credit.customer_id);
                          if (customer) openCustomerView(customer);
                        }}
                      >
                        {credit.customer_name ?? 'Desconocido'}
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
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            color: 'var(--color-error)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Eliminar credito"
                          onClick={e => {
                            e.stopPropagation();
                            void handleDeleteCredit(credit.id, credit.sale_id);
                          }}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className={styles.pagination}>
        <span className={styles['pagination__meta']}>
          Mostrando {creditItems.length} de {totalCredits} credito(s)
        </span>
        <div className={styles['pagination__actions']}>
          <button className={styles['btn-secondary']} disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
            Anterior
          </button>
          <span className={styles['pagination__page']}>
            Pagina {currentPage} de {totalPages}
          </span>
          <button className={styles['btn-secondary']} disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
