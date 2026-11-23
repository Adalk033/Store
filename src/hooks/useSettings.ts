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
  business_timezone: string;
  [key: string]: string;
}

export type SettingsSection = 'store' | 'products' | 'credits';

const DEFAULT_SETTINGS: SettingsMap = {
  store_name: '',
  store_address: '',
  store_phone: '',
  ticket_footer_text: '',
  default_credit_days: '5',
  default_surcharge_percent: '10',
  default_margin_percent: '50',
  business_timezone: 'America/Mexico_City',
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

  const saveSection = useCallback(async (section: SettingsSection, entries: Array<{ key: string; value: string }>) => {
    try {
      setError(null);
      await window.electronAPI.settings.setSection(section, entries);
      setSettings(prev => {
        const updated = { ...prev };
        for (const entry of entries) {
          updated[entry.key] = entry.value;
        }
        return updated;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar configuracion por seccion';
      setError(message);
      console.error('useSettings.saveSection:', err);
      throw err;
    }
  }, []);

  const setCloudApiKey = useCallback(async (value: string) => {
    try {
      setError(null);
      await window.electronAPI.settings.setCloudApiKey(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar API key segura';
      setError(message);
      console.error('useSettings.setCloudApiKey:', err);
      throw err;
    }
  }, []);

  const hasCloudApiKey = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      return await window.electronAPI.settings.hasCloudApiKey();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al consultar API key';
      setError(message);
      console.error('useSettings.hasCloudApiKey:', err);
      return false;
    }
  }, []);

  return {
    settings,
    loading,
    error,
    fetchSettings,
    saveSection,
    setCloudApiKey,
    hasCloudApiKey,
  };
}
