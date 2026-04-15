import { useState, useCallback } from 'react';
import type { Credit, CreditPayment, CreditListItem, CreditsSummary, PaginatedQuery, PaginatedResponse } from '../types';

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

  const addPayment = useCallback(async (creditId: number, amount: number, paymentDate?: string): Promise<Credit> => {
    try {
      const normalizedCreditId = Number(creditId);
      const normalizedAmount = Number(amount);

      if (!Number.isInteger(normalizedCreditId) || normalizedCreditId < 1) {
        throw new Error('ID de credito invalido');
      }

      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error('Monto de abono invalido');
      }

      const updated = await window.electronAPI.credits.addPayment(normalizedCreditId, normalizedAmount, paymentDate);
      setCredits(prev => prev.map(c => c.id === normalizedCreditId ? updated : c));
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

  // --- Paginated methods (Phase 3) ---

  const fetchCreditsPaginated = useCallback(async (
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CreditListItem> | null> => {
    try {
      setLoading(true);
      setError(null);
      return await window.electronAPI.credits.getAllPaginated(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar creditos';
      setError(message);
      console.error('useCredits.fetchCreditsPaginated:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCreditsByCustomerPaginated = useCallback(async (
    customerId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CreditListItem> | null> => {
    try {
      const normalizedCustomerId = Number(customerId);
      if (!Number.isInteger(normalizedCustomerId) || normalizedCustomerId < 1) {
        console.warn('useCredits.fetchCreditsByCustomerPaginated: invalid customerId', customerId);
        return null;
      }

      setLoading(true);
      setError(null);
      return await window.electronAPI.credits.getByCustomerPaginated(normalizedCustomerId, query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar creditos del cliente';
      setError(message);
      console.error('useCredits.fetchCreditsByCustomerPaginated:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPaymentsPaginated = useCallback(async (
    creditId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CreditPayment> | null> => {
    try {
      return await window.electronAPI.credits.getPaymentsPaginated(creditId, query);
    } catch (err) {
      console.error('useCredits.fetchPaymentsPaginated:', err);
      return null;
    }
  }, []);

  const fetchSummary = useCallback(async (query: {
    search?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<CreditsSummary | null> => {
    try {
      return await window.electronAPI.credits.getSummary(query);
    } catch (err) {
      console.error('useCredits.fetchSummary:', err);
      return null;
    }
  }, []);

  const deleteCredit = useCallback(async (creditId: number): Promise<boolean> => {
    try {
      setLoading(true);
      const result = await window.electronAPI.credits.delete(creditId);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar credito';
      console.error('useCredits.deleteCredit:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateCredit = useCallback(async (
    creditId: number,
    data: { due_date?: string; surcharge_percent?: number }
  ): Promise<Credit> => {
    try {
      setLoading(true);
      const updated = await window.electronAPI.credits.update(creditId, data);
      setCredits(prev => prev.map(c => c.id === creditId ? updated : c));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar credito';
      console.error('useCredits.updateCredit:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
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
    fetchCreditsPaginated,
    fetchCreditsByCustomerPaginated,
    fetchPaymentsPaginated,
    fetchSummary,
    deleteCredit,
    updateCredit,
  };
}
