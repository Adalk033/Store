import { useState, useEffect, useRef, useCallback } from 'react';
import type { DataVersionMap } from '../types';

const POLL_INTERVAL_MS = 15_000;

/**
 * Hook that polls data versions from the main process.
 * When a module's version changes, the corresponding callback is invoked.
 * Only triggers on actual version changes, not on every poll.
 */
export function useDataVersions(
  onVersionChange?: (module: string, newVersion: number) => void
): {
  versions: DataVersionMap;
  refresh: () => Promise<void>;
} {
  const [versions, setVersions] = useState<DataVersionMap>({});
  const previousVersions = useRef<DataVersionMap>({});
  const onChangeRef = useRef(onVersionChange);
  onChangeRef.current = onVersionChange;

  const refresh = useCallback(async () => {
    try {
      const newVersions: DataVersionMap = await window.electronAPI.dataVersions.getAll();
      setVersions(newVersions);

      // Detect changes and notify
      const prev = previousVersions.current;
      for (const [module, version] of Object.entries(newVersions)) {
        if (prev[module] !== undefined && prev[module] !== version) {
          onChangeRef.current?.(module, version);
        }
      }
      previousVersions.current = newVersions;
    } catch (error) {
      console.error('useDataVersions: failed to fetch versions', error);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { versions, refresh };
}
