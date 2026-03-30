import { useState, useCallback } from 'react';
import type { Credit, CreditPayment } from '../types';

export function useCredits() {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async (status?: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.credits.getAll(status);
      setCredits(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar creditos';
      setError(message);
      console.error('useCredits.fetchCredits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCreditsByCustomer = useCallback(async (customerId: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.credits.getByCustomer(customerId);
      setCredits(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar creditos del cliente';
      setError(message);
      console.error('useCredits.fetchCreditsByCustomer:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getCreditById = useCallback(async (id: number): Promise<Credit | undefined> => {
    try {
      return await window.electronAPI.credits.getById(id);
    } catch (err) {
      console.error('useCredits.getCreditById:', err);
      return undefined;
    }
  }, []);

  const addPayment = useCallback(async (creditId: number, amount: number): Promise<Credit> => {
    try {
      const updated = await window.electronAPI.credits.addPayment(creditId, amount);
      setCredits(prev => prev.map(c => c.id === creditId ? updated : c));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar abono';
      console.error('useCredits.addPayment:', err);
      throw new Error(message);
    }
  }, []);

  const getPayments = useCallback(async (creditId: number): Promise<CreditPayment[]> => {
    try {
      return await window.electronAPI.credits.getPayments(creditId);
    } catch (err) {
      console.error('useCredits.getPayments:', err);
      return [];
    }
  }, []);

  const checkOverdue = useCallback(async (): Promise<number> => {
    try {
      const count = await window.electronAPI.credits.checkOverdue();
      return count;
    } catch (err) {
      console.error('useCredits.checkOverdue:', err);
      return 0;
    }
  }, []);

  return {
    credits,
    loading,
    error,
    fetchCredits,
    fetchCreditsByCustomer,
    getCreditById,
    addPayment,
    getPayments,
    checkOverdue,
  };
}
