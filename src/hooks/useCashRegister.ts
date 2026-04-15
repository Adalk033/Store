import { useState, useCallback } from 'react';
import type { CashRegisterPeriod, CashMovement, CreditPaymentListItem, SaleListItem, PaginatedQuery, PaginatedResponse } from '../types';
import type { CashRegisterSalesSummary } from '../../electron/database/repositories/cashRegister';
export function useCashRegister() {
  const [currentPeriod, setCurrentPeriod] = useState<CashRegisterPeriod | null>(null);
  const [periods, setPeriods] = useState<CashRegisterPeriod[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [sales, setSales] = useState<SaleListItem[]>([]);
  const [creditPayments, setCreditPayments] = useState<CreditPaymentListItem[]>([]);
  const [salesSummary, setSalesSummary] = useState<CashRegisterSalesSummary>({
    sale_count: 0,
    total_cash_sales: 0,
    total_credit_sales: 0,
    total_credit_collected: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCurrentPeriod = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.cashRegister.getCurrent();
      setCurrentPeriod(data ?? null);
      return data ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al obtener periodo actual';
      setError(message);
      console.error('useCashRegister.fetchCurrentPeriod:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllPeriods = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.cashRegister.getAll();
      setPeriods(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar periodos';
      setError(message);
      console.error('useCashRegister.fetchAllPeriods:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMovements = useCallback(async (cashRegisterId: number) => {
    try {
      const data = await window.electronAPI.cashRegister.getMovements(cashRegisterId);
      setMovements(data);
    } catch (err) {
      console.error('useCashRegister.fetchMovements:', err);
      setMovements([]);
    }
  }, []);

  const fetchSalesSummary = useCallback(async (cashRegisterId: number) => {
    try {
      const data = await window.electronAPI.cashRegister.getSalesSummary(cashRegisterId);
      setSalesSummary(data);
      return data;
    } catch (err) {
      console.error('useCashRegister.fetchSalesSummary:', err);
      const empty = { sale_count: 0, total_cash_sales: 0, total_credit_sales: 0, total_credit_collected: 0 };
      setSalesSummary(empty);
      return empty;
    }
  }, []);

  const fetchSales = useCallback(async (cashRegisterId: number, limit = 50, offset = 0) => {
    try {
      const data = await window.electronAPI.cashRegister.getSales(cashRegisterId, limit, offset);
      setSales(data);
      return data as SaleListItem[];
    } catch (err) {
      console.error('useCashRegister.fetchSales:', err);
      setSales([]);
      return [] as SaleListItem[];
    }
  }, []);

  const fetchCreditPayments = useCallback(async (cashRegisterId: number, limit = 50, offset = 0) => {
    try {
      const data = await window.electronAPI.cashRegister.getCreditPayments(cashRegisterId, limit, offset);
      setCreditPayments(data);
      return data as CreditPaymentListItem[];
    } catch (err) {
      console.error('useCashRegister.fetchCreditPayments:', err);
      setCreditPayments([]);
      return [] as CreditPaymentListItem[];
    }
  }, []);

  const openPeriod = useCallback(async (data: {
    period_name: string;
    start_date: string;
    opening_cash: number;
  }): Promise<CashRegisterPeriod> => {
    try {
      const period = await window.electronAPI.cashRegister.open(data);
      setCurrentPeriod(period);
      return period;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al abrir periodo';
      console.error('useCashRegister.openPeriod:', err);
      throw new Error(message);
    }
  }, []);

  const closePeriod = useCallback(async (id: number, closingCash: number, endDate: string): Promise<CashRegisterPeriod> => {
    try {
      const period = await window.electronAPI.cashRegister.close(id, closingCash, endDate);
      setCurrentPeriod(null);
      setMovements([]);
      setSales([]);
      setCreditPayments([]);
      return period;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cerrar periodo';
      console.error('useCashRegister.closePeriod:', err);
      throw new Error(message);
    }
  }, []);

  const addMovement = useCallback(async (data: {
    cash_register_id: number;
    type: 'expense' | 'withdrawal' | 'deposit';
    amount: number;
    description?: string | null;
    movement_date?: string;
  }): Promise<CashMovement> => {
    try {
      const movement = await window.electronAPI.cashRegister.addMovement(data);
      setMovements(prev => [movement, ...prev]);
      return movement;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar movimiento';
      console.error('useCashRegister.addMovement:', err);
      throw new Error(message);
    }
  }, []);

  const updateMovement = useCallback(async (id: number, data: {
    type?: 'expense' | 'withdrawal' | 'deposit';
    amount?: number;
    description?: string | null;
  }): Promise<CashMovement> => {
    try {
      const movement = await window.electronAPI.cashRegister.updateMovement(id, data);
      setMovements(prev => prev.map(m => m.id === id ? movement : m));
      return movement;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar movimiento';
      console.error('useCashRegister.updateMovement:', err);
      throw new Error(message);
    }
  }, []);

  const deleteMovement = useCallback(async (id: number): Promise<void> => {
    try {
      const success = await window.electronAPI.cashRegister.deleteMovement(id);
      if (success) {
        setMovements(prev => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar movimiento';
      console.error('useCashRegister.deleteMovement:', err);
      throw new Error(message);
    }
  }, []);

  const fetchSalesPaginated = useCallback(async (
    cashRegisterId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<SaleListItem>> => {
    try {
      const data = await window.electronAPI.cashRegister.getSalesPaginated(cashRegisterId, query);
      return data as PaginatedResponse<SaleListItem>;
    } catch (err) {
      console.error('useCashRegister.fetchSalesPaginated:', err);
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' } };
    }
  }, []);

  const fetchCreditPaymentsPaginated = useCallback(async (
    cashRegisterId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CreditPaymentListItem>> => {
    try {
      const data = await window.electronAPI.cashRegister.getCreditPaymentsPaginated(cashRegisterId, query);
      return data as PaginatedResponse<CreditPaymentListItem>;
    } catch (err) {
      console.error('useCashRegister.fetchCreditPaymentsPaginated:', err);
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' } };
    }
  }, []);

  const fetchMovementsPaginated = useCallback(async (
    cashRegisterId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CashMovement>> => {
    try {
      const data = await window.electronAPI.cashRegister.getMovementsPaginated(cashRegisterId, query);
      return data as PaginatedResponse<CashMovement>;
    } catch (err) {
      console.error('useCashRegister.fetchMovementsPaginated:', err);
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' } };
    }
  }, []);

  return {
    currentPeriod,
    periods,
    movements,
    sales,
    creditPayments,
    salesSummary,
    loading,
    error,
    fetchCurrentPeriod,
    fetchAllPeriods,
    fetchMovements,
    fetchSales,
    fetchCreditPayments,
    fetchSalesSummary,
    fetchSalesPaginated,
    fetchCreditPaymentsPaginated,
    fetchMovementsPaginated,
    openPeriod,
    closePeriod,
    addMovement,
    updateMovement,
    deleteMovement,
  };
}
