import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, Plus, Lock, DollarSign } from 'lucide-react';
import { useCashRegister } from '../hooks/useCashRegister';
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters';
import type { CashRegisterPeriod, CashMovement } from '../types';
import styles from './CashRegisterPage.module.css';

type ViewMode = 'current' | 'history' | 'detail';

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
    loading,
    fetchCurrentPeriod,
    fetchAllPeriods,
    fetchMovements,
    openPeriod,
    closePeriod,
    addMovement,
  } = useCashRegister();

  const [viewMode, setViewMode] = useState<ViewMode>('current');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Open period form state
  const [periodName, setPeriodName] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);

  // Movement form state
  const [movementType, setMovementType] = useState<'expense' | 'withdrawal' | 'deposit'>('expense');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementDescription, setMovementDescription] = useState('');
  const [movementError, setMovementError] = useState<string | null>(null);

  // Close period state
  const [closingCash, setClosingCash] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Detail view for historical periods
  const [selectedPeriod, setSelectedPeriod] = useState<CashRegisterPeriod | null>(null);
  const [selectedMovements, setSelectedMovements] = useState<CashMovement[]>([]);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchCurrentPeriod();
    fetchAllPeriods();
  }, [fetchCurrentPeriod, fetchAllPeriods]);

  // Load movements when we have a current period
  useEffect(() => {
    if (currentPeriod) {
      fetchMovements(currentPeriod.id);
    }
  }, [currentPeriod, fetchMovements]);

  // Set a default period name based on current month
  useEffect(() => {
    if (!currentPeriod && !periodName) {
      const now = new Date();
      const monthNames = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      setPeriodName(`${monthNames[now.getMonth()]} ${now.getFullYear()}`);
    }
  }, [currentPeriod, periodName]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

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

    try {
      setSubmitting(true);
      const today = new Date();
      const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

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

    if (isNaN(amount) || amount <= 0) {
      setMovementError('Ingrese un monto valido mayor a 0');
      return;
    }
    if (!currentPeriod) return;

    try {
      setSubmitting(true);
      await addMovement({
        cash_register_id: currentPeriod.id,
        type: movementType,
        amount,
        description: movementDescription.trim() || null,
      });
      setMovementAmount('');
      setMovementDescription('');
      showNotification('success', `${MOVEMENT_TYPE_LABELS[movementType]} registrado correctamente`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar movimiento';
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

    try {
      setSubmitting(true);
      setShowCloseConfirm(false);
      await closePeriod(currentPeriod.id, cash);
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
    try {
      const data = await window.electronAPI.cashRegister.getMovements(period.id);
      setSelectedMovements(data);
    } catch (err) {
      console.error('Error loading period movements:', err);
      setSelectedMovements([]);
    }
  }, []);

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
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles['table__empty']}>
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Close Period Panel */}
        <div className={styles['close-panel']}>
          <h3 className={styles['close-panel__title']}>Cerrar Periodo</h3>
          <div className={styles['close-panel__row']}>
            <span className={styles['close-panel__label']}>Efectivo inicial</span>
            <span className={styles['close-panel__value']}>{formatCurrency(currentPeriod.opening_cash)}</span>
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
              {selectedMovements.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles['table__empty']}>
                    No hubo movimientos de caja en este periodo
                  </td>
                </tr>
              ) : (
                selectedMovements.map(m => (
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
