import { useState, useCallback } from 'react';
import type { CashRegisterPeriod, CashMovement } from '../types';

export function useCashRegister() {
  const [currentPeriod, setCurrentPeriod] = useState<CashRegisterPeriod | null>(null);
  const [periods, setPeriods] = useState<CashRegisterPeriod[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
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

  return {
    currentPeriod,
    periods,
    movements,
    loading,
    error,
    fetchCurrentPeriod,
    fetchAllPeriods,
    fetchMovements,
    openPeriod,
    closePeriod,
    addMovement,
  };
}
