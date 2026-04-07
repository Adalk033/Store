import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { closeDatabase } from './database/connection';
import { runMigrations } from './database/migrations/001_initial';
import { IPC_CHANNELS } from '../src/lib/ipcChannels';

// Repositories
import * as categoriesRepo from './database/repositories/categories';
import * as productsRepo from './database/repositories/products';
import * as customersRepo from './database/repositories/customers';
import * as salesRepo from './database/repositories/sales';
import * as creditsRepo from './database/repositories/credits';
import * as inventoryRepo from './database/repositories/inventory';
import * as cashRegisterRepo from './database/repositories/cashRegister';
import * as settingsRepo from './database/repositories/settings';
import * as reportsRepo from './database/repositories/reports';
import { CloudApi } from './lib/cloudApi';

// Phase 5: Data versioning and metrics
import * as dataVersions from './lib/dataVersions';
import { recordMetric, estimatePayloadSize, getMetricsSummary } from './lib/metrics';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server URL or built file path
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(__dirname, '../dist');

let mainWindow: BrowserWindow | null = null;

let cloudHealthInFlight: Promise<'ready' | 'error'> | null = null;
let lastCloudHealthStatus: 'ready' | 'error' | null = null;
let lastCloudHealthCheckedAt = 0;
const CLOUD_HEALTH_CACHE_MS = 5000;

const CLOUD_API_KEY_FILE = 'cloud-api-key.bin';
const AWS_BOOTSTRAP_FILE = 'aws-bootstrap.json';

type AwsRecoveryConfig = {
  aws_enabled: string;
  aws_env: string;
  aws_region: string;
  aws_api_base_url: string;
  aws_timeout_ms: string;
  aws_retry_max: string;
};

const DEFAULT_AWS_RECOVERY_CONFIG: AwsRecoveryConfig = {
  aws_enabled: '1',
  aws_env: 'prod',
  aws_region: '',
  aws_api_base_url: '',
  aws_timeout_ms: '5000',
  aws_retry_max: '2',
};

function getCloudApiKeyPath(): string {
  return path.join(app.getPath('userData'), CLOUD_API_KEY_FILE);
}

function getAwsBootstrapPath(): string {
  return path.join(app.getPath('userData'), AWS_BOOTSTRAP_FILE);
}

function readAwsBootstrapFile(): Partial<AwsRecoveryConfig> {
  const filePath = getAwsBootstrapPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      aws_enabled: typeof parsed.aws_enabled === 'string' ? parsed.aws_enabled : undefined,
      aws_env: typeof parsed.aws_env === 'string' ? parsed.aws_env : undefined,
      aws_region: typeof parsed.aws_region === 'string' ? parsed.aws_region : undefined,
      aws_api_base_url: typeof parsed.aws_api_base_url === 'string' ? parsed.aws_api_base_url : undefined,
      aws_timeout_ms: typeof parsed.aws_timeout_ms === 'string' ? parsed.aws_timeout_ms : undefined,
      aws_retry_max: typeof parsed.aws_retry_max === 'string' ? parsed.aws_retry_max : undefined,
    };
  } catch (error) {
    console.error('Failed to read aws bootstrap file:', error);
    return {};
  }
}

function writeAwsBootstrapFile(config: AwsRecoveryConfig): void {
  const filePath = getAwsBootstrapPath();
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function toAwsRecoveryConfig(input: Partial<AwsRecoveryConfig>): AwsRecoveryConfig {
  return {
    aws_enabled: input.aws_enabled === '0' ? '0' : '1',
    aws_env: (input.aws_env || DEFAULT_AWS_RECOVERY_CONFIG.aws_env).trim() || 'prod',
    aws_region: (input.aws_region || '').trim(),
    aws_api_base_url: (input.aws_api_base_url || '').trim(),
    aws_timeout_ms: (input.aws_timeout_ms || DEFAULT_AWS_RECOVERY_CONFIG.aws_timeout_ms).trim(),
    aws_retry_max: (input.aws_retry_max || DEFAULT_AWS_RECOVERY_CONFIG.aws_retry_max).trim(),
  };
}

function validateAwsRecoveryConfig(config: AwsRecoveryConfig): AwsRecoveryConfig {
  const timeout = Number(config.aws_timeout_ms);
  const retries = Number(config.aws_retry_max);

  if (!Number.isFinite(timeout) || timeout < 1000) {
    throw new Error('aws_timeout_ms debe ser >= 1000');
  }

  if (!Number.isFinite(retries) || retries < 0 || retries > 5) {
    throw new Error('aws_retry_max debe estar entre 0 y 5');
  }

  if (config.aws_enabled === '1') {
    if (!config.aws_region) {
      throw new Error('aws_region es obligatoria cuando AWS esta habilitado');
    }
    if (!config.aws_api_base_url) {
      throw new Error('aws_api_base_url es obligatoria cuando AWS esta habilitado');
    }
  }

  return {
    ...config,
    aws_timeout_ms: String(Math.floor(timeout)),
    aws_retry_max: String(Math.floor(retries)),
  };
}

function getAwsRecoveryConfig(): AwsRecoveryConfig {
  const fromFile = readAwsBootstrapFile();
  const merged: Partial<AwsRecoveryConfig> = { ...DEFAULT_AWS_RECOVERY_CONFIG, ...fromFile };

  try {
    merged.aws_enabled = settingsRepo.getSetting('aws_enabled') ?? merged.aws_enabled;
    merged.aws_env = settingsRepo.getSetting('aws_env') ?? merged.aws_env;
    merged.aws_region = settingsRepo.getSetting('aws_region') ?? merged.aws_region;
    merged.aws_api_base_url = settingsRepo.getSetting('aws_api_base_url') ?? merged.aws_api_base_url;
    merged.aws_timeout_ms = settingsRepo.getSetting('aws_timeout_ms') ?? merged.aws_timeout_ms;
    merged.aws_retry_max = settingsRepo.getSetting('aws_retry_max') ?? merged.aws_retry_max;
  } catch (error) {
    console.error('Falling back to aws bootstrap file due to settings DB access error:', error);
  }

  return toAwsRecoveryConfig(merged);
}

function isCloudEnabled(): boolean {
  try {
    return getAwsRecoveryConfig().aws_enabled === '1';
  } catch (error) {
    console.error('Failed to evaluate cloud mode flag:', error);
    return false;
  }
}

function canUseCloudApi(): boolean {
  try {
    const config = getAwsRecoveryConfig();
    return config.aws_enabled === '1' && config.aws_api_base_url.trim() !== '' && hasCloudApiKeySecret();
  } catch (error) {
    console.error('Failed to evaluate cloud availability:', error);
    return false;
  }
}

function saveAwsRecoveryConfig(input: Partial<AwsRecoveryConfig>): AwsRecoveryConfig {
  const normalized = validateAwsRecoveryConfig(toAwsRecoveryConfig(input));

  try {
    settingsRepo.setSetting('aws_enabled', normalized.aws_enabled);
    settingsRepo.setSetting('aws_env', normalized.aws_env);
    settingsRepo.setSetting('aws_region', normalized.aws_region);
    settingsRepo.setSetting('aws_api_base_url', normalized.aws_api_base_url);
    settingsRepo.setSetting('aws_timeout_ms', normalized.aws_timeout_ms);
    settingsRepo.setSetting('aws_retry_max', normalized.aws_retry_max);
  } catch (error) {
    console.error('Failed to persist aws recovery config to settings table, using bootstrap file only:', error);
  }

  writeAwsBootstrapFile(normalized);
  return normalized;
}

function setCloudApiKeySecret(value: string): void {
  const trimmed = value.trim();
  const secretPath = getCloudApiKeyPath();

  if (!trimmed) {
    if (fs.existsSync(secretPath)) {
      fs.unlinkSync(secretPath);
    }
    return;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El cifrado seguro local no esta disponible en este sistema');
  }

  const encrypted = safeStorage.encryptString(trimmed);
  fs.writeFileSync(secretPath, encrypted);
}

function hasCloudApiKeySecret(): boolean {
  const secretPath = getCloudApiKeyPath();
  return fs.existsSync(secretPath) && fs.statSync(secretPath).size > 0;
}

function getCloudApiKeySecret(): string {
  const secretPath = getCloudApiKeyPath();
  if (!fs.existsSync(secretPath)) {
    return '';
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El cifrado seguro local no esta disponible en este sistema');
  }

  const encrypted = fs.readFileSync(secretPath);
  return safeStorage.decryptString(encrypted).trim();
}

function normalizeCloudBaseUrl(rawBaseUrl: string, awsEnv: string): string {
  const parsed = new URL(rawBaseUrl);
  const stage = awsEnv.trim().replace(/^\/+|\/+$/g, '');
  let pathname = parsed.pathname.replace(/\/+$/, '');

  // Prevent duplicated '/v1' when users paste a full endpoint URL.
  if (pathname.toLowerCase().endsWith('/v1')) {
    pathname = pathname.slice(0, -3);
  }

  // For API Gateway execute-api host, auto-inject stage when URL has no path.
  if (parsed.hostname.includes('execute-api.') && stage && (!pathname || pathname === '/')) {
    pathname = `/${stage}`;
  }

  parsed.pathname = pathname || '/';
  return parsed.toString().replace(/\/+$/, '');
}

function getCloudApiConfig() {
  const awsConfig = getAwsRecoveryConfig();
  const baseUrl = awsConfig.aws_api_base_url.trim();
  const awsEnv = awsConfig.aws_env.trim();
  const timeoutMs = Number(awsConfig.aws_timeout_ms || '5000');
  const retryMax = Number(awsConfig.aws_retry_max || '2');
  const apiKey = getCloudApiKeySecret();

  if (!baseUrl) {
    throw new Error('Falta configurar AWS API Base URL en Configuracion');
  }
  if (!apiKey) {
    throw new Error('Falta configurar API key cloud en Configuracion');
  }

  const normalizedBaseUrl = normalizeCloudBaseUrl(baseUrl, awsEnv);

  return {
    baseUrl: normalizedBaseUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 5000,
    retryMax: Number.isFinite(retryMax) && retryMax >= 0 ? retryMax : 2,
  };
}

function normalizePositiveIntegerId(value: unknown, fieldName: string): number {
  const normalized = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof normalized !== 'number' || !Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`ID de ${fieldName} invalido`);
  }
  return normalized;
}

function normalizePositiveAmount(value: unknown): number {
  const normalized = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('Monto de abono invalido');
  }
  return normalized;
}

const cloudApi = new CloudApi(getCloudApiConfig);

type CloudSettingsSection = 'store' | 'products' | 'credits';

const CLOUD_SETTINGS_SECTION_KEYS: Record<CloudSettingsSection, readonly string[]> = {
  store: ['store_name', 'store_address', 'store_phone', 'ticket_footer_text'],
  products: ['default_margin_percent'],
  credits: ['default_credit_days', 'default_surcharge_percent', 'business_timezone'],
};

function getCloudSettingsSectionByKey(key: string): CloudSettingsSection | null {
  if (CLOUD_SETTINGS_SECTION_KEYS.store.includes(key)) {
    return 'store';
  }
  if (CLOUD_SETTINGS_SECTION_KEYS.products.includes(key)) {
    return 'products';
  }
  if (CLOUD_SETTINGS_SECTION_KEYS.credits.includes(key)) {
    return 'credits';
  }
  return null;
}

async function getCloudManagedSettingValue(key: string): Promise<string | undefined> {
  const section = getCloudSettingsSectionByKey(key);
  if (!section) {
    return undefined;
  }
  try {
    const data = await cloudApi.getSettingsSection(section);
    return data.values[key];
  } catch (error) {
    console.error('Falling back to local settings due to cloud settings access error:', { key, error });
    return settingsRepo.getSetting(key);
  }
}

async function mergeCloudManagedSettings(localRows: Array<{ key: string; value: string }>) {
  const merged = new Map(localRows.map((row) => [row.key, row.value]));

  for (const section of Object.keys(CLOUD_SETTINGS_SECTION_KEYS) as CloudSettingsSection[]) {
    try {
      const data = await cloudApi.getSettingsSection(section);
      for (const [key, value] of Object.entries(data.values)) {
        merged.set(key, value);
      }
    } catch (error) {
      console.error('Falling back to local settings for cloud-managed section:', { section, error });
    }
  }

  return Array.from(merged.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'store-internal - Punto de Venta',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize database and run migrations
function initDatabase(): void {
  try {
    runMigrations();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// Register all IPC handlers
function registerIpcHandlers(): void {
  // Categories
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_ALL, async () => {
    if (canUseCloudApi()) {
      return cloudApi.getCategories();
    }
    return categoriesRepo.getAllCategories();
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_BY_ID, async (_, id: number) => {
    if (canUseCloudApi()) {
      const categories = await cloudApi.getCategories();
      return categories.find((c) => c.id === id);
    }
    return categoriesRepo.getCategoryById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_CREATE, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.createCategory(data);
    }
    return categoriesRepo.createCategory(data);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_UPDATE, (_, id: number, data) => {
    if (canUseCloudApi()) {
      return cloudApi.updateCategory(id, data);
    }
    return categoriesRepo.updateCategory(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_DELETE, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.deleteCategory(id);
    }
    return categoriesRepo.deleteCategory(id);
  });

  // Products
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_ALL, () => {
    if (canUseCloudApi()) {
      return cloudApi.getProducts();
    }
    return productsRepo.getAllProducts();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_ID, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getProductById(id);
    }
    return productsRepo.getProductById(id);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_BARCODE, (_, barcode: string) => {
    if (canUseCloudApi()) {
      return cloudApi.getProductByBarcode(barcode);
    }
    return productsRepo.getProductByBarcode(barcode);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_SEARCH, (_, query: string) => {
    if (canUseCloudApi()) {
      return cloudApi.getProducts({ search: query });
    }
    return productsRepo.searchProducts(query);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_LOW_STOCK, () => {
    if (canUseCloudApi()) {
      return cloudApi.getLowStockProducts();
    }
    return productsRepo.getLowStockProducts();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CREATE, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.createProduct(data);
    }
    return productsRepo.createProduct(data);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_UPDATE, (_, id: number, data) => {
    if (canUseCloudApi()) {
      return cloudApi.updateProduct(id, data);
    }
    return productsRepo.updateProduct(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.deleteProduct(id);
    }
    return productsRepo.deleteProduct(id);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CAN_DELETE_PERMANENTLY, (_, id: number) =>
    canUseCloudApi() ? cloudApi.canDeleteProductPermanently(id) : productsRepo.canDeleteProductPermanently(id)
  );
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE_PERMANENTLY, (_, id: number) =>
    canUseCloudApi() ? cloudApi.deleteProductPermanently(id) : productsRepo.deleteProductPermanently(id)
  );

  // Products - Paginated endpoint (Phase 4)
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getProductsPaginated({
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          status: typeof q.status === 'string' ? q.status : undefined,
          categoryId: typeof q.categoryId === 'number' ? q.categoryId : undefined,
          lowStock: typeof q.lowStock === 'boolean' ? q.lowStock : undefined,
          startsWith: typeof q.startsWith === 'string' ? q.startsWith.slice(0, 4).toUpperCase() : undefined,
          stockMode: q.stockMode === 'eq' || q.stockMode === 'lte' || q.stockMode === 'gte'
            ? q.stockMode
            : undefined,
          stockValue: typeof q.stockValue === 'number' && Number.isFinite(q.stockValue)
            ? Math.max(0, Math.trunc(q.stockValue))
            : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return productsRepo.getAllProductsPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        categoryId: typeof q.categoryId === 'number' ? q.categoryId : undefined,
        lowStock: typeof q.lowStock === 'boolean' ? q.lowStock : undefined,
        startsWith: typeof q.startsWith === 'string' ? q.startsWith.slice(0, 4).toUpperCase() : undefined,
        stockMode: q.stockMode === 'eq' || q.stockMode === 'lte' || q.stockMode === 'gte'
          ? q.stockMode
          : undefined,
        stockValue: typeof q.stockValue === 'number' && Number.isFinite(q.stockValue)
          ? Math.max(0, Math.trunc(q.stockValue))
          : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Customers
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_ALL, () => {
    if (canUseCloudApi()) {
      return cloudApi.getCustomers({ status: 'active' });
    }
    return customersRepo.getAllCustomers();
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getCustomerById(id);
    }
    return customersRepo.getCustomerById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_CREATE, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.createCustomer(data);
    }
    return customersRepo.createCustomer(data);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_UPDATE, (_, id: number, data) => {
    if (canUseCloudApi()) {
      return cloudApi.updateCustomer(id, data);
    }
    return customersRepo.updateCustomer(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_DELETE, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.deleteCustomer(id);
    }
    return customersRepo.deleteCustomer(id);
  });

  // Customers - Paginated endpoint (Phase 3)
  ipcMain.handle(
    IPC_CHANNELS.CUSTOMERS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      const allowedCreditStatuses = ['all', 'withDebt', 'overdue', 'withoutCredits'] as const;
      const creditStatus = typeof q.creditStatus === 'string' && allowedCreditStatuses.includes(q.creditStatus as (typeof allowedCreditStatuses)[number])
        ? q.creditStatus as (typeof allowedCreditStatuses)[number]
        : undefined;

      if (canUseCloudApi()) {
        return cloudApi.getCustomersPaginated({
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          status: typeof q.status === 'string' ? q.status : undefined,
          creditStatus,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return customersRepo.getAllCustomersPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        creditStatus,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Sales
  ipcMain.handle(IPC_CHANNELS.SALES_CREATE, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.createSale(data);
    }
    const result = salesRepo.createSale(data);
    return result.data;
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_ALL, async (_, limit?: number, offset?: number) => {
    if (canUseCloudApi()) {
      const items = await cloudApi.getSales();
      if (typeof limit === 'number' && typeof offset === 'number') {
        return items.slice(offset, offset + limit);
      }
      return items;
    }
    return salesRepo.getAllSales(limit, offset);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_BY_ID, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getSaleById(id);
    }
    return salesRepo.getSaleById(id);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_DETAIL, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getSaleDetailById(id);
    }
    return salesRepo.getSaleDetailById(id);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_DELETE, (_, id: number | string) => {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw new Error('ID de venta invalido');
    }

    if (canUseCloudApi()) {
      return cloudApi.deleteSale(parsedId);
    }

    return salesRepo.deleteSale(parsedId);
  });

  // Sales - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getSalesPaginated({
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          type: typeof q.type === 'string' ? q.type : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return salesRepo.getAllSalesPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_SUMMARY,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getSalesSummary({
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          type: typeof q.type === 'string' ? q.type : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        });
      }

      return salesRepo.getSalesSummary({
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
      });
    }
  );

  // Sales - Cursor paginated endpoint (Phase 5)
  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_ALL_CURSOR,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return salesRepo.getAllSalesCursor({
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        cursor: typeof q.cursor === 'string' ? q.cursor : undefined,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Credits
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_ALL, (_, status?: string) => {
    if (canUseCloudApi()) {
      return cloudApi.getCredits(status);
    }
    return creditsRepo.getAllCredits(status);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_ID, (_, id: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getCreditById(id);
    }
    return creditsRepo.getCreditById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER, (_, customerId: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getCreditsByCustomer(customerId);
    }
    return creditsRepo.getCreditsByCustomer(customerId);
  });
  ipcMain.handle(
    IPC_CHANNELS.CREDITS_ADD_PAYMENT,
    (_, creditIdInput: unknown, amountInput: unknown, paymentDate?: string, idempotencyKey?: string) => {
      const creditId = normalizePositiveIntegerId(creditIdInput, 'credito');
      const amount = normalizePositiveAmount(amountInput);
      if (paymentDate !== undefined && typeof paymentDate !== 'string') {
        throw new Error('Fecha de abono invalida');
      }

      if (canUseCloudApi()) {
        return cloudApi.addCreditPayment(creditId, amount, paymentDate, idempotencyKey);
      }

      const result = creditsRepo.addCreditPayment(creditId, amount, paymentDate, idempotencyKey);
      return result.data;
    }
  );
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_PAYMENTS, (_, creditId: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getCreditPayments(creditId);
    }
    return creditsRepo.getCreditPayments(creditId);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_CHECK_OVERDUE, () => {
    if (canUseCloudApi()) {
      return cloudApi.checkOverdueCredits();
    }
    return creditsRepo.checkOverdueCredits();
  });

  // Credits - Paginated endpoints (Phase 3)
  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getCreditsPaginated({
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          status: typeof q.status === 'string' ? q.status : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return creditsRepo.getAllCreditsPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER_PAGINATED,
    (_, customerId: number, query: unknown) => {
      if (typeof customerId !== 'number' || !Number.isInteger(customerId) || customerId < 1) {
        throw new Error('ID de cliente invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getCreditsByCustomerPaginated(customerId, {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          status: typeof q.status === 'string' ? q.status : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return creditsRepo.getCreditsByCustomerPaginated(customerId, {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        status: typeof q.status === 'string' ? q.status : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_PAYMENTS_PAGINATED,
    (_, creditId: number, query: unknown) => {
      if (typeof creditId !== 'number' || !Number.isInteger(creditId) || creditId < 1) {
        throw new Error('ID de credito invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getCreditPaymentsPaginated(creditId, {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return creditsRepo.getCreditPaymentsPaginated(creditId, {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_SUMMARY,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getCreditsSummary({
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          status: typeof q.status === 'string' ? q.status : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        });
      }

      return creditsRepo.getCreditsSummary({
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
      });
    }
  );

  // Inventory
  ipcMain.handle(IPC_CHANNELS.INVENTORY_ADD_MOVEMENT, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.addInventoryMovement(data);
    }
    return inventoryRepo.addInventoryMovement(data);
  });
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT, (_, productId: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getInventoryMovementsByProduct(productId);
    }
    return inventoryRepo.getMovementsByProduct(productId);
  });
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_ALL, async (_, limit?: number, offset?: number) => {
    if (canUseCloudApi()) {
      const items = await cloudApi.getInventoryMovements();
      if (typeof limit === 'number' && typeof offset === 'number') {
        return items.slice(offset, offset + limit);
      }
      return items;
    }
    return inventoryRepo.getAllMovements(limit, offset);
  });

  // Inventory - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.INVENTORY_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getInventoryMovementsPaginated({
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          type: typeof q.type === 'string' ? q.type : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return inventoryRepo.getAllMovementsPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT_PAGINATED,
    (_, productId: number, query: unknown) => {
      if (typeof productId !== 'number' || !Number.isInteger(productId) || productId < 1) {
        throw new Error('ID de producto invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getInventoryMovementsByProductPaginated(productId, {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          type: typeof q.type === 'string' ? q.type : undefined,
          dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
          dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        });
      }

      return inventoryRepo.getMovementsByProductPaginated(productId, {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Cash Register
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_OPEN, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.openCashRegister(data);
    }
    return cashRegisterRepo.openPeriod(data);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_CLOSE, (_, id: number, closingCash: number, endDate: string, expectedVersion?: number) => {
    if (canUseCloudApi()) {
      void expectedVersion;
      return cloudApi.closeCashRegister({ id, closing_cash: closingCash, end_date: endDate });
    }
    return cashRegisterRepo.closePeriod(id, closingCash, endDate, expectedVersion);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_CURRENT, () => {
    if (canUseCloudApi()) {
      return cloudApi.getCurrentCashRegister();
    }
    return cashRegisterRepo.getCurrentPeriod();
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_ALL, () => {
    if (canUseCloudApi()) {
      return cloudApi.getCashRegisterPeriods();
    }
    return cashRegisterRepo.getAllPeriods();
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_ADD_MOVEMENT, (_, data) => {
    if (canUseCloudApi()) {
      return cloudApi.addCashMovement(data);
    }
    const result = cashRegisterRepo.addCashMovement(data);
    return result.data;
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS, (_, cashRegisterId: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getCashMovements(cashRegisterId);
    }
    return cashRegisterRepo.getMovementsByPeriod(cashRegisterId);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_SALES_SUMMARY, (_, cashRegisterId: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getCashRegisterSalesSummary(cashRegisterId);
    }
    return cashRegisterRepo.getSalesSummaryByPeriod(cashRegisterId);
  });
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_SALES,
    async (_, cashRegisterId: number, limit?: number, offset?: number) => {
      if (canUseCloudApi()) {
        const items = await cloudApi.getCashRegisterSales(cashRegisterId);
        if (typeof limit === 'number' && typeof offset === 'number') {
          return items.slice(offset, offset + limit);
        }
        return items;
      }
      return cashRegisterRepo.getSalesByPeriod(cashRegisterId, limit, offset);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS,
    async (_, cashRegisterId: number, limit?: number, offset?: number) => {
      if (canUseCloudApi()) {
        const items = await cloudApi.getCashRegisterCreditPayments(cashRegisterId);
        if (typeof limit === 'number' && typeof offset === 'number') {
          return items.slice(offset, offset + limit);
        }
        return items;
      }
      return cashRegisterRepo.getCreditPaymentsByPeriod(cashRegisterId, limit, offset);
    }
  );

  // Cash Register - Paginated endpoints (Phase 1)
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_SALES_PAGINATED,
    (_, cashRegisterId: number, query: unknown) => {
      if (typeof cashRegisterId !== 'number' || !Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new Error('ID de periodo invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cashRegisterRepo.getSalesByPeriodPaginated(cashRegisterId, {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS_PAGINATED,
    (_, cashRegisterId: number, query: unknown) => {
      if (typeof cashRegisterId !== 'number' || !Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new Error('ID de periodo invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cashRegisterRepo.getCreditPaymentsByPeriodPaginated(cashRegisterId, {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS_PAGINATED,
    (_, cashRegisterId: number, query: unknown) => {
      if (typeof cashRegisterId !== 'number' || !Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new Error('ID de periodo invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cashRegisterRepo.getMovementsByPeriodPaginated(cashRegisterId, {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cashRegisterRepo.getAllPeriodsPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        status: typeof q.status === 'string' ? q.status : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Reports
  ipcMain.handle(IPC_CHANNELS.REPORTS_SALES_BY_DATE, (_, startDate: string, endDate: string) => {
    if (canUseCloudApi()) {
      return cloudApi.getSalesByDate(startDate, endDate);
    }
    return reportsRepo.getSalesByDateRange(startDate, endDate);
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_TOP_PRODUCTS, (_, startDate: string, endDate: string, limit?: number) => {
    if (canUseCloudApi()) {
      return cloudApi.getTopProducts(startDate, endDate, limit);
    }
    return reportsRepo.getTopProducts(startDate, endDate, limit);
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_PROFIT, (_, startDate: string, endDate: string) => {
    if (canUseCloudApi()) {
      return cloudApi.getProfitReport(startDate, endDate);
    }
    return reportsRepo.getProfitReport(startDate, endDate);
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY, () => {
    if (canUseCloudApi()) {
      return cloudApi.getInventoryReport();
    }
    return reportsRepo.getInventoryReport();
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY_SUMMARY, () => {
    if (canUseCloudApi()) {
      return cloudApi.getInventorySummary();
    }
    return reportsRepo.getInventorySummary();
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW, () => {
    if (canUseCloudApi()) {
      return cloudApi.getCreditsOverview();
    }
    return reportsRepo.getCreditsOverview();
  });

  // Reports - Paginated endpoints (Phase 4)
  ipcMain.handle(
    IPC_CHANNELS.REPORTS_INVENTORY_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getReportPaginated(
          cloudApi.getInventoryReport(),
          {
            page: typeof q.page === 'number' ? q.page : 1,
            pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
            sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
          }
        );
      }

      return reportsRepo.getInventoryReportPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS_PROFIT_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getReportPaginated(
          cloudApi.getProfitReport(
            typeof q.dateFrom === 'string' ? q.dateFrom : '1970-01-01',
            typeof q.dateTo === 'string' ? q.dateTo : '9999-12-31'
          ),
          {
            page: typeof q.page === 'number' ? q.page : 1,
            pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
            sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
          }
        );
      }

      return reportsRepo.getProfitReportPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS_TOP_PRODUCTS_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getReportPaginated(
          cloudApi.getTopProducts(
            typeof q.dateFrom === 'string' ? q.dateFrom : '1970-01-01',
            typeof q.dateTo === 'string' ? q.dateTo : '9999-12-31'
          ),
          {
            page: typeof q.page === 'number' ? q.page : 1,
            pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
            sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
          }
        );
      }

      return reportsRepo.getTopProductsPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (canUseCloudApi()) {
        return cloudApi.getReportPaginated(
          cloudApi.getCreditsOverview(),
          {
            page: typeof q.page === 'number' ? q.page : 1,
            pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
            sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
          }
        );
      }

      return reportsRepo.getCreditsOverviewPaginated({
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_, key: string) => {
    if (canUseCloudApi()) {
      const section = getCloudSettingsSectionByKey(key);
      if (section) {
        return getCloudManagedSettingValue(key);
      }
    }
    return settingsRepo.getSetting(key);
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    const localRows = settingsRepo.getAllSettings();
    if (!canUseCloudApi()) {
      return localRows;
    }
    return mergeCloudManagedSettings(localRows);
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_, key: string, value: string) => {
    if (canUseCloudApi()) {
      const section = getCloudSettingsSectionByKey(key);
      if (section) {
        await cloudApi.updateSettingsSection(section, { [key]: value });
        return;
      }
    }
    settingsRepo.setSetting(key, value);
  });
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_SECTION,
    async (_, section: CloudSettingsSection, entries: Array<{ key: string; value: string }>) => {
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('No hay configuraciones para guardar');
      }

      if (canUseCloudApi()) {
        if (!Object.prototype.hasOwnProperty.call(CLOUD_SETTINGS_SECTION_KEYS, section)) {
          throw new Error('Seccion de configuracion invalida');
        }

        const allowedKeys = new Set(CLOUD_SETTINGS_SECTION_KEYS[section]);
        const values: Record<string, string> = {};
        for (const entry of entries) {
          if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') {
            throw new Error('Entrada de configuracion invalida');
          }
          if (!allowedKeys.has(entry.key)) {
            throw new Error(`La clave ${entry.key} no pertenece a la seccion ${section}`);
          }
          values[entry.key] = entry.value;
        }

        await cloudApi.updateSettingsSection(section, values);
        return;
      }

      for (const entry of entries) {
        settingsRepo.setSetting(entry.key, entry.value);
      }
    }
  );
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CLOUD_API_KEY, (_, value: string) => {
    if (typeof value !== 'string') {
      throw new Error('La API key debe ser texto');
    }
    setCloudApiKeySecret(value);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_HAS_CLOUD_API_KEY, () => hasCloudApiKeySecret());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CHECK_CLOUD_HEALTH, async () => {
    if (!isCloudEnabled()) {
      return 'disabled' as const;
    }

    const awsConfig = getAwsRecoveryConfig();
    if (!awsConfig.aws_api_base_url.trim() || !hasCloudApiKeySecret()) {
      return 'missing-key' as const;
    }

    const now = Date.now();
    if (
      lastCloudHealthStatus
      && (now - lastCloudHealthCheckedAt) < CLOUD_HEALTH_CACHE_MS
    ) {
      return lastCloudHealthStatus;
    }

    if (!cloudHealthInFlight) {
      cloudHealthInFlight = (async () => {
        const healthy = await cloudApi.checkHealth();
        const status: 'ready' | 'error' = healthy ? 'ready' : 'error';
        lastCloudHealthStatus = status;
        lastCloudHealthCheckedAt = Date.now();
        return status;
      })();

      cloudHealthInFlight.finally(() => {
        cloudHealthInFlight = null;
      });
    }

    return cloudHealthInFlight;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_AWS_RECOVERY, () => getAwsRecoveryConfig());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_AWS_RECOVERY, (_, config: Partial<AwsRecoveryConfig>) => {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuracion AWS invalida');
    }
    return saveAwsRecoveryConfig(config);
  });

  // Database backup
  ipcMain.handle(IPC_CHANNELS.SETTINGS_BACKUP_DB, () => {
    const dbDir = app.isPackaged ? app.getPath('userData') : app.getAppPath();
    const dbPath = path.join(dbDir, 'store-internal.db');
    const backupDir = path.join(dbDir, 'backups');

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `store-internal-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);

    fs.copyFileSync(dbPath, backupPath);
    return backupName;
  });

  // Data Versions (Phase 5)
  ipcMain.handle(IPC_CHANNELS.DATA_VERSIONS_GET_ALL, () => dataVersions.getAllVersions());

  // Metrics (Phase 5)
  ipcMain.handle(IPC_CHANNELS.METRICS_GET_SUMMARY, () => getMetricsSummary());
}

// Wrap all registered IPC handlers with metrics instrumentation (Phase 5)
// Override ipcMain.handle before registering handlers so every call is timed automatically.
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
  return originalHandle(channel, async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    const start = performance.now();
    let success = true;
    let result: unknown;
    try {
      result = await listener(event, ...args);
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const payloadBytes = estimatePayloadSize(result);
      recordMetric({
        channel,
        durationMs,
        payloadBytes,
        success,
        timestamp: Date.now(),
      });
    }
  });
};

app.whenReady().then(() => {
  initDatabase();
  registerIpcHandlers();

  // Check overdue credits on startup
  try {
    const count = creditsRepo.checkOverdueCredits();
    if (count > 0) {
      console.log(`Applied surcharge to ${count} overdue credits`);
    }
  } catch (error) {
    console.error('Error checking overdue credits:', error);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  closeDatabase();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
