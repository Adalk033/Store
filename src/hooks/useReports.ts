import { useState, useCallback } from 'react';
import type {
  DailySalesRow,
  TopProductRow,
  ProfitRow,
  InventoryValueRow,
  InventorySummary,
  CreditsOverviewRow,
} from '../../electron/database/repositories/reports';

export function useReports() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSalesByDate = useCallback(async (startDate: string, endDate: string): Promise<DailySalesRow[]> => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.reports.salesByDate(startDate, endDate);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar reporte de ventas';
      setError(message);
      console.error('useReports.getSalesByDate:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getTopProducts = useCallback(async (startDate: string, endDate: string, limit?: number): Promise<TopProductRow[]> => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.reports.topProducts(startDate, endDate, limit);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar productos mas vendidos';
      setError(message);
      console.error('useReports.getTopProducts:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getProfitReport = useCallback(async (startDate: string, endDate: string): Promise<ProfitRow[]> => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.reports.profit(startDate, endDate);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar reporte de utilidades';
      setError(message);
      console.error('useReports.getProfitReport:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getInventoryReport = useCallback(async (): Promise<InventoryValueRow[]> => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.reports.inventory();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar reporte de inventario';
      setError(message);
      console.error('useReports.getInventoryReport:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getInventorySummary = useCallback(async (): Promise<InventorySummary> => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.reports.inventorySummary();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar resumen de inventario';
      setError(message);
      console.error('useReports.getInventorySummary:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getCreditsOverview = useCallback(async (): Promise<CreditsOverviewRow[]> => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.reports.creditsOverview();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar resumen de creditos';
      setError(message);
      console.error('useReports.getCreditsOverview:', err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    getSalesByDate,
    getTopProducts,
    getProfitReport,
    getInventoryReport,
    getInventorySummary,
    getCreditsOverview,
  };
}
