import { useEffect, useState } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import type { PageId } from './components/layout/Sidebar';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { POSPage } from './pages/POSPage';
import { CreditsPage } from './pages/CreditsPage';
import { CashRegisterPage } from './pages/CashRegisterPage';
import { ReportsPage } from './pages/ReportsPage';

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
        return <ProductsPage />;
      case 'inventory':
        return <InventoryPage />;
      case 'pos':
        return <POSPage />;
      case 'credits':
        return <CreditsPage />;
      case 'cashRegister':
        return <CashRegisterPage />;
      case 'reports':
        return <ReportsPage />;
      default:
        return <ProductsPage />;
    }
  }

  return (
    <MainLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
    </MainLayout>
  );
}
