import { useEffect, useState } from 'react';

export function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [storeName, setStoreName] = useState('');

  useEffect(() => {
    async function checkConnection() {
      try {
        const name = await window.electronAPI.settings.get('store_name');
        setStoreName(name ?? 'MichiPapeleria');
        setDbStatus('connected');
      } catch (error) {
        console.error('Error connecting to database:', error);
        setDbStatus('error');
      }
    }
    checkConnection();
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
      <h1>{storeName || 'MichiPapeleria'}</h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>Punto de Venta</p>
      {dbStatus === 'loading' && <p>Conectando a la base de datos...</p>}
      {dbStatus === 'connected' && (
        <p style={{ color: 'var(--color-success)' }}>Base de datos conectada correctamente</p>
      )}
      {dbStatus === 'error' && (
        <p style={{ color: 'var(--color-error)' }}>Error al conectar con la base de datos</p>
      )}
    </div>
  );
}
