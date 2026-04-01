import { useState, useCallback } from 'react';
import type { Sale, SaleDetail, SaleListItem, PaginatedQuery, PaginatedResponse } from '../types';

export interface CartItem {
  product_id: number;
  name: string;
  barcode: string;
  unit_price: number;
  quantity: number;
  stock: number;
}

export interface SalesSummary {
  totalSales: number;
  totalRevenue: number;
  cashRevenue: number;
  creditRevenue: number;
}

export function useSales() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSale = useCallback(async (data: {
    sale_type: 'cash' | 'credit';
    customer_id?: number | null;
    sale_date?: string;
    items: Array<{ product_id: number; quantity: number; unit_price: number }>;
    cash_register_id?: number | null;
    credit_days?: number;
    surcharge_percent?: number;
    initial_payment?: number;
    cash_received?: number;
    cash_change?: number;
  }): Promise<Sale> => {
    try {
      setLoading(true);
      setError(null);
      const sale = await window.electronAPI.sales.create(data);
      return sale;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar venta';
      setError(message);
      console.error('useSales.createSale:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getSaleById = useCallback(async (id: number): Promise<Sale | undefined> => {
    try {
      return await window.electronAPI.sales.getById(id);
    } catch (err) {
      console.error('useSales.getSaleById:', err);
      return undefined;
    }
  }, []);

  const getAllSales = useCallback(async (limit = 100, offset = 0): Promise<SaleListItem[]> => {
    try {
      return await window.electronAPI.sales.getAll(limit, offset);
    } catch (err) {
      console.error('useSales.getAllSales:', err);
      return [];
    }
  }, []);

  const getAllSalesPaginated = useCallback(async (
    query: PaginatedQuery
  ): Promise<PaginatedResponse<SaleListItem>> => {
    try {
      setLoading(true);
      setError(null);
      return await window.electronAPI.sales.getAllPaginated(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar ventas';
      setError(message);
      console.error('useSales.getAllSalesPaginated:', err);
      return { items: [], page: 1, pageSize: query.pageSize, total: 0, hasMore: false, sort: { field: 'created_at', direction: 'DESC' } };
    } finally {
      setLoading(false);
    }
  }, []);

  const getSaleDetailById = useCallback(async (id: number): Promise<SaleDetail | undefined> => {
    try {
      return await window.electronAPI.sales.getDetail(id);
    } catch (err) {
      console.error('useSales.getSaleDetailById:', err);
      return undefined;
    }
  }, []);

  return {
    loading,
    error,
    createSale,
    getSaleById,
    getAllSales,
    getAllSalesPaginated,
    getSaleDetailById,
  };
}
