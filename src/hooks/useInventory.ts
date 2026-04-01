import { useState, useCallback } from 'react';
import type { InventoryMovement, InventoryMovementListItem, PaginatedQuery, PaginatedResponse } from '../types';

export function useInventory() {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMovements = useCallback(async (limit = 100, offset = 0) => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.inventory.getAll(limit, offset);
      setMovements(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar movimientos';
      setError(message);
      console.error('useInventory.fetchMovements:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchByProduct = useCallback(async (productId: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.inventory.getByProduct(productId);
      setMovements(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar movimientos del producto';
      setError(message);
      console.error('useInventory.fetchByProduct:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMovementsPaginated = useCallback(async (
    query: PaginatedQuery
  ): Promise<PaginatedResponse<InventoryMovementListItem>> => {
    try {
      setLoading(true);
      setError(null);
      return await window.electronAPI.inventory.getAllPaginated(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar movimientos';
      setError(message);
      console.error('useInventory.fetchMovementsPaginated:', err);
      return { items: [], page: 1, pageSize: query.pageSize, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' } };
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchByProductPaginated = useCallback(async (
    productId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<InventoryMovementListItem>> => {
    try {
      setLoading(true);
      setError(null);
      return await window.electronAPI.inventory.getByProductPaginated(productId, query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar movimientos del producto';
      setError(message);
      console.error('useInventory.fetchByProductPaginated:', err);
      return { items: [], page: 1, pageSize: query.pageSize, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' } };
    } finally {
      setLoading(false);
    }
  }, []);

  const addMovement = useCallback(async (data: {
    product_id: number;
    type: 'in' | 'out' | 'adjustment';
    quantity: number;
    reference_id?: number | null;
    notes?: string | null;
    cost_price?: number;
    margin_percent?: number;
  }) => {
    try {
      const created = await window.electronAPI.inventory.addMovement(data);
      setMovements(prev => [created, ...prev]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar movimiento';
      console.error('useInventory.addMovement:', err);
      throw new Error(message);
    }
  }, []);

  return {
    movements,
    loading,
    error,
    fetchMovements,
    fetchByProduct,
    fetchMovementsPaginated,
    fetchByProductPaginated,
    addMovement,
  };
}
