import { useEffect, useState } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import type { PageId } from './components/layout/Sidebar';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { POSPage } from './pages/POSPage';
import { CreditsPage } from './pages/CreditsPage';
import { CashRegisterPage } from './pages/CashRegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { BarcodeLabelPage } from './pages/BarcodeLabelPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [currentPage, setCurrentPage] = useState<PageId>('products');

  useEffect(() => {
    async function checkConnection() {
      try {
        await window.electronAPI.settings.get('store_name');
        setDbStatus('connected');
      } catch (error) {
        console.error('Error connecting to database:', error);
        setDbStatus('error');
      }
    }
    checkConnection();
  }, []);

  if (dbStatus === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p>Conectando a la base de datos...</p>
      </div>
    );
  }

  if (dbStatus === 'error') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--color-error)' }}>Error al conectar con la base de datos</p>
      </div>
    );
  }

  function renderPage() {
    switch (currentPage) {
      case 'products':
        return <ErrorBoundary pageName="Productos" key="products"><ProductsPage /></ErrorBoundary>;
      case 'inventory':
        return <ErrorBoundary pageName="Inventario" key="inventory"><InventoryPage /></ErrorBoundary>;
      case 'pos':
        return <ErrorBoundary pageName="Punto de Venta" key="pos"><POSPage /></ErrorBoundary>;
      case 'credits':
        return <ErrorBoundary pageName="Creditos" key="credits"><CreditsPage /></ErrorBoundary>;
      case 'cashRegister':
        return <ErrorBoundary pageName="Caja" key="cashRegister"><CashRegisterPage /></ErrorBoundary>;
      case 'reports':
        return <ErrorBoundary pageName="Reportes" key="reports"><ReportsPage /></ErrorBoundary>;
      case 'barcodeLabels':
        return <ErrorBoundary pageName="Etiquetas" key="barcodeLabels"><BarcodeLabelPage /></ErrorBoundary>;
      case 'settings':
        return <ErrorBoundary pageName="Configuracion" key="settings"><SettingsPage /></ErrorBoundary>;
      default:
        return <ErrorBoundary pageName="Productos" key="products-default"><ProductsPage /></ErrorBoundary>;
    }
  }

  return (
    <MainLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
    </MainLayout>
  );
}
