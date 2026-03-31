import { useEffect, useState } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import type { PageId } from './components/layout/Sidebar';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { POSPage } from './pages/POSPage';
import { SalesPage } from './pages/SalesPage.tsx';
import { CreditsPage } from './pages/CreditsPage';
import { CustomersPage } from './pages/CustomersPage.tsx';
import { CashRegisterPage } from './pages/CashRegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { BarcodeLabelPage } from './pages/BarcodeLabelPage';
import { SettingsPage } from './pages/SettingsPage';

const PAGE_IDS: PageId[] = ['products', 'inventory', 'pos', 'sales', 'credits', 'customers', 'cashRegister', 'reports', 'barcodeLabels', 'settings'];

function isPageId(value: string): value is PageId {
  return PAGE_IDS.includes(value as PageId);
}

export function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [currentPage, setCurrentPage] = useState<PageId>('products');
  const [storeName, setStoreName] = useState('MichiPapeleria');

  useEffect(() => {
    async function checkConnection() {
      try {
        const configuredStoreName = await window.electronAPI.settings.get('store_name');
        if (configuredStoreName?.trim()) {
          setStoreName(configuredStoreName.trim());
        }
        const lastActivePage = await window.electronAPI.settings.get('last_active_page');
        if (lastActivePage && isPageId(lastActivePage)) {
          setCurrentPage(lastActivePage);
        }
        setDbStatus('connected');
      } catch (error) {
        console.error('Error connecting to database:', error);
        setDbStatus('error');
      }
    }
    checkConnection();
  }, []);

  useEffect(() => {
    if (dbStatus !== 'connected') return;

    async function persistCurrentPage() {
      try {
        await window.electronAPI.settings.set('last_active_page', currentPage);
      } catch (error) {
        console.error('Error saving last active page:', error);
      }
    }

    void persistCurrentPage();
  }, [currentPage, dbStatus]);

  useEffect(() => {
    if (dbStatus !== 'connected') return;

    async function refreshStoreName() {
      try {
        const configuredStoreName = await window.electronAPI.settings.get('store_name');
        setStoreName(configuredStoreName?.trim() || 'Tienda');
      } catch (error) {
        console.error('Error loading store name:', error);
      }
    }

    void refreshStoreName();
  }, [currentPage, dbStatus]);

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
      case 'sales':
        return <ErrorBoundary pageName="Ventas" key="sales"><SalesPage /></ErrorBoundary>;
      case 'credits':
        return <ErrorBoundary pageName="Creditos" key="credits"><CreditsPage /></ErrorBoundary>;
      case 'customers':
        return <ErrorBoundary pageName="Clientes" key="customers"><CustomersPage /></ErrorBoundary>;
      case 'cashRegister':
        return <ErrorBoundary pageName="Caja" key="cashRegister"><CashRegisterPage /></ErrorBoundary>;
      case 'reports':
        return <ErrorBoundary pageName="Reportes" key="reports"><ReportsPage /></ErrorBoundary>;
      case 'barcodeLabels':
        return <ErrorBoundary pageName="Etiquetas" key="barcodeLabels"><BarcodeLabelPage /></ErrorBoundary>;
      case 'settings':
        return (
          <ErrorBoundary pageName="Configuracion" key="settings">
            <SettingsPage onStoreNameChange={setStoreName} />
          </ErrorBoundary>
        );
      default:
        return <ErrorBoundary pageName="Productos" key="products-default"><ProductsPage /></ErrorBoundary>;
    }
  }

  return (
    <MainLayout currentPage={currentPage} onNavigate={setCurrentPage} storeName={storeName}>
      {renderPage()}
    </MainLayout>
  );
}
