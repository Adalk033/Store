import { useState, useEffect, useCallback } from 'react';
import type { Customer } from '../types';

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.customers.getAll();
      setCustomers(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar clientes';
      setError(message);
      console.error('useCustomers.fetchCustomers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const createCustomer = useCallback(async (data: {
    name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  }) => {
    try {
      const created = await window.electronAPI.customers.create(data);
      setCustomers(prev => [...prev, created]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al crear cliente';
      console.error('useCustomers.createCustomer:', err);
      throw new Error(message);
    }
  }, []);

  return {
    customers,
    loading,
    error,
    fetchCustomers,
    createCustomer,
  };
}
