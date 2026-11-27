import { lazy, Suspense, useEffect, useState } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { ConnectionStatusLegend, type ConnectionStatusItem } from './components/layout/ConnectionStatusLegend';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import type { PageId } from './components/layout/Sidebar';
import styles from './App.module.css';
import { ProductsPage } from './pages/ProductsPage';
import type { AwsConnectionConfig } from './types/database';

const InventoryPage = lazy(() => import('./pages/InventoryPage').then(module => ({ default: module.InventoryPage })));
const POSPage = lazy(() => import('./pages/POSPage').then(module => ({ default: module.POSPage })));
const SalesPage = lazy(() => import('./pages/SalesPage').then(module => ({ default: module.SalesPage })));
const CreditsPage = lazy(() => import('./pages/CreditsPage').then(module => ({ default: module.CreditsPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then(module => ({ default: module.CustomersPage })));
const CashRegisterPage = lazy(() => import('./pages/CashRegisterPage').then(module => ({ default: module.CashRegisterPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const BarcodeLabelPage = lazy(() => import('./pages/BarcodeLabelPage').then(module => ({ default: module.BarcodeLabelPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then(module => ({ default: module.HelpPage })));

const PAGE_TRANSITION_MS = 280;
const CLOUD_HEALTH_CHECK_INTERVAL_MS = 15000;

const DEFAULT_AWS_RECOVERY_FORM: AwsConnectionConfig = {
  aws_env: 'prod',
  aws_region: '',
  aws_api_base_url: '',
  aws_timeout_ms: '5000',
  aws_retry_max: '2',
};

export function App() {
  const [cloudStatus, setCloudStatus] = useState<'loading' | 'ready' | 'missing-key' | 'error'>('loading');
  const [startupMode, setStartupMode] = useState<'loading' | 'cloud' | 'recovery'>('loading');
  const [currentPage, setCurrentPage] = useState<PageId>('products');
  const [isNavigating, setIsNavigating] = useState(false);
  const [storeName, setStoreName] = useState('store-internal');
  const [initialCustomerId, setInitialCustomerId] = useState<number | null>(null);
  const [initialCreditId, setInitialCreditId] = useState<number | null>(null);
  const [awsRecoveryForm, setAwsRecoveryForm] = useState<AwsConnectionConfig>(DEFAULT_AWS_RECOVERY_FORM);
  const [awsRecoveryApiKey, setAwsRecoveryApiKey] = useState('');
  const [awsRecoveryHasApiKey, setAwsRecoveryHasApiKey] = useState(false);
  const [awsRecoveryLoading, setAwsRecoveryLoading] = useState(false);
  const [awsRecoverySaving, setAwsRecoverySaving] = useState(false);
  const [awsRecoveryError, setAwsRecoveryError] = useState<string | null>(null);

  const connectionItems: ConnectionStatusItem[] = [
    cloudStatus === 'loading'
      ? { value: 'Verificando...', tone: 'info' }
      : cloudStatus === 'ready'
        ? { value: 'Conectado', tone: 'success' }
        : cloudStatus === 'missing-key'
          ? { value: 'No conectado', tone: 'warning' }
          : { value: 'No conectado', tone: 'error' },
  ];

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
    let disposed = false;
    let inFlight = false;

    async function refreshCloudStatus() {
      if (inFlight || disposed) {
        return;
      }

      inFlight = true;
      try {
        const status = await window.electronAPI.settings.checkCloudHealth();
        if (!disposed) {
          setCloudStatus(status);
          setStartupMode(previous => status === 'ready' || previous === 'cloud' ? 'cloud' : 'recovery');
        }
      } catch (error) {
        console.error('Error checking cloud health:', error);
        if (!disposed) {
          setCloudStatus('error');
          setStartupMode(previous => previous === 'cloud' ? 'cloud' : 'recovery');
        }
      } finally {
        inFlight = false;
      }
    }

    void refreshCloudStatus();
    const intervalId = window.setInterval(() => {
      void refreshCloudStatus();
    }, CLOUD_HEALTH_CHECK_INTERVAL_MS);
    const onBrowserConnectivityChange = () => {
      void refreshCloudStatus();
    };

    window.addEventListener('online', onBrowserConnectivityChange);
    window.addEventListener('offline', onBrowserConnectivityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('online', onBrowserConnectivityChange);
      window.removeEventListener('offline', onBrowserConnectivityChange);
    };
  }, []);

  useEffect(() => {
    if (startupMode !== 'recovery') {
      return;
    }

    async function loadAwsRecovery() {
      setAwsRecoveryLoading(true);
      setAwsRecoveryError(null);
      try {
        const [config, hasApiKey] = await Promise.all([
          window.electronAPI.settings.getAwsRecovery(),
          window.electronAPI.settings.hasCloudApiKey(),
        ]);
        setAwsRecoveryForm({
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
  }, [startupMode]);

  useEffect(() => {
    if (startupMode !== 'cloud') return;

    async function refreshStoreName() {
      try {
        const configuredStoreName = await window.electronAPI.settings.get('store_name');
        setStoreName(configuredStoreName?.trim() || 'Tienda');
      } catch (error) {
        console.error('Error loading store name:', error);
      }
    }

    void refreshStoreName();
  }, [startupMode]);

  useEffect(() => {
    if (!isNavigating) return;

    const timer = window.setTimeout(() => {
      setIsNavigating(false);
    }, PAGE_TRANSITION_MS);

    return () => window.clearTimeout(timer);
  }, [currentPage, isNavigating]);

  if (startupMode === 'loading') {
    return (
      <div className={styles['centered-state--compact']}>
        <div className={styles['centered-state__stack']}>
          <ConnectionStatusLegend items={connectionItems} />
          <p>Verificando la conexión con AWS...</p>
        </div>
      </div>
    );
  }

  if (startupMode === 'recovery') {
    async function handleSaveAwsRecovery() {
      setAwsRecoverySaving(true);
      setAwsRecoveryError(null);

      try {
        await window.electronAPI.settings.setAwsRecovery(awsRecoveryForm);

        if (awsRecoveryApiKey.trim()) {
          await window.electronAPI.settings.setCloudApiKey(awsRecoveryApiKey);
          setAwsRecoveryApiKey('');
        }

        const hasApiKey = await window.electronAPI.settings.hasCloudApiKey();
        setAwsRecoveryHasApiKey(Boolean(hasApiKey));
        const status = await window.electronAPI.settings.checkCloudHealth();
        setCloudStatus(status);
        if (status === 'ready') {
          setStartupMode('cloud');
        } else {
          setAwsRecoveryError('Configuración guardada. Verifica la URL, la API key y la conexión a internet.');
        }
      } catch (error) {
        setAwsRecoveryError(error instanceof Error ? error.message : 'No se pudo guardar la configuracion AWS');
      } finally {
        setAwsRecoverySaving(false);
      }
    }

    function handleAwsRecoveryChange(key: keyof AwsConnectionConfig, value: string) {
      setAwsRecoveryForm(prev => ({ ...prev, [key]: value }));
    }

    return (
      <div className={styles['centered-state']}>
        <div className={styles['recovery-stack']}>
          <ConnectionStatusLegend items={connectionItems} />
          <div className={styles['recovery-card']}>
            <h2 className={styles['recovery-title']}>No fue posible iniciar la aplicacion</h2>
            <p className={styles['recovery-subtitle']}>
              Verifica la conexión a internet y la configuración de AWS para entrar al punto de venta.
            </p>

            {awsRecoveryLoading ? (
              <p>Cargando configuracion AWS...</p>
            ) : (
              <>
                <div className={styles['recovery-grid']}>
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

                  <label className={styles['recovery-field']}>
                    <span className={styles['recovery-label']}>Region AWS</span>
                    <input
                      value={awsRecoveryForm.aws_region}
                      onChange={(e) => handleAwsRecoveryChange('aws_region', e.target.value)}
                      placeholder="mx-central-1"
                      className={styles['recovery-input']}
                    />
                  </label>
                </div>

                <label className={styles['recovery-field']}>
                  <span className={styles['recovery-label']}>API Base URL</span>
                  <input
                    value={awsRecoveryForm.aws_api_base_url}
                    onChange={(e) => handleAwsRecoveryChange('aws_api_base_url', e.target.value)}
                    placeholder="https://xxxx.execute-api.mx-central-1.amazonaws.com"
                    className={styles['recovery-input']}
                  />
                </label>

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
                    aria-describedby="aws-recovery-key-status"
                    placeholder={awsRecoveryHasApiKey ? 'Nueva API key' : 'Ingresa tu API key'}
                    className={styles['recovery-input']}
                  />
                </label>

                {awsRecoveryHasApiKey ? (
                  <p id="aws-recovery-key-status" className={`${styles['recovery-message']} ${styles['recovery-message--success']}`}>
                    Hay una API key guardada en este equipo. Escribe una nueva solo si deseas reemplazarla.
                  </p>
                ) : (
                  <p id="aws-recovery-key-status" className={`${styles['recovery-message']} ${styles['recovery-message--warning']}`}>No hay API key cloud guardada en este equipo.</p>
                )}

                {awsRecoveryError ? (
                  <p className={`${styles['recovery-message']} ${styles['recovery-message--error']}`}>{awsRecoveryError}</p>
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
    <MainLayout
      currentPage={currentPage}
      onNavigate={navigateToPage}
      storeName={storeName}
      connectionItems={connectionItems}
      isNavigating={isNavigating}
    >
      <Suspense fallback={<p role="status">Cargando pantalla…</p>}>
        {renderPage()}
      </Suspense>
    </MainLayout>
  );
}
