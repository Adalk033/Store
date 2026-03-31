import { useState, useEffect, useCallback } from 'react';
import type { Product } from '../types';

function getCreateProductErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      message.includes('unique constraint failed: products.barcode') ||
      message.includes('products.barcode')
    ) {
      return 'El codigo de barras ya existe. Genera uno nuevo por seguridad.';
    }

    return err.message;
  }

  return 'Error al crear producto';
}

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.products.getAll();
      setProducts(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar productos';
      setError(message);
      console.error('useProducts.fetchProducts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const searchProducts = useCallback(async (query: string) => {
    try {
      setLoading(true);
      setError(null);
      if (!query.trim()) {
        const data = await window.electronAPI.products.getAll();
        setProducts(data);
      } else {
        const data = await window.electronAPI.products.search(query);
        setProducts(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al buscar productos';
      setError(message);
      console.error('useProducts.searchProducts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createProduct = useCallback(async (data: {
    barcode: string;
    name: string;
    description?: string | null;
    category_id?: number | null;
    cost_price: number;
    margin_percent: number;
    stock?: number;
    min_stock?: number;
  }) => {
    try {
      const existingProduct = await window.electronAPI.products.getByBarcode(data.barcode);
      if (existingProduct) {
        throw new Error('El codigo de barras ya existe. Genera uno nuevo por seguridad.');
      }

      const created = await window.electronAPI.products.create(data);
      setProducts(prev => [...prev, created]);
      return created;
    } catch (err) {
      const message = getCreateProductErrorMessage(err);
      console.error('useProducts.createProduct:', err);
      throw new Error(message);
    }
  }, []);

  const updateProduct = useCallback(async (id: number, data: {
    name?: string;
    description?: string | null;
    category_id?: number | null;
    cost_price?: number;
    margin_percent?: number;
    min_stock?: number;
    is_active?: number;
  }) => {
    try {
      const updated = await window.electronAPI.products.update(id, data);
      if (updated) {
        setProducts(prev => prev.map(p => p.id === id ? updated : p));
      }
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar producto';
      console.error('useProducts.updateProduct:', err);
      throw new Error(message);
    }
  }, []);

  const deleteProduct = useCallback(async (id: number) => {
    try {
      const success = await window.electronAPI.products.delete(id);
      if (success) {
        // Soft delete: refresh to get updated is_active status
        await fetchProducts();
      }
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar producto';
      console.error('useProducts.deleteProduct:', err);
      throw new Error(message);
    }
  }, [fetchProducts]);

  const canDeleteProductPermanently = useCallback(async (id: number) => {
    try {
      return await window.electronAPI.products.canDeletePermanently(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al validar eliminacion permanente';
      console.error('useProducts.canDeleteProductPermanently:', err);
      throw new Error(message);
    }
  }, []);

  const deleteProductPermanently = useCallback(async (id: number) => {
    try {
      const success = await window.electronAPI.products.deletePermanently(id);
      if (success) {
        await fetchProducts();
      }
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar permanentemente';
      console.error('useProducts.deleteProductPermanently:', err);
      throw new Error(message);
    }
  }, [fetchProducts]);

  const lowStockProducts = products.filter(
    p => p.min_stock >= 0 && p.stock <= p.min_stock && p.is_active === 1
  );

  return {
    products,
    lowStockProducts,
    loading,
    error,
    fetchProducts,
    searchProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    canDeleteProductPermanently,
    deleteProductPermanently,
  };
}
