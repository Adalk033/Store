import { useState, useEffect, useCallback } from 'react';
import type { Category } from '../types';

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.categories.getAll();
      setCategories(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar categorias';
      setError(message);
      console.error('useCategories.fetchCategories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const createCategory = useCallback(async (data: { name: string; parent_id?: number | null }) => {
    try {
      const created = await window.electronAPI.categories.create(data);
      setCategories(prev => [...prev, created]);
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al crear categoria';
      console.error('useCategories.createCategory:', err);
      throw new Error(message);
    }
  }, []);

  const updateCategory = useCallback(async (id: number, data: { name?: string; parent_id?: number | null }) => {
    try {
      const updated = await window.electronAPI.categories.update(id, data);
      if (updated) {
        setCategories(prev => prev.map(c => c.id === id ? updated : c));
      }
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al actualizar categoria';
      console.error('useCategories.updateCategory:', err);
      throw new Error(message);
    }
  }, []);

  const deleteCategory = useCallback(async (id: number) => {
    try {
      const success = await window.electronAPI.categories.delete(id);
      if (success) {
        setCategories(prev => prev.filter(c => c.id !== id));
      }
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar categoria';
      console.error('useCategories.deleteCategory:', err);
      throw new Error(message);
    }
  }, []);

  // Helper: get root categories (no parent)
  const rootCategories = categories.filter(c => c.parent_id === null);

  // Helper: get children of a category
  const getChildren = useCallback((parentId: number) => {
    return categories.filter(c => c.parent_id === parentId);
  }, [categories]);

  return {
    categories,
    rootCategories,
    getChildren,
    loading,
    error,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
