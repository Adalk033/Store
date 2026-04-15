import { useState, useEffect, useCallback } from 'react';
import type { Customer, CustomerListItem, CustomersPaginatedQuery, PaginatedResponse } from '../types';

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

  const updateCustomer = useCallback(async (
    id: number,
    data: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      is_active?: number;
    },
  ) => {
    try {
      const updated = await window.electronAPI.customers.update(id, data);
      if (!updated) {
        throw new Error('No se pudo actualizar el cliente');
      }

      setCustomers(prev => prev.map(customer => (customer.id === id ? updated : customer)));
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar cliente';
      console.error('useCustomers.updateCustomer:', err);
      throw new Error(message);
    }
  }, []);

  const deleteCustomer = useCallback(async (id: number): Promise<void> => {
    try {
      const success = await window.electronAPI.customers.delete(id);
      if (success) {
        setCustomers(prev => prev.filter(customer => customer.id !== id));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar cliente';
      console.error('useCustomers.deleteCustomer:', err);
      throw new Error(message);
    }
  }, []);

  // --- Paginated methods (Phase 3) ---

  const fetchCustomersPaginated = useCallback(async (
    query: CustomersPaginatedQuery
  ): Promise<PaginatedResponse<CustomerListItem> | null> => {
    try {
      setLoading(true);
      setError(null);
      return await window.electronAPI.customers.getAllPaginated(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar clientes';
      setError(message);
      console.error('useCustomers.fetchCustomersPaginated:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    customers,
    loading,
    error,
    fetchCustomers,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    fetchCustomersPaginated,
  };
}
