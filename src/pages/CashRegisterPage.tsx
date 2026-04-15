import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, Plus, Lock, DollarSign, Edit2, Trash2 } from 'lucide-react';
import { useCashRegister } from '../hooks/useCashRegister';
import { formatCurrency, formatDate, formatDateTime, getBusinessTodayDate } from '../lib/formatters';
import type { CashRegisterPeriod, CashMovement, CreditPaymentListItem, SaleListItem, PaginatedResponse } from '../types';
import styles from './CashRegisterPage.module.css';

type ViewMode = 'current' | 'history' | 'detail';
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25] as const;

const EMPTY_SALES_RESPONSE: PaginatedResponse<SaleListItem> = {
  items: [], page: 1, pageSize: 5, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' },
};
const EMPTY_CREDITS_RESPONSE: PaginatedResponse<CreditPaymentListItem> = {
  items: [], page: 1, pageSize: 5, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' },
};
const EMPTY_MOVEMENTS_RESPONSE: PaginatedResponse<CashMovement> = {
  items: [], page: 1, pageSize: 10, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' },
};

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  expense: 'Gasto',
  withdrawal: 'Retiro',
  deposit: 'Deposito',
};

export function CashRegisterPage() {
  const {
    currentPeriod,
    periods,
    movements,
    salesSummary,
    loading,
    fetchCurrentPeriod,
    fetchAllPeriods,
    fetchMovements,
    fetchSalesSummary,
    fetchSalesPaginated,
    fetchCreditPaymentsPaginated,
    fetchMovementsPaginated,
    openPeriod,
    closePeriod,
    addMovement,
    updateMovement,
    deleteMovement,
  } = useCashRegister();

  const [viewMode, setViewMode] = useState<ViewMode>('current');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Open period form state
  const [periodName, setPeriodName] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [startDate, setStartDate] = useState(() => getBusinessTodayDate());
  const [openError, setOpenError] = useState<string | null>(null);

  // Movement form state
  const [movementType, setMovementType] = useState<'expense' | 'withdrawal' | 'deposit'>('expense');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementDescription, setMovementDescription] = useState('');
  const [movementDate, setMovementDate] = useState(() => getBusinessTodayDate());
  const [movementError, setMovementError] = useState<string | null>(null);

  // Edit movement modal state  
  const [editMovement, setEditMovement] = useState<CashMovement | null>(null);
  const [editType, setEditType] = useState<'expense' | 'withdrawal' | 'deposit'>('expense');
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Close period state
  const [closingCash, setClosingCash] = useState('');
  const [closingDate, setClosingDate] = useState(() => getBusinessTodayDate());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Detail view for historical periods
  const [selectedPeriod, setSelectedPeriod] = useState<CashRegisterPeriod | null>(null);
  const [selectedMovements, setSelectedMovements] = useState<PaginatedResponse<CashMovement>>(EMPTY_MOVEMENTS_RESPONSE);

  // Current period paginated data
  const [currentSalesData, setCurrentSalesData] = useState<PaginatedResponse<SaleListItem>>(EMPTY_SALES_RESPONSE);
  const [currentCreditsData, setCurrentCreditsData] = useState<PaginatedResponse<CreditPaymentListItem>>(EMPTY_CREDITS_RESPONSE);

  const [currentSalesSearch, setCurrentSalesSearch] = useState('');
  const [currentSalesPage, setCurrentSalesPage] = useState(1);
  const [currentSalesPageSize, setCurrentSalesPageSize] = useState<number>(5);

  // Detail view paginated data
  const [detailSalesData, setDetailSalesData] = useState<PaginatedResponse<SaleListItem>>(EMPTY_SALES_RESPONSE);
  const [detailCreditsData, setDetailCreditsData] = useState<PaginatedResponse<CreditPaymentListItem>>(EMPTY_CREDITS_RESPONSE);

  const [detailSalesSearch, setDetailSalesSearch] = useState('');
  const [detailSalesPage, setDetailSalesPage] = useState(1);
  const [detailSalesPageSize, setDetailSalesPageSize] = useState<number>(5);

  const [currentCreditsSearch, setCurrentCreditsSearch] = useState('');
  const [currentCreditsPage, setCurrentCreditsPage] = useState(1);
  const [currentCreditsPageSize, setCurrentCreditsPageSize] = useState<number>(5);

  const [detailCreditsSearch, setDetailCreditsSearch] = useState('');
  const [detailCreditsPage, setDetailCreditsPage] = useState(1);
  const [detailCreditsPageSize, setDetailCreditsPageSize] = useState<number>(5);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchCurrentPeriod();
    fetchAllPeriods();
  }, [fetchCurrentPeriod, fetchAllPeriods]);

  // Load movements when we have a current period
  useEffect(() => {
    if (currentPeriod) {
      fetchMovements(currentPeriod.id);
      void fetchSalesSummary(currentPeriod.id);
      void loadCurrentSales();
      void loadCurrentCredits();
    }
  // Only re-run when period changes, not when search/page state changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPeriod?.id]);

  useEffect(() => {
    setCurrentSalesSearch('');
    setCurrentSalesPage(1);
    setCurrentCreditsSearch('');
    setCurrentCreditsPage(1);
  }, [currentPeriod?.id]);

  // Reload current sales when search/page/pageSize changes
  useEffect(() => {
    if (!currentPeriod) return;
    void loadCurrentSales();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSalesSearch, currentSalesPage, currentSalesPageSize, currentPeriod?.id]);

  // Reload current credits when search/page/pageSize changes
  useEffect(() => {
    if (!currentPeriod) return;
    void loadCurrentCredits();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCreditsSearch, currentCreditsPage, currentCreditsPageSize, currentPeriod?.id]);

  // Polling: only refresh salesSummary every 15 seconds (not full lists)
  useEffect(() => {
    if (!currentPeriod) return;
    if (viewMode !== 'current') return;

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchSalesSummary(currentPeriod.id);
      }
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentPeriod, viewMode, fetchSalesSummary]);

  async function loadCurrentSales() {
    if (!currentPeriod) return;
    const result = await fetchSalesPaginated(currentPeriod.id, {
      page: currentSalesPage,
      pageSize: currentSalesPageSize,
      search: currentSalesSearch || undefined,
    });
    setCurrentSalesData(result);
  }

  async function loadCurrentCredits() {
    if (!currentPeriod) return;
    const result = await fetchCreditPaymentsPaginated(currentPeriod.id, {
      page: currentCreditsPage,
      pageSize: currentCreditsPageSize,
      search: currentCreditsSearch || undefined,
    });
    setCurrentCreditsData(result);
  }

  // Reload detail sales when search/page/pageSize changes
  useEffect(() => {
    if (!selectedPeriod) return;
    void loadDetailSales();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailSalesSearch, detailSalesPage, detailSalesPageSize, selectedPeriod?.id]);

  // Reload detail credits when search/page/pageSize changes
  useEffect(() => {
    if (!selectedPeriod) return;
    void loadDetailCredits();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailCreditsSearch, detailCreditsPage, detailCreditsPageSize, selectedPeriod?.id]);

  async function loadDetailSales() {
    if (!selectedPeriod) return;
    const result = await fetchSalesPaginated(selectedPeriod.id, {
      page: detailSalesPage,
      pageSize: detailSalesPageSize,
      search: detailSalesSearch || undefined,
    });
    setDetailSalesData(result);
  }

  async function loadDetailCredits() {
    if (!selectedPeriod) return;
    const result = await fetchCreditPaymentsPaginated(selectedPeriod.id, {
      page: detailCreditsPage,
      pageSize: detailCreditsPageSize,
      search: detailCreditsSearch || undefined,
    });
    setDetailCreditsData(result);
  }

  function getSaleTypeLabel(type: SaleListItem['sale_type']): string {
    return type === 'cash' ? 'Efectivo' : 'Credito';
  }

  function renderSalesTable(params: {
    title: string;
    data: PaginatedResponse<SaleListItem>;
    meta?: string;
    searchValue: string;
    onSearchChange: (value: string) => void;
    page: number;
    onPageChange: (value: number) => void;
    pageSize: number;
    onPageSizeChange: (value: number) => void;
  }) {
    const {
      title,
      data,
      meta,
      searchValue,
      onSearchChange,
      page,
      onPageChange,
      pageSize,
      onPageSizeChange,
    } = params;

    const totalRows = data.total;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);

    return (
      <div className={styles['table-card']}>
        <div className={styles['table-card__header']}>
          <div className={styles['table-card__title']}>{title}</div>
          <div className={styles['table-card__toolbar']}>
            <input
              type="text"
              className={styles['table-card__search']}
              placeholder="Buscar por folio, cliente, tipo o fecha"
              value={searchValue}
              onChange={event => {
                onSearchChange(event.target.value);
                onPageChange(1);
              }}
            />
            <select
              className={styles['table-card__rows-select']}
              value={String(pageSize)}
              onChange={event => {
                onPageSizeChange(Number(event.target.value));
                onPageChange(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size} por pagina</option>
              ))}
            </select>
          </div>
        </div>
        {meta ? <div className={styles['table-card__meta']}>{meta}</div> : null}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Tipo</th>
              <th>Cliente</th>
              <th>Items</th>
              <th>Total</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles['table__empty']}>
                  {searchValue.trim()
                    ? 'Sin resultados para la busqueda'
                    : 'No hay ventas asociadas a este periodo'}
                </td>
              </tr>
            ) : (
              data.items.map(s => (
                <tr key={s.id}>
                  <td><span className={styles['table__strong']}>#{s.id}</span></td>
                  <td>{getSaleTypeLabel(s.sale_type)}</td>
                  <td>{s.customer_name || '-'}</td>
                  <td>{s.item_count}</td>
                  <td>{formatCurrency(s.total)}</td>
                  <td>{formatDateTime(s.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className={styles['table-card__pagination']}>
          <span className={styles['table-card__pagination-meta']}>
            {totalRows === 0
              ? 'Sin resultados'
              : `Mostrando ${startIndex + 1}-${endIndex} de ${totalRows}`}
          </span>
          <div className={styles['table-card__pagination-actions']}>
            <button
              className={styles['btn-secondary']}
              onClick={() => onPageChange(safePage - 1)}
              disabled={safePage <= 1}
            >
              Anterior
            </button>
            <span className={styles['table-card__pagination-page']}>Pagina {safePage} de {totalPages}</span>
            <button
              className={styles['btn-secondary']}
              onClick={() => onPageChange(safePage + 1)}
              disabled={safePage >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderCreditPaymentsTable(params: {
    title: string;
    data: PaginatedResponse<CreditPaymentListItem>;
    meta?: string;
    searchValue: string;
    onSearchChange: (value: string) => void;
    page: number;
    onPageChange: (value: number) => void;
    pageSize: number;
    onPageSizeChange: (value: number) => void;
  }) {
    const {
      title,
      data,
      meta,
      searchValue,
      onSearchChange,
      page,
      onPageChange,
      pageSize,
      onPageSizeChange,
    } = params;

    const totalRows = data.total;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);

    return (
      <div className={styles['table-card']}>
        <div className={styles['table-card__header']}>
          <div className={styles['table-card__title']}>{title}</div>
          <div className={styles['table-card__toolbar']}>
            <input
              type="text"
              className={styles['table-card__search']}
              placeholder="Buscar por abono, credito, venta, cliente o fecha"
              value={searchValue}
              onChange={event => {
                onSearchChange(event.target.value);
                onPageChange(1);
              }}
            />
            <select
              className={styles['table-card__rows-select']}
              value={String(pageSize)}
              onChange={event => {
                onPageSizeChange(Number(event.target.value));
                onPageChange(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size} por pagina</option>
              ))}
            </select>
          </div>
        </div>
        {meta ? <div className={styles['table-card__meta']}>{meta}</div> : null}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID Abono</th>
              <th>Credito</th>
              <th>Venta</th>
              <th>Cliente</th>
              <th>Monto</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles['table__empty']}>
                  {searchValue.trim()
                    ? 'Sin resultados para la búsqueda actual'
                    : 'No hay abonos de credito asociados a este periodo'}
                </td>
              </tr>
            ) : (
              data.items.map(payment => (
                <tr key={payment.id}>
                  <td><span className={styles['table__strong']}>#{payment.id}</span></td>
                  <td>#{payment.credit_id}</td>
                  <td>#{payment.sale_id}</td>
                  <td>{payment.customer_name || '-'}</td>
                  <td>{formatCurrency(payment.amount)}</td>
                  <td>{formatDateTime(payment.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className={styles['table-card__pagination']}>
          <span className={styles['table-card__pagination-meta']}>
            {totalRows === 0
              ? 'Sin resultados'
              : `Mostrando ${startIndex + 1}-${endIndex} de ${totalRows}`}
          </span>
          <div className={styles['table-card__pagination-actions']}>
            <button
              className={styles['btn-secondary']}
              onClick={() => onPageChange(safePage - 1)}
              disabled={safePage <= 1}
            >
              Anterior
            </button>
            <span className={styles['table-card__pagination-page']}>Pagina {safePage} de {totalPages}</span>
            <button
              className={styles['btn-secondary']}
              onClick={() => onPageChange(safePage + 1)}
              disabled={safePage >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    );
  }

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  function getDateOnly(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value.slice(0, 10);
    }

    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  }

  function parseDateOnly(value: string): number | null {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return null;
    }

    const [year, month, day] = trimmed.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(parsed.getTime())
      || parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day
    ) {
      return null;
    }

    return parsed.getTime();
  }

  useEffect(() => {
    setMovementDate(getBusinessTodayDate());
  }, [currentPeriod?.id]);

  // Summary for the current period based on live movements
  const movementsSummary = useMemo(() => {
    const totalExpenses = movements
      .filter(m => m.type === 'expense')
      .reduce((sum, m) => sum + m.amount, 0);
    const totalWithdrawals = movements
      .filter(m => m.type === 'withdrawal')
      .reduce((sum, m) => sum + m.amount, 0);
    const totalDeposits = movements
      .filter(m => m.type === 'deposit')
      .reduce((sum, m) => sum + m.amount, 0);
    return { totalExpenses, totalWithdrawals, totalDeposits };
  }, [movements]);

  async function handleOpenPeriod() {
    setOpenError(null);
    const cash = parseFloat(openingCash);

    if (!periodName.trim()) {
      setOpenError('Ingrese un nombre para el periodo');
      return;
    }
    if (isNaN(cash) || cash < 0) {
      setOpenError('Ingrese un monto valido para el efectivo inicial');
      return;
    }

    if (!startDate) {
      setOpenError('Seleccione una fecha de inicio');
      return;
    }

    try {
      setSubmitting(true);
      await openPeriod({
        period_name: periodName.trim(),
        start_date: startDate,
        opening_cash: cash,
      });
      await fetchAllPeriods();
      setPeriodName('');
      setOpeningCash('');
      showNotification('success', 'Periodo de caja abierto correctamente');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al abrir periodo';
      showNotification('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddMovement() {
    setMovementError(null);
    const amount = parseFloat(movementAmount);
    const todayDate = getBusinessTodayDate();

    if (isNaN(amount) || amount <= 0) {
      setMovementError('Ingrese un monto valido mayor a 0');
      return;
    }
    if (!currentPeriod) return;
    if (!movementDate) {
      setMovementError('Seleccione la fecha del movimiento');
      return;
    }
    const periodStartDate = getDateOnly(currentPeriod.start_date);
    const movementTime = parseDateOnly(movementDate);
    const periodStartTime = parseDateOnly(periodStartDate);

    if (movementTime === null) {
      setMovementError('La fecha del movimiento no es valida');
      return;
    }

    if (periodStartTime === null) {
      setMovementError('La fecha de inicio del periodo no es valida');
      return;
    }

    if (movementTime < periodStartTime) {
      setMovementError('La fecha del movimiento no puede ser menor a la fecha de inicio del periodo');
      return;
    }
    if (movementDate > todayDate) {
      setMovementError('La fecha del movimiento no puede ser futura');
      return;
    }

    try {
      setSubmitting(true);
      await addMovement({
        cash_register_id: currentPeriod.id,
        type: movementType,
        amount,
        description: movementDescription.trim() || null,
        movement_date: movementDate,
      });
      setMovementAmount('');
      setMovementDescription('');
      setMovementDate(todayDate);
      showNotification('success', `${MOVEMENT_TYPE_LABELS[movementType]} registrado correctamente`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar movimiento';
      showNotification('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  function openEditMovementModal(movement: CashMovement) {
    setEditMovement(movement);
    setEditType(movement.type);
    setEditAmount(movement.amount.toString());
    setEditDescription(movement.description || '');
    setEditError(null);
  }

  function closeEditMovementModal() {
    setEditMovement(null);
    setEditType('expense');
    setEditAmount('');
    setEditDescription('');
    setEditError(null);
  }

  async function handleUpdateMovement() {
    if (!editMovement) return;
    setEditError(null);
    const amount = parseFloat(editAmount);

    if (isNaN(amount) || amount <= 0) {
      setEditError('Ingrese un monto valido mayor a 0');
      return;
    }

    try {
      setSubmitting(true);
      await updateMovement(editMovement.id, {
        type: editType,
        amount,
        description: editDescription.trim() || null,
      });
      closeEditMovementModal();
      showNotification('success', `${MOVEMENT_TYPE_LABELS[editType]} actualizado correctamente`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar movimiento';
      showNotification('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteMovement(movementId: number) {
    if (!confirm('¿Está seguro de que desea eliminar este movimiento?')) return;

    try {
      setSubmitting(true);
      await deleteMovement(movementId);
      showNotification('success', 'Movimiento eliminado correctamente');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar movimiento';
      showNotification('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClosePeriod() {
    if (!currentPeriod) return;
    const cash = parseFloat(closingCash);

    if (isNaN(cash) || cash < 0) {
      showNotification('error', 'Ingrese el efectivo final contado');
      setShowCloseConfirm(false);
      return;
    }

    if (!closingDate) {
      showNotification('error', 'Seleccione una fecha de cierre');
      setShowCloseConfirm(false);
      return;
    }

    const periodStartDate = getDateOnly(currentPeriod.start_date);
    const closingTime = parseDateOnly(closingDate);
    const periodStartTime = parseDateOnly(periodStartDate);

    if (closingTime === null) {
      showNotification('error', 'La fecha de cierre no es valida');
      setShowCloseConfirm(false);
      return;
    }

    if (periodStartTime === null) {
      showNotification('error', 'La fecha de inicio del periodo no es valida');
      setShowCloseConfirm(false);
      return;
    }

    if (closingTime < periodStartTime) {
      showNotification('error', 'La fecha de cierre no puede ser menor a la fecha de inicio del periodo');
      setShowCloseConfirm(false);
      return;
    }

    try {
      setSubmitting(true);
      setShowCloseConfirm(false);
      await closePeriod(currentPeriod.id, cash, closingDate);
      await fetchAllPeriods();
      setClosingCash('');
      showNotification('success', 'Periodo de caja cerrado correctamente');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cerrar periodo';
      showNotification('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  const handleViewPeriodDetail = useCallback(async (period: CashRegisterPeriod) => {
    setSelectedPeriod(period);
    setViewMode('detail');
    setDetailSalesSearch('');
    setDetailSalesPage(1);
    setDetailCreditsSearch('');
    setDetailCreditsPage(1);
    try {
      const [movs, periodSales, periodCreditPayments] = await Promise.all([
        fetchMovementsPaginated(period.id, { page: 1, pageSize: 10 }),
        fetchSalesPaginated(period.id, { page: 1, pageSize: 5 }),
        fetchCreditPaymentsPaginated(period.id, { page: 1, pageSize: 5 }),
      ]);
      setSelectedMovements(movs);
      setDetailSalesData(periodSales);
      setDetailCreditsData(periodCreditPayments);
    } catch (err) {
      console.error('Error loading period detail:', err);
      setSelectedMovements(EMPTY_MOVEMENTS_RESPONSE);
      setDetailSalesData(EMPTY_SALES_RESPONSE);
      setDetailCreditsData(EMPTY_CREDITS_RESPONSE);
    }
  }, [fetchMovementsPaginated, fetchSalesPaginated, fetchCreditPaymentsPaginated]);

  // Closed periods for history view
  const closedPeriods = useMemo(() =>
    periods.filter(p => p.status === 'closed'),
    [periods]
  );

  function renderOpenForm() {
    return (
      <div className={styles['open-form']}>
        <h2 className={styles['open-form__title']}>Abrir Periodo de Caja</h2>
        <p className={styles['empty-state__text']}>
          No hay un periodo de caja abierto. Abra uno para comenzar a registrar ventas y movimientos.
        </p>
        <div className={styles['form-field']}>
          <label className={styles['form-field__label']}>Nombre del periodo</label>
          <input
            type="text"
            className={styles['form-field__input']}
            value={periodName}
            onChange={e => setPeriodName(e.target.value)}
            placeholder="Ej. Marzo 2026"
          />
        </div>
        <div className={styles['form-field']}>
          <label className={styles['form-field__label']}>Fecha de inicio</label>
          <input
            type="date"
            className={styles['form-field__input']}
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div className={styles['form-field']}>
          <label className={styles['form-field__label']}>Efectivo inicial</label>
          <input
            type="number"
            className={styles['form-field__input']}
            value={openingCash}
            onChange={e => setOpeningCash(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
          />
        </div>
        {openError && <span className={styles['form-field__error']}>{openError}</span>}
        <button
          className={styles['btn-primary']}
          onClick={handleOpenPeriod}
          disabled={submitting}
        >
          <Plus size={16} />
          Abrir Periodo
        </button>
      </div>
    );
  }

  function renderCurrentPeriod() {
    if (!currentPeriod) return renderOpenForm();

    const totalSalesRevenue = salesSummary.total_cash_sales + salesSummary.total_credit_sales;

    return (
      <>
        {/* Status Banner */}
        <div className={styles['status-banner']}>
          <div className={styles['status-banner__info']}>
            <div className={styles['status-banner__title']}>
              {currentPeriod.period_name}
              <span className={`${styles.badge} ${styles['badge--open']}`} style={{ marginLeft: 8 }}>Abierto</span>
            </div>
            <div className={styles['status-banner__meta']}>
              Inicio: {formatDate(currentPeriod.start_date)} | Efectivo inicial: {formatCurrency(currentPeriod.opening_cash)}
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className={styles.summary}>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Ventas</span>
            <span className={styles['summary__value']}>{salesSummary.sale_count}</span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Total vendido</span>
            <span className={styles['summary__value']}>{formatCurrency(totalSalesRevenue)}</span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Ventas efectivo</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
              {formatCurrency(salesSummary.total_cash_sales)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Ventas credito</span>
            <span className={styles['summary__value']}>{formatCurrency(salesSummary.total_credit_sales)}</span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Cobros credito</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
              {formatCurrency(salesSummary.total_credit_collected)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Gastos</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--error']}`}>
              {formatCurrency(movementsSummary.totalExpenses)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Retiros</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--warning']}`}>
              {formatCurrency(movementsSummary.totalWithdrawals)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Depositos</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
              {formatCurrency(movementsSummary.totalDeposits)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Movimientos</span>
            <span className={styles['summary__value']}>
              {movements.length}
            </span>
          </div>
        </div>

        {/* Movement Form + Movements List */}
        <div className={styles.content}>
          {/* Movement Form */}
          <div className={styles.card}>
            <h3 className={styles['card__title']}>
              <DollarSign size={20} />
              Registrar Movimiento
            </h3>
            <div className={styles['movement-form']}>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Tipo</label>
                <select
                  className={styles['form-field__select']}
                  value={movementType}
                  onChange={e => setMovementType(e.target.value as 'expense' | 'withdrawal' | 'deposit')}
                >
                  <option value="expense">Gasto</option>
                  <option value="withdrawal">Retiro</option>
                  <option value="deposit">Deposito</option>
                </select>
              </div>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Monto</label>
                <input
                  type="number"
                  className={styles['form-field__input']}
                  value={movementAmount}
                  onChange={e => setMovementAmount(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                />
              </div>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Fecha del movimiento</label>
                <input
                  type="date"
                  className={styles['form-field__input']}
                  value={movementDate}
                  onChange={e => setMovementDate(e.target.value)}
                  min={getDateOnly(currentPeriod.start_date)}
                  max={getBusinessTodayDate()}
                />
              </div>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Descripcion (opcional)</label>
                <input
                  type="text"
                  className={styles['form-field__input']}
                  value={movementDescription}
                  onChange={e => setMovementDescription(e.target.value)}
                  placeholder="Ej. Compra de papeleria, pago de luz..."
                />
              </div>
              {movementError && <span className={styles['form-field__error']}>{movementError}</span>}
              <button
                className={styles['btn-primary']}
                onClick={handleAddMovement}
                disabled={submitting}
              >
                <Plus size={16} />
                Registrar
              </button>
            </div>
          </div>

          {/* Movements List */}
          <div className={styles['table-card']}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Monto</th>
                  <th>Descripcion</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles['table__empty']}>
                      No hay movimientos registrados en este periodo
                    </td>
                  </tr>
                ) : (
                  movements.map(m => (
                    <tr key={m.id}>
                      <td>
                        <span className={`${styles['movement-type']} ${styles[`movement-type--${m.type}`]}`}>
                          {MOVEMENT_TYPE_LABELS[m.type]}
                        </span>
                      </td>
                      <td>{formatCurrency(m.amount)}</td>
                      <td>{m.description || '-'}</td>
                      <td>{formatDateTime(m.created_at)}</td>
                      <td style={{ textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          className={styles['btn-icon']}
                          onClick={() => openEditMovementModal(m)}
                          title="Editar"
                          disabled={submitting}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          className={`${styles['btn-icon']} ${styles['btn-icon--danger']}`}
                          onClick={() => handleDeleteMovement(m.id)}
                          title="Eliminar"
                          disabled={submitting}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Close Period Panel */}
        {renderSalesTable(
          {
            title: 'Ventas asociadas al periodo',
            data: currentSalesData,
            meta: salesSummary.sale_count > 0 ? `Ventas registradas: ${salesSummary.sale_count}` : undefined,
            searchValue: currentSalesSearch,
            onSearchChange: setCurrentSalesSearch,
            page: currentSalesPage,
            onPageChange: setCurrentSalesPage,
            pageSize: currentSalesPageSize,
            onPageSizeChange: setCurrentSalesPageSize,
          }
        )}

        {renderCreditPaymentsTable(
          {
            title: 'Abonos de credito del periodo',
            data: currentCreditsData,
            meta: currentCreditsData.total > 0 ? `Abonos registrados: ${currentCreditsData.total}` : undefined,
            searchValue: currentCreditsSearch,
            onSearchChange: setCurrentCreditsSearch,
            page: currentCreditsPage,
            onPageChange: setCurrentCreditsPage,
            pageSize: currentCreditsPageSize,
            onPageSizeChange: setCurrentCreditsPageSize,
          }
        )}

        <div className={styles['close-panel']}>
          <h3 className={styles['close-panel__title']}>Cerrar Periodo</h3>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Efectivo inicial</span>
            <span className={styles['close-panel__value']}>{formatCurrency(currentPeriod.opening_cash)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Ventas efectivo</span>
            <span className={styles['close-panel__value']}>{formatCurrency(salesSummary.total_cash_sales)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Ventas credito</span>
            <span className={styles['close-panel__value']}>{formatCurrency(salesSummary.total_credit_sales)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Cobros credito</span>
            <span className={styles['close-panel__value']}>{formatCurrency(salesSummary.total_credit_collected)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Total gastos</span>
            <span className={styles['close-panel__value']}>{formatCurrency(movementsSummary.totalExpenses)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Total retiros</span>
            <span className={styles['close-panel__value']}>{formatCurrency(movementsSummary.totalWithdrawals)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Total depositos</span>
            <span className={styles['close-panel__value']}>{formatCurrency(movementsSummary.totalDeposits)}</span>
          </div>
          <div className={styles['form-field']}>
            <label className={styles['form-field__label']}>Fecha de cierre</label>
            <input
              type="date"
              className={styles['form-field__input']}
              value={closingDate}
              onChange={e => setClosingDate(e.target.value)}
              min={getDateOnly(currentPeriod.start_date)}
            />
          </div>
          <div className={styles['form-field']}>
            <label className={styles['form-field__label']}>Efectivo final contado</label>
            <input
              type="number"
              className={styles['form-field__input']}
              value={closingCash}
              onChange={e => setClosingCash(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
            />
          </div>
          <button
            className={styles['btn-danger']}
            onClick={() => setShowCloseConfirm(true)}
            disabled={submitting}
          >
            <Lock size={16} />
            Cerrar Periodo
          </button>
        </div>
      </>
    );
  }

  function renderHistory() {
    return (
      <div className={styles['table-card']}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Periodo</th>
              <th>Inicio</th>
              <th>Cierre</th>
              <th>Ventas Efectivo</th>
              <th>Ventas Credito</th>
              <th>Gastos</th>
              <th>Efectivo Cierre</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {closedPeriods.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles['table__empty']}>
                  No hay periodos cerrados todavia
                </td>
              </tr>
            ) : (
              closedPeriods.map(p => (
                <tr
                  key={p.id}
                  className={styles['table__row--clickable']}
                  onClick={() => handleViewPeriodDetail(p)}
                >
                  <td style={{ fontWeight: 500 }}>{p.period_name}</td>
                  <td>{formatDate(p.start_date)}</td>
                  <td>{p.end_date ? formatDate(p.end_date) : '-'}</td>
                  <td>{formatCurrency(p.total_cash_sales)}</td>
                  <td>{formatCurrency(p.total_credit_sales)}</td>
                  <td>{formatCurrency(p.total_expenses)}</td>
                  <td>{p.closing_cash !== null ? formatCurrency(p.closing_cash) : '-'}</td>
                  <td>
                    <span className={`${styles.badge} ${styles['badge--closed']}`}>Cerrado</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderDetail() {
    if (!selectedPeriod) return null;

    const expectedCash = selectedPeriod.opening_cash
      + selectedPeriod.total_cash_sales
      + selectedPeriod.total_credit_collected
      - selectedPeriod.total_expenses;
    const difference = (selectedPeriod.closing_cash ?? 0) - expectedCash;

    let diffClass = styles['close-panel__diff--zero'];
    let diffLabel = 'Cuadre exacto';
    if (difference > 0.01) {
      diffClass = styles['close-panel__diff--positive'];
      diffLabel = `Sobrante: ${formatCurrency(difference)}`;
    } else if (difference < -0.01) {
      diffClass = styles['close-panel__diff--negative'];
      diffLabel = `Faltante: ${formatCurrency(Math.abs(difference))}`;
    }

    return (
      <div className={styles['period-detail']}>
        <div className={styles['period-detail__header']}>
          <button
            className={styles['period-detail__back']}
            onClick={() => { setViewMode('history'); setSelectedPeriod(null); }}
          >
            <ArrowLeft size={16} />
            Volver
          </button>
          <h2>{selectedPeriod.period_name}</h2>
          <span className={`${styles.badge} ${styles['badge--closed']}`}>Cerrado</span>
        </div>

        {/* Period Summary */}
        <div className={styles.summary}>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Efectivo Inicial</span>
            <span className={styles['summary__value']}>{formatCurrency(selectedPeriod.opening_cash)}</span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Ventas Efectivo</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
              {formatCurrency(selectedPeriod.total_cash_sales)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Ventas Credito</span>
            <span className={styles['summary__value']}>{formatCurrency(selectedPeriod.total_credit_sales)}</span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Cobros Credito</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--success']}`}>
              {formatCurrency(selectedPeriod.total_credit_collected)}
            </span>
          </div>
          <div className={styles['summary__card']}>
            <span className={styles['summary__label']}>Gastos Totales</span>
            <span className={`${styles['summary__value']} ${styles['summary__value--error']}`}>
              {formatCurrency(selectedPeriod.total_expenses)}
            </span>
          </div>
        </div>

        {/* Close reconciliation */}
        <div className={styles['close-panel']}>
          <h3 className={styles['close-panel__title']}>Resumen de Cierre</h3>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Efectivo esperado</span>
            <span className={`${styles['close-panel__value']} ${styles['close-panel__value--large']}`}>
              {formatCurrency(expectedCash)}
            </span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Efectivo contado</span>
            <span className={`${styles['close-panel__value']} ${styles['close-panel__value--large']}`}>
              {selectedPeriod.closing_cash !== null ? formatCurrency(selectedPeriod.closing_cash) : '-'}
            </span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Diferencia</span>
            <span className={`${styles['close-panel__value']} ${styles['close-panel__value--large']} ${diffClass}`}>
              {diffLabel}
            </span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Fecha inicio</span>
            <span className={styles['close-panel__value']}>{formatDate(selectedPeriod.start_date)}</span>
          </div>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Fecha cierre</span>
            <span className={styles['close-panel__value']}>
              {selectedPeriod.end_date ? formatDateTime(selectedPeriod.end_date) : '-'}
            </span>
          </div>
        </div>

        {renderSalesTable(
          {
            title: 'Ventas del periodo',
            data: detailSalesData,
            meta: detailSalesData.total > 0 ? `Ventas registradas: ${detailSalesData.total}` : undefined,
            searchValue: detailSalesSearch,
            onSearchChange: setDetailSalesSearch,
            page: detailSalesPage,
            onPageChange: setDetailSalesPage,
            pageSize: detailSalesPageSize,
            onPageSizeChange: setDetailSalesPageSize,
          }
        )}

        {renderCreditPaymentsTable(
          {
            title: 'Abonos de credito del periodo',
            data: detailCreditsData,
            meta: detailCreditsData.total > 0 ? `Abonos registrados: ${detailCreditsData.total}` : undefined,
            searchValue: detailCreditsSearch,
            onSearchChange: setDetailCreditsSearch,
            page: detailCreditsPage,
            onPageChange: setDetailCreditsPage,
            pageSize: detailCreditsPageSize,
            onPageSizeChange: setDetailCreditsPageSize,
          }
        )}

        {/* Period Movements */}
        <div className={styles['table-card']}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Monto</th>
                <th>Descripcion</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {selectedMovements.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles['table__empty']}>
                    No hubo movimientos de caja en este periodo
                  </td>
                </tr>
              ) : (
                selectedMovements.items.map(m => (
                  <tr key={m.id}>
                    <td>
                      <span className={`${styles['movement-type']} ${styles[`movement-type--${m.type}`]}`}>
                        {MOVEMENT_TYPE_LABELS[m.type]}
                      </span>
                    </td>
                    <td>{formatCurrency(m.amount)}</td>
                    <td>{m.description || '-'}</td>
                    <td>{formatDateTime(m.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (loading && !currentPeriod && periods.length === 0) {
    return (
      <div className={styles.page}>
        <p>Cargando...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {notification && (
        <div className={`${styles.notification} ${styles[`notification--${notification.type}`]}`}>
          {notification.message}
        </div>
      )}

      {showCloseConfirm && (
        <div className={styles['confirm-overlay']}>
          <div className={styles['confirm-dialog']}>
            <h3 className={styles['confirm-dialog__title']}>Confirmar Cierre</h3>
            <p className={styles['confirm-dialog__text']}>
              Esta accion cerrara el periodo de caja actual. Los totales se calcularan automaticamente
              a partir de las ventas y movimientos registrados. Esta accion no se puede deshacer.
            </p>
            <div className={styles['confirm-dialog__actions']}>
              <button
                className={styles['btn-secondary']}
                onClick={() => setShowCloseConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className={styles['btn-danger']}
                onClick={handleClosePeriod}
                disabled={submitting}
              >
                Cerrar Periodo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Movement Modal */}
      {editMovement && (
        <div className={styles['confirm-overlay']}>
          <div className={styles['confirm-dialog']}>
            <h3 className={styles['confirm-dialog__title']}>Editar Movimiento</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Tipo</label>
                <select
                  className={styles['form-field__select']}
                  value={editType}
                  onChange={e => setEditType(e.target.value as 'expense' | 'withdrawal' | 'deposit')}
                >
                  <option value="expense">Gasto</option>
                  <option value="withdrawal">Retiro</option>
                  <option value="deposit">Deposito</option>
                </select>
              </div>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Monto</label>
                <input
                  type="number"
                  className={styles['form-field__input']}
                  value={editAmount}
                  onChange={e => setEditAmount(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                />
              </div>
              <div className={styles['form-field']}>
                <label className={styles['form-field__label']}>Descripcion (opcional)</label>
                <input
                  type="text"
                  className={styles['form-field__input']}
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder="Descripcion"
                />
              </div>
              {editError && <span className={styles['form-field__error']}>{editError}</span>}
              <div className={styles['confirm-dialog__actions']}>
                <button
                  className={styles['btn-secondary']}
                  onClick={closeEditMovementModal}
                >
                  Cancelar
                </button>
                <button
                  className={styles['btn-primary']}
                  onClick={handleUpdateMovement}
                  disabled={submitting}
                >
                  Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Only show header + tabs when not in detail view */}
      {viewMode !== 'detail' && (
        <>
          <div className={styles['page__header']}>
            <h1 className={styles['page__title']}>Caja</h1>
          </div>

          <div className={styles.tabs}>
            <button
              className={`${styles['tabs__item']} ${viewMode === 'current' ? styles['tabs__item--active'] : ''}`}
              onClick={() => setViewMode('current')}
            >
              Periodo Actual
            </button>
            <button
              className={`${styles['tabs__item']} ${viewMode === 'history' ? styles['tabs__item--active'] : ''}`}
              onClick={() => { setViewMode('history'); fetchAllPeriods(); }}
            >
              Historial de Cortes
            </button>
          </div>
        </>
      )}

      {viewMode === 'current' && renderCurrentPeriod()}
      {viewMode === 'history' && renderHistory()}
      {viewMode === 'detail' && renderDetail()}
    </div>
  );
}
