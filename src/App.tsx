import { useEffect, useState } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import type { PageId } from './components/layout/Sidebar';
import styles from './App.module.css';
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
import { HelpPage } from './pages/HelpPage';

const PAGE_IDS: PageId[] = ['products', 'inventory', 'pos', 'sales', 'credits', 'customers', 'cashRegister', 'reports', 'barcodeLabels', 'settings', 'help'];
const PAGE_TRANSITION_MS = 280;

type AwsRecoveryForm = {
  aws_enabled: string;
  aws_env: string;
  aws_region: string;
  aws_api_base_url: string;
  aws_timeout_ms: string;
  aws_retry_max: string;
};

const DEFAULT_AWS_RECOVERY_FORM: AwsRecoveryForm = {
  aws_enabled: '1',
  aws_env: 'prod',
  aws_region: '',
  aws_api_base_url: '',
  aws_timeout_ms: '5000',
  aws_retry_max: '2',
};

function isPageId(value: string): value is PageId {
  return PAGE_IDS.includes(value as PageId);
}

export function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [currentPage, setCurrentPage] = useState<PageId>('products');
  const [isNavigating, setIsNavigating] = useState(false);
  const [storeName, setStoreName] = useState('store-internal');
  const [initialCustomerId, setInitialCustomerId] = useState<number | null>(null);
  const [initialCreditId, setInitialCreditId] = useState<number | null>(null);
  const [awsRecoveryForm, setAwsRecoveryForm] = useState<AwsRecoveryForm>(DEFAULT_AWS_RECOVERY_FORM);
  const [awsRecoveryApiKey, setAwsRecoveryApiKey] = useState('');
  const [awsRecoveryHasApiKey, setAwsRecoveryHasApiKey] = useState(false);
  const [awsRecoveryLoading, setAwsRecoveryLoading] = useState(false);
  const [awsRecoverySaving, setAwsRecoverySaving] = useState(false);
  const [awsRecoveryMessage, setAwsRecoveryMessage] = useState<string | null>(null);
  const [awsRecoveryError, setAwsRecoveryError] = useState<string | null>(null);

  function navigateToPage(page: PageId) {
    if (page === currentPage) return;
    setIsNavigating(true);
    setCurrentPage(page);
  }

  function openCustomerProfileFromSales(customerId: number) {
    setInitialCustomerId(customerId);
    navigateToPage('customers');
  }

  function openCreditDetailFromCustomers(creditId: number) {
    setInitialCreditId(creditId);
    navigateToPage('credits');
  }

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
    if (dbStatus !== 'error') {
      return;
    }

    async function loadAwsRecovery() {
      setAwsRecoveryLoading(true);
      setAwsRecoveryError(null);
      setAwsRecoveryMessage(null);
      try {
        const [config, hasApiKey] = await Promise.all([
          window.electronAPI.settings.getAwsRecovery(),
          window.electronAPI.settings.hasCloudApiKey(),
        ]);
        setAwsRecoveryForm({
          aws_enabled: config.aws_enabled || '1',
          aws_env: config.aws_env || 'prod',
          aws_region: config.aws_region || '',
          aws_api_base_url: config.aws_api_base_url || '',
          aws_timeout_ms: config.aws_timeout_ms || '5000',
          aws_retry_max: config.aws_retry_max || '2',
        });
        setAwsRecoveryHasApiKey(Boolean(hasApiKey));
      } catch (error) {
        setAwsRecoveryError(error instanceof Error ? error.message : 'No se pudo cargar configuracion AWS de recuperacion');
      } finally {
        setAwsRecoveryLoading(false);
      }
    }

    void loadAwsRecovery();
  }, [dbStatus]);

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

  useEffect(() => {
    if (!isNavigating) return;

    const timer = window.setTimeout(() => {
      setIsNavigating(false);
    }, PAGE_TRANSITION_MS);

    return () => window.clearTimeout(timer);
  }, [currentPage, isNavigating]);

  if (dbStatus === 'loading') {
    return (
      <div className={styles['centered-state--compact']}>
        <p>Conectando a la base de datos...</p>
      </div>
    );
  }

  if (dbStatus === 'error') {
    async function handleSaveAwsRecovery() {
      setAwsRecoverySaving(true);
      setAwsRecoveryError(null);
      setAwsRecoveryMessage(null);

      try {
        await window.electronAPI.settings.setAwsRecovery(awsRecoveryForm);

        if (awsRecoveryApiKey.trim()) {
          await window.electronAPI.settings.setCloudApiKey(awsRecoveryApiKey);
          setAwsRecoveryApiKey('');
        }

        const hasApiKey = await window.electronAPI.settings.hasCloudApiKey();
        setAwsRecoveryHasApiKey(Boolean(hasApiKey));
        setAwsRecoveryMessage('Configuracion AWS guardada. Reinicia la app para reintentar la conexion.');
      } catch (error) {
        setAwsRecoveryError(error instanceof Error ? error.message : 'No se pudo guardar la configuracion AWS');
      } finally {
        setAwsRecoverySaving(false);
      }
    }

    function handleAwsRecoveryChange(key: keyof AwsRecoveryForm, value: string) {
      setAwsRecoveryForm(prev => ({ ...prev, [key]: value }));
    }

    return (
      <div className={styles['centered-state']}>
        <div className={styles['recovery-card']}>
          <h2 className={styles['recovery-title']}>No fue posible iniciar la aplicacion</h2>
          <p className={styles['recovery-subtitle']}>
            Se bloqueo el acceso al sistema hasta corregir la conexion AWS. Solo esta habilitada esta seccion de recuperacion.
          </p>

          {awsRecoveryLoading ? (
            <p>Cargando configuracion AWS...</p>
          ) : (
            <>
              <div className={styles['recovery-grid']}>
                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>Habilitar modo AWS</span>
                  <select
                    value={awsRecoveryForm.aws_enabled}
                    onChange={(e) => handleAwsRecoveryChange('aws_enabled', e.target.value)}
                    className={styles['recovery-input']}
                  >
                    <option value="0">No</option>
                    <option value="1">Si</option>
                  </select>
                </label>

                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>Entorno</span>
                  <select
                    value={awsRecoveryForm.aws_env}
                    onChange={(e) => handleAwsRecoveryChange('aws_env', e.target.value)}
                    className={styles['recovery-input']}
                  >
                    <option value="prod">prod</option>
                  </select>
                </label>
              </div>

              <div className={styles['recovery-grid']}>
                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>Region AWS</span>
                  <input
                    value={awsRecoveryForm.aws_region}
                    onChange={(e) => handleAwsRecoveryChange('aws_region', e.target.value)}
                    placeholder="mx-central-1"
                    className={styles['recovery-input']}
                  />
                </label>

                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>API Base URL</span>
                  <input
                    value={awsRecoveryForm.aws_api_base_url}
                    onChange={(e) => handleAwsRecoveryChange('aws_api_base_url', e.target.value)}
                    placeholder="https://xxxx.execute-api.mx-central-1.amazonaws.com"
                    className={styles['recovery-input']}
                  />
                </label>
              </div>

              <div className={styles['recovery-grid']}>
                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>Timeout (ms)</span>
                  <input
                    type="number"
                    min={1000}
                    value={awsRecoveryForm.aws_timeout_ms}
                    onChange={(e) => handleAwsRecoveryChange('aws_timeout_ms', e.target.value)}
                    className={styles['recovery-input']}
                  />
                </label>

                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>Reintentos maximos</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={awsRecoveryForm.aws_retry_max}
                    onChange={(e) => handleAwsRecoveryChange('aws_retry_max', e.target.value)}
                    className={styles['recovery-input']}
                  />
                </label>
              </div>

              <label className={styles['recovery-field']}>
                <span className={styles['recovery-label']}>API Key Cloud</span>
                <input
                  type="password"
                  value={awsRecoveryApiKey}
                  onChange={(e) => setAwsRecoveryApiKey(e.target.value)}
                  placeholder={awsRecoveryHasApiKey ? 'API key guardada (escribe solo si deseas reemplazar)' : 'Ingresa tu API key'}
                  className={styles['recovery-input']}
                />
              </label>

              {awsRecoveryHasApiKey ? (
                <p className={`${styles['recovery-message']} ${styles['recovery-message--success']}`}>Existe una API key cloud guardada en este equipo.</p>
              ) : (
                <p className={`${styles['recovery-message']} ${styles['recovery-message--warning']}`}>No hay API key cloud guardada en este equipo.</p>
              )}

              {awsRecoveryError ? (
                <p className={`${styles['recovery-message']} ${styles['recovery-message--error']}`}>{awsRecoveryError}</p>
              ) : null}
              {awsRecoveryMessage ? (
                <p className={`${styles['recovery-message']} ${styles['recovery-message--success']}`}>{awsRecoveryMessage}</p>
              ) : null}

              <div className={styles['recovery-actions']}>
                <button
                  onClick={() => void handleSaveAwsRecovery()}
                  disabled={awsRecoverySaving}
                  className={styles['recovery-save']}
                >
                  {awsRecoverySaving ? 'Guardando...' : 'Guardar configuracion AWS'}
                </button>
              </div>
            </>
          )}
        </div>
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
        return (
          <ErrorBoundary pageName="Ventas" key="sales">
            <SalesPage onViewCustomerProfile={openCustomerProfileFromSales} />
          </ErrorBoundary>
        );
      case 'credits':
        return (
          <ErrorBoundary pageName="Creditos" key="credits">
            <CreditsPage
              initialCreditId={initialCreditId}
              onInitialCreditHandled={() => setInitialCreditId(null)}
            />
          </ErrorBoundary>
        );
      case 'customers':
        return (
          <ErrorBoundary pageName="Clientes" key="customers">
            <CustomersPage
              initialCustomerId={initialCustomerId}
              onInitialCustomerHandled={() => setInitialCustomerId(null)}
              onViewCreditDetail={openCreditDetailFromCustomers}
            />
          </ErrorBoundary>
        );
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
      case 'help':
        return <ErrorBoundary pageName="Ayuda" key="help"><HelpPage /></ErrorBoundary>;
      default:
        return <ErrorBoundary pageName="Productos" key="products-default"><ProductsPage /></ErrorBoundary>;
    }
  }

  return (
    <MainLayout currentPage={currentPage} onNavigate={navigateToPage} storeName={storeName} isNavigating={isNavigating}>
      {renderPage()}
    </MainLayout>
  );
}
