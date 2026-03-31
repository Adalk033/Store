import { useState, useCallback } from 'react';
import type { Setting } from '../types';

export interface SettingsMap {
  store_name: string;
  store_address: string;
  store_phone: string;
  ticket_footer_text: string;
  default_credit_days: string;
  default_surcharge_percent: string;
  default_margin_percent: string;
  last_active_page: string;
  [key: string]: string;
}

const DEFAULT_SETTINGS: SettingsMap = {
  store_name: '',
  store_address: '',
  store_phone: '',
  ticket_footer_text: '',
  default_credit_days: '5',
  default_surcharge_percent: '10',
  default_margin_percent: '50',
  last_active_page: 'products',
};

export function useSettings() {
  const [settings, setSettings] = useState<SettingsMap>({ ...DEFAULT_SETTINGS });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const rows: Setting[] = await window.electronAPI.settings.getAll();
      const map = { ...DEFAULT_SETTINGS };
      for (const row of rows) {
        map[row.key] = row.value;
      }
      setSettings(map);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar configuracion';
      setError(message);
      console.error('useSettings.fetchSettings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSetting = useCallback(async (key: string, value: string) => {
    try {
      setError(null);
      await window.electronAPI.settings.set(key, value);
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar configuracion';
      setError(message);
      console.error('useSettings.saveSetting:', err);
      throw err;
    }
  }, []);

  const saveMultiple = useCallback(async (entries: Array<{ key: string; value: string }>) => {
    try {
      setError(null);
      for (const entry of entries) {
        await window.electronAPI.settings.set(entry.key, entry.value);
      }
      setSettings(prev => {
        const updated = { ...prev };
        for (const entry of entries) {
          updated[entry.key] = entry.value;
        }
        return updated;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar configuracion';
      setError(message);
      console.error('useSettings.saveMultiple:', err);
      throw err;
    }
  }, []);

  return {
    settings,
    loading,
    error,
    fetchSettings,
    saveSetting,
    saveMultiple,
  };
}
