import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, User, Phone, Mail, CalendarDays, FileText, Trash2 } from 'lucide-react';
import { useCustomers } from '../hooks/useCustomers';
import { useCredits } from '../hooks/useCredits';
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters';
import type { Credit, CreditPayment, CreditListItem, Customer, CustomerListItem, CustomersPaginatedQuery } from '../types';
import styles from './CustomersPage.module.css';

type ViewMode = 'list' | 'profile';
type CustomerFilter = 'all' | 'withDebt' | 'overdue' | 'withoutCredits';

const STATUS_LABELS: Record<Credit['status'], string> = {
  pending: 'Pendiente',
  overdue: 'Vencido',
  paid: 'Pagado',
};

const ROWS_PER_PAGE = 25;

interface CustomersPageProps {
  initialCustomerId?: number | null;
  onInitialCustomerHandled?: () => void;
  onViewCreditDetail?: (creditId: number) => void;
}

export function CustomersPage({ initialCustomerId, onInitialCustomerHandled, onViewCreditDetail }: CustomersPageProps) {
  const {
    loading: loadingCustomers,
    error: customersError,
    updateCustomer,
    deleteCustomer,
    fetchCustomersPaginated,
  } = useCustomers();
  const {
    loading: loadingCredits,
    error: creditsError,
    fetchCreditsByCustomerPaginated,
    getPayments,
  } = useCredits();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);

  // Paginated list state
  const [customerItems, setCustomerItems] = useState<CustomerListItem[]>([]);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Profile credits state
  const [profileCredits, setProfileCredits] = useState<CreditListItem[]>([]);
  const [profileCreditsTotal, setProfileCreditsTotal] = useState(0);
  const [profileCreditsPage, setProfileCreditsPage] = useState(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>('all');
  const [contactForm, setContactForm] = useState({ phone: '', email: '', notes: '' });
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactFeedback, setContactFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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

  // Load paginated customers
  const loadCustomers = useCallback(async () => {
    const query: CustomersPaginatedQuery = {
      page: currentPage,
      pageSize: ROWS_PER_PAGE,
      search: debouncedSearch || undefined,
      status: 'active',
      creditStatus: customerFilter,
    };

    const result = await fetchCustomersPaginated(query);
    if (result) {
      setCustomerItems(result.items);
      setTotalCustomers(result.total);
    }
  }, [currentPage, debouncedSearch, customerFilter, fetchCustomersPaginated]);

  useEffect(() => {
    if (viewMode === 'list') {
      void loadCustomers();
    }
  }, [loadCustomers, viewMode]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCustomers / ROWS_PER_PAGE)),
    [totalCustomers],
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  // Load credits for customer profile view
  const loadProfileCredits = useCallback(async (customerId: number, page: number) => {
    const result = await fetchCreditsByCustomerPaginated(customerId, {
      page,
      pageSize: ROWS_PER_PAGE,
    });
    if (result) {
      setProfileCredits(result.items);
      setProfileCreditsTotal(result.total);
    }
  }, [fetchCreditsByCustomerPaginated]);

  const profileTotalPages = useMemo(
    () => Math.max(1, Math.ceil(profileCreditsTotal / ROWS_PER_PAGE)),
    [profileCreditsTotal],
  );

  const openCustomerProfile = useCallback(async (customer: Customer | CustomerListItem) => {
    setSelectedCustomer(customer as Customer);
    setSelectedCredit(null);
    setCreditPayments([]);
    setContactForm({
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      notes: customer.notes ?? '',
    });
    setIsEditingContact(false);
    setContactFeedback(null);
    setProfileCreditsPage(1);
    setViewMode('profile');
    await loadProfileCredits(customer.id, 1);
  }, [loadProfileCredits]);

  useEffect(() => {
    if (!initialCustomerId || loadingCustomers || viewMode !== 'list') {
      return;
    }

    const targetCustomer = customerItems.find(customer => customer.id === initialCustomerId);

    if (!targetCustomer) {
      onInitialCustomerHandled?.();
      return;
    }

    void openCustomerProfile(targetCustomer).finally(() => {
      onInitialCustomerHandled?.();
    });
  }, [
    customerItems,
    initialCustomerId,
    loadingCustomers,
    onInitialCustomerHandled,
    openCustomerProfile,
    viewMode,
  ]);

  async function openCreditDetail(credit: Credit) {
    setSelectedCredit(credit);
    const payments = await getPayments(credit.id);
    setCreditPayments(payments);
  }

  async function backToList() {
    setViewMode('list');
    setSelectedCustomer(null);
    setSelectedCredit(null);
    setCreditPayments([]);
    setProfileCredits([]);
    setProfileCreditsTotal(0);
    setProfileCreditsPage(1);
    setIsEditingContact(false);
    setContactFeedback(null);
    await loadCustomers();
  }

  function startEditingContact() {
    if (!selectedCustomer) return;

    setContactForm({
      phone: selectedCustomer.phone ?? '',
      email: selectedCustomer.email ?? '',
      notes: selectedCustomer.notes ?? '',
    });
    setIsEditingContact(true);
    setContactFeedback(null);
  }

  function cancelEditingContact() {
    if (!selectedCustomer) return;

    setContactForm({
      phone: selectedCustomer.phone ?? '',
      email: selectedCustomer.email ?? '',
      notes: selectedCustomer.notes ?? '',
    });
    setIsEditingContact(false);
    setContactFeedback(null);
  }

  async function handleSaveContact(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedCustomer) return;

    const phone = contactForm.phone.trim();
    const email = contactForm.email.trim();
    const notes = contactForm.notes.trim();

    setSavingContact(true);
    setContactFeedback(null);

    try {
      const updated = await updateCustomer(selectedCustomer.id, {
        phone: phone || null,
        email: email || null,
        notes: notes || null,
      });

      setSelectedCustomer(updated);
      setContactForm({
        phone: updated.phone ?? '',
        email: updated.email ?? '',
        notes: updated.notes ?? '',
      });
      setIsEditingContact(false);
      setContactFeedback({ type: 'success', message: 'Datos de contacto actualizados correctamente' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el cliente';
      setContactFeedback({ type: 'error', message });
    } finally {
      setSavingContact(false);
    }
  }

  async function handleDeleteCustomer() {
    if (!selectedCustomer) return;

    if (!confirm(`¿Está seguro de eliminar el cliente "${selectedCustomer.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await deleteCustomer(selectedCustomer.id);
      await backToList();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el cliente';
      setContactFeedback({ type: 'error', message });
    }
  }

  function getProgressPercent(credit: Credit): number {
    if (credit.total_due <= 0) return 100;
    return Math.min(100, Math.round((credit.amount_paid / credit.total_due) * 100));
  }

  function getProgressClass(percent: number): string {
    if (percent >= 100) return styles['progress__fill--complete'];
    if (percent >= 60) return styles['progress__fill--high'];
    if (percent >= 30) return styles['progress__fill--mid'];
    return styles['progress__fill--low'];
  }

  if (viewMode === 'profile' && selectedCustomer) {
    // Use stats from CustomerListItem if available, otherwise compute from loaded credits
    const selectedAsListItem = customerItems.find(c => c.id === selectedCustomer.id);
    const totalDebt = selectedAsListItem?.total_debt
      ?? profileCredits.filter(c => c.status !== 'paid').reduce((sum, c) => sum + (c.total_due - c.amount_paid), 0);
    const totalPaid = selectedAsListItem?.total_paid
      ?? profileCredits.reduce((sum, c) => sum + c.amount_paid, 0);
    const activeCount = selectedAsListItem?.active_credits
      ?? profileCredits.filter(c => c.status !== 'paid').length;
    const overdueCount = selectedAsListItem?.overdue_credits
      ?? profileCredits.filter(c => c.status === 'overdue').length;
    const totalFinanced = profileCredits.reduce((sum, c) => sum + c.total_due, 0);
    const totalCreditsCount = selectedAsListItem?.total_credits ?? profileCreditsTotal;

    return (
      <div className={styles.page}>
        <div className={styles['page__header']}>
          <button className={styles['btn-back']} onClick={backToList}>
            <ArrowLeft size={16} strokeWidth={1.5} />
            Volver a clientes
          </button>
          <h1 className={styles['page__title']}>Perfil del cliente</h1>
        </div>

        <section className={styles.profile}>
          <div className={styles['profile__card']}>
            <h2 className={styles['profile__title']}>
              <User size={18} strokeWidth={1.5} />
              {selectedCustomer.name}
            </h2>

            <div className={styles['profile__meta']}>
              <span className={styles['profile__meta-item']}>
                <Phone size={14} strokeWidth={1.5} />
                {selectedCustomer.phone ?? 'Sin telefono'}
              </span>
              <span className={styles['profile__meta-item']}>
                <Mail size={14} strokeWidth={1.5} />
                {selectedCustomer.email ?? 'Sin correo'}
              </span>
              <span className={styles['profile__meta-item']}>
                <CalendarDays size={14} strokeWidth={1.5} />
                Registrado: {formatDate(selectedCustomer.created_at)}
              </span>
            </div>

            <div className={styles['profile__notes']}>
              <div className={styles['profile__notes-title']}>
                <FileText size={14} strokeWidth={1.5} />
                Notas
              </div>
              <p>{selectedCustomer.notes?.trim() ? selectedCustomer.notes : 'Sin notas registradas'}</p>
            </div>

            <section className={styles['contact-form']}>
              <div className={styles['contact-form__header']}>
                <h3 className={styles['contact-form__title']}>Datos de contacto</h3>
                {!isEditingContact && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className={styles['btn-secondary']} onClick={startEditingContact}>
                      Editar datos
                    </button>
                    <button type="button" className={styles['btn-danger']} onClick={handleDeleteCustomer}>
                      <Trash2 size={16} />
                      Eliminar cliente
                    </button>
                  </div>
                )}
              </div>

              {isEditingContact ? (
                <form className={styles['contact-form__editor']} onSubmit={handleSaveContact}>
                  <div className={styles['contact-form__field']}>
                    <label className={styles['contact-form__label']} htmlFor="customer-phone">Telefono</label>
                    <input
                      id="customer-phone"
                      className={styles['contact-form__input']}
                      type="text"
                      value={contactForm.phone}
                      onChange={(event) => setContactForm(prev => ({ ...prev, phone: event.target.value }))}
                      placeholder="Telefono del cliente"
                    />
                  </div>

                  <div className={styles['contact-form__field']}>
                    <label className={styles['contact-form__label']} htmlFor="customer-email">Correo</label>
                    <input
                      id="customer-email"
                      className={styles['contact-form__input']}
                      type="email"
                      value={contactForm.email}
                      onChange={(event) => setContactForm(prev => ({ ...prev, email: event.target.value }))}
                      placeholder="Correo del cliente"
                    />
                  </div>

                  <div className={styles['contact-form__field']}>
                    <label className={styles['contact-form__label']} htmlFor="customer-notes">Notas</label>
                    <textarea
                      id="customer-notes"
                      className={styles['contact-form__textarea']}
                      value={contactForm.notes}
                      onChange={(event) => setContactForm(prev => ({ ...prev, notes: event.target.value }))}
                      placeholder="Notas sobre el cliente"
                      rows={3}
                    />
                  </div>

                  {contactFeedback && (
                    <p className={contactFeedback.type === 'success' ? styles['contact-form__feedback--success'] : styles['contact-form__feedback--error']}>
                      {contactFeedback.message}
                    </p>
                  )}

                  <div className={styles['contact-form__actions']}>
                    <button type="button" className={styles['btn-secondary']} onClick={cancelEditingContact} disabled={savingContact}>
                      Cancelar
                    </button>
                    <button type="submit" className={styles['btn-primary']} disabled={savingContact}>
                      {savingContact ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles['contact-form__summary']}>
                  <div className={styles['contact-form__row']}>
                    <span className={styles['contact-form__row-label']}>Telefono</span>
                    <span className={styles['contact-form__row-value']}>{selectedCustomer.phone ?? 'Sin telefono'}</span>
                  </div>
                  <div className={styles['contact-form__row']}>
                    <span className={styles['contact-form__row-label']}>Correo</span>
                    <span className={styles['contact-form__row-value']}>{selectedCustomer.email ?? 'Sin correo'}</span>
                  </div>
                  <div className={styles['contact-form__row']}>
                    <span className={styles['contact-form__row-label']}>Notas</span>
                    <span className={styles['contact-form__row-value']}>{selectedCustomer.notes?.trim() ? selectedCustomer.notes : 'Sin notas registradas'}</span>
                  </div>
                </div>
              )}

              {!isEditingContact && contactFeedback && (
                <p className={contactFeedback.type === 'success' ? styles['contact-form__feedback--success'] : styles['contact-form__feedback--error']}>
                  {contactFeedback.message}
                </p>
              )}
            </section>
          </div>

          <div className={styles['summary-grid']}>
            <div className={styles['summary-card']}>
              <span className={styles['summary-card__label']}>Deuda actual</span>
              <span className={`${styles['summary-card__value']} ${totalDebt > 0 ? styles['summary-card__value--error'] : styles['summary-card__value--success']}`}>
                {formatCurrency(totalDebt)}
              </span>
            </div>
            <div className={styles['summary-card']}>
              <span className={styles['summary-card__label']}>Total abonado</span>
              <span className={`${styles['summary-card__value']} ${styles['summary-card__value--success']}`}>
                {formatCurrency(totalPaid)}
              </span>
            </div>
            <div className={styles['summary-card']}>
              <span className={styles['summary-card__label']}>Total financiado</span>
              <span className={styles['summary-card__value']}>
                {formatCurrency(totalFinanced)}
              </span>
            </div>
            <div className={styles['summary-card']}>
              <span className={styles['summary-card__label']}>Creditos activos</span>
              <span className={styles['summary-card__value']}>{activeCount}</span>
            </div>
            <div className={styles['summary-card']}>
              <span className={styles['summary-card__label']}>Creditos vencidos</span>
              <span className={`${styles['summary-card__value']} ${overdueCount > 0 ? styles['summary-card__value--error'] : ''}`}>
                {overdueCount}
              </span>
            </div>
            <div className={styles['summary-card']}>
              <span className={styles['summary-card__label']}>Historial de creditos</span>
              <span className={styles['summary-card__value']}>{totalCreditsCount}</span>
            </div>
          </div>
        </section>

        <section className={styles['table-card']}>
          <div className={styles['table-card__title']}>Historial de creditos</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Venta</th>
                <th>Fecha</th>
                <th>Vencimiento</th>
                <th>Total</th>
                <th>Pagado</th>
                <th>Saldo</th>
                <th>Progreso</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loadingCredits ? (
                <tr><td colSpan={10} className={styles['table__empty']}>Cargando creditos...</td></tr>
              ) : profileCredits.length === 0 ? (
                <tr><td colSpan={10} className={styles['table__empty']}>Este cliente no tiene creditos</td></tr>
              ) : (
                profileCredits.map(credit => {
                  const remaining = credit.total_due - credit.amount_paid;
                  const percent = getProgressPercent(credit);

                  return (
                    <tr
                      key={credit.id}
                      className={styles['table__row--clickable']}
                      onClick={() => {
                        if (onViewCreditDetail) {
                          onViewCreditDetail(credit.id);
                          return;
                        }
                        void openCreditDetail(credit);
                      }}
                    >
                      <td>{credit.id}</td>
                      <td>{credit.sale_id}</td>
                      <td>{formatDate(credit.created_at)}</td>
                      <td>{formatDate(credit.due_date)}</td>
                      <td>{formatCurrency(credit.total_due)}</td>
                      <td className={styles['text--success']}>{formatCurrency(credit.amount_paid)}</td>
                      <td className={remaining > 0 ? styles['text--error'] : styles['text--success']}>
                        {formatCurrency(remaining)}
                      </td>
                      <td>
                        <div className={styles.progress}>
                          <div className={`${styles['progress__fill']} ${getProgressClass(percent)}`} style={{ width: `${percent}%` }} />
                        </div>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles[`badge--${credit.status}`]}`}>
                          {STATUS_LABELS[credit.status]}
                        </span>
                      </td>
                      <td>
                        <button
                          className={styles['btn-secondary']}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (onViewCreditDetail) {
                              onViewCreditDetail(credit.id);
                              return;
                            }
                            void openCreditDetail(credit);
                          }}
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {profileCreditsTotal > ROWS_PER_PAGE && (
            <div className={styles.pagination}>
              <span className={styles['pagination__meta']}>
                {profileCreditsTotal} creditos en total
              </span>
              <div className={styles['pagination__actions']}>
                <button
                  className={styles['btn-secondary']}
                  disabled={profileCreditsPage <= 1}
                  onClick={() => {
                    const newPage = profileCreditsPage - 1;
                    setProfileCreditsPage(newPage);
                    void loadProfileCredits(selectedCustomer.id, newPage);
                  }}
                >
                  Anterior
                </button>
                <span className={styles['pagination__page']}>
                  Pagina {profileCreditsPage} de {profileTotalPages}
                </span>
                <button
                  className={styles['btn-secondary']}
                  disabled={profileCreditsPage >= profileTotalPages}
                  onClick={() => {
                    const newPage = profileCreditsPage + 1;
                    setProfileCreditsPage(newPage);
                    void loadProfileCredits(selectedCustomer.id, newPage);
                  }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </section>

        {selectedCredit && (
          <section className={styles['detail-card']}>
            <h3 className={styles['detail-card__title']}>Credito #{selectedCredit.id} - Historial de abonos</h3>
            <div className={styles['detail-card__meta']}>
              <span>Creado: {formatDateTime(selectedCredit.created_at)}</span>
              <span>Vence: {formatDate(selectedCredit.due_date)}</span>
              <span>Total: {formatCurrency(selectedCredit.total_due)}</span>
              <span>Pagado: {formatCurrency(selectedCredit.amount_paid)}</span>
              <span>Saldo: {formatCurrency(selectedCredit.total_due - selectedCredit.amount_paid)}</span>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {creditPayments.length === 0 ? (
                  <tr><td colSpan={2} className={styles['table__empty']}>Sin abonos registrados</td></tr>
                ) : (
                  creditPayments.map(payment => (
                    <tr key={payment.id}>
                      <td>{formatDateTime(payment.created_at)}</td>
                      <td className={styles['text--success']}>+{formatCurrency(payment.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Clientes</h1>
      </div>

      {(customersError || creditsError) && (
        <p className={styles['error-message']}>
          {customersError ?? creditsError}
        </p>
      )}

      <div className={styles.toolbar}>
        <div className={styles['search-box']}>
          <Search size={14} strokeWidth={1.5} className={styles['search-box__icon']} />
          <input
            className={styles['search-box__input']}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar por nombre, telefono o correo"
          />
        </div>

        <select
          className={styles['toolbar__filter']}
          value={customerFilter}
          onChange={(event) => {
            setCustomerFilter(event.target.value as CustomerFilter);
            setCurrentPage(1);
          }}
        >
          <option value="all">Todos</option>
          <option value="withDebt">Con deuda activa</option>
          <option value="overdue">Con creditos vencidos</option>
          <option value="withoutCredits">Sin creditos</option>
        </select>
      </div>

      <div className={styles['table-card']}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Contacto</th>
              <th>Creditos historicos</th>
              <th>Creditos activos</th>
              <th>Deuda actual</th>
              <th>Ultimo credito</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loadingCustomers ? (
              <tr><td colSpan={7} className={styles['table__empty']}>Cargando clientes...</td></tr>
            ) : customerItems.length === 0 ? (
              <tr><td colSpan={7} className={styles['table__empty']}>No hay clientes para mostrar</td></tr>
            ) : (
              customerItems.map((customer) => {
                return (
                  <tr key={customer.id} className={styles['table__row--clickable']} onClick={() => openCustomerProfile(customer)}>
                    <td>
                      <div className={styles['customer-cell']}>
                        <span className={styles['customer-cell__name']}>{customer.name}</span>
                        {customer.overdue_credits > 0 && (
                          <span className={`${styles.badge} ${styles['badge--overdue']}`}>
                            {customer.overdue_credits} vencido(s)
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={styles['contact-cell']}>
                        <span>{customer.phone ?? 'Sin telefono'}</span>
                        <span>{customer.email ?? 'Sin correo'}</span>
                      </div>
                    </td>
                    <td>{customer.total_credits}</td>
                    <td>{customer.active_credits}</td>
                    <td className={customer.total_debt > 0 ? styles['text--error'] : styles['text--success']}>
                      {formatCurrency(customer.total_debt)}
                    </td>
                    <td>{customer.last_credit_date ? formatDate(customer.last_credit_date) : 'Sin creditos'}</td>
                    <td>
                      <button
                        className={styles['btn-secondary']}
                        onClick={(event) => {
                          event.stopPropagation();
                          openCustomerProfile(customer);
                        }}
                      >
                        Ver perfil
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {totalCustomers > ROWS_PER_PAGE && (
          <div className={styles.pagination}>
            <span className={styles['pagination__meta']}>
              {totalCustomers} clientes en total
            </span>
            <div className={styles['pagination__actions']}>
              <button
                className={styles['btn-secondary']}
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => p - 1)}
              >
                Anterior
              </button>
              <span className={styles['pagination__page']}>
                Pagina {currentPage} de {totalPages}
              </span>
              <button
                className={styles['btn-secondary']}
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
