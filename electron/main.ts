import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS } from '../src/lib/ipcChannels';

import { CloudApi } from './lib/cloudApi';

// Phase 5: Data versioning and metrics
import type {
  AwsConnectionConfig as AwsRecoveryConfig,
  DailySalesRow, TopProductRow, ProfitRow, InventoryValueRow, InventorySummary, CreditsOverviewRow,
} from '../src/types/database';
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

const DEFAULT_AWS_RECOVERY_CONFIG: AwsRecoveryConfig = {
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

  if (!config.aws_region || !config.aws_api_base_url) {
    throw new Error('Configura la región y la URL de la API de AWS');
  }
  normalizeCloudBaseUrl(config.aws_api_base_url, config.aws_env);

  return {
    ...config,
    aws_timeout_ms: String(Math.floor(timeout)),
    aws_retry_max: String(Math.floor(retries)),
  };
}

function getAwsRecoveryConfig(): AwsRecoveryConfig {
  return toAwsRecoveryConfig(readAwsBootstrapFile());
}

function saveAwsRecoveryConfig(input: Partial<AwsRecoveryConfig>): AwsRecoveryConfig {
  for (const key of Object.keys(DEFAULT_AWS_RECOVERY_CONFIG) as Array<keyof AwsRecoveryConfig>) {
    const value = input[key];
    if (typeof value !== 'string' || value.length > 2048) {
      throw new Error('Configuración de conexión inválida');
    }
  }
  const normalized = validateAwsRecoveryConfig(toAwsRecoveryConfig(input));
  writeAwsBootstrapFile(normalized);
  lastCloudHealthStatus = null;
  return normalized;
}

let cloudKeyWrite: Promise<void> = Promise.resolve();

async function setCloudApiKeySecret(value: string): Promise<void> {
  const trimmed = value.trim();
  const secretPath = getCloudApiKeyPath();

  if (!trimmed) {
    if (fs.existsSync(secretPath)) {
      fs.unlinkSync(secretPath);
    }
    return;
  }

  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('El cifrado seguro local no esta disponible en este sistema');
  }

  const encrypted = await safeStorage.encryptStringAsync(trimmed);
  fs.writeFileSync(secretPath, encrypted);
}

function hasCloudApiKeySecret(): boolean {
  const secretPath = getCloudApiKeyPath();
  return fs.existsSync(secretPath) && fs.statSync(secretPath).size > 0;
}

async function getCloudApiKeySecret(): Promise<string> {
  await cloudKeyWrite;
  const secretPath = getCloudApiKeyPath();
  if (!fs.existsSync(secretPath)) {
    return '';
  }

  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('El cifrado seguro local no esta disponible en este sistema');
  }

  const encrypted = fs.readFileSync(secretPath);
  const { result } = await safeStorage.decryptStringAsync(encrypted);
  return result.trim();
}

function normalizeCloudBaseUrl(rawBaseUrl: string, awsEnv: string): string {
  if (!URL.canParse(rawBaseUrl)) throw new Error('URL de la API inválida');
  const parsed = new URL(rawBaseUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('La URL de la API debe usar HTTPS y estar libre de credenciales y parámetros');
  }
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

async function getCloudApiConfig() {
  const awsConfig = getAwsRecoveryConfig();
  const baseUrl = awsConfig.aws_api_base_url.trim();
  const awsEnv = awsConfig.aws_env.trim();
  const timeoutMs = Number(awsConfig.aws_timeout_ms || '5000');
  const retryMax = Number(awsConfig.aws_retry_max || '2');
  const apiKey = await getCloudApiKeySecret();

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

// Register all IPC handlers
function registerIpcHandlers(): void {
  // Categories
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_ALL, async () => {
    return cloudApi.getCategories();
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_BY_ID, async (_, id: number) => {
    const categories = await cloudApi.getCategories();
    return categories.find((c) => c.id === id);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_CREATE, (_, data) => {
    return cloudApi.createCategory(data);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_UPDATE, (_, id: number, data) => {
    return cloudApi.updateCategory(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_DELETE, (_, id: number) => {
    return cloudApi.deleteCategory(id);
  });

  // Products
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_ALL, () => {
    return cloudApi.getProducts();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_ID, (_, id: number) => {
    return cloudApi.getProductById(id);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_BARCODE, (_, barcode: string) => {
    return cloudApi.getProductByBarcode(barcode);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_SEARCH, (_, query: string) => {
    return cloudApi.getProducts({ search: query });
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_LOW_STOCK, () => {
    return cloudApi.getLowStockProducts();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CREATE, (_, data) => {
    return cloudApi.createProduct(data);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_UPDATE, (_, id: number, data) => {
    return cloudApi.updateProduct(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE, (_, id: number) => {
    return cloudApi.deleteProduct(id);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CAN_DELETE_PERMANENTLY, (_, id: number) =>
    cloudApi.canDeleteProductPermanently(id)
  );
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE_PERMANENTLY, (_, id: number) =>
    cloudApi.deleteProductPermanently(id)
  );

  // Products - Paginated endpoint (Phase 4)
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
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
  );

  // Customers
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_ALL, () => {
    return cloudApi.getCustomers({ status: 'active' });
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, (_, id: number) => {
    return cloudApi.getCustomerById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_CREATE, (_, data) => {
    return cloudApi.createCustomer(data);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_UPDATE, (_, idInput: unknown, dataInput: unknown) => {
    const id = normalizePositiveIntegerId(idInput, 'cliente');
    const raw = (typeof dataInput === 'object' && dataInput !== null ? dataInput : {}) as Record<string, unknown>;
    const data: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      is_active?: number;
    } = {};

    if (raw.name !== undefined) {
      if (typeof raw.name !== 'string') {
        throw new Error('El nombre del cliente es invalido');
      }
      const trimmed = raw.name.trim();
      if (!trimmed) {
        throw new Error('El nombre del cliente es obligatorio');
      }
      if (trimmed.length > 150) {
        throw new Error('El nombre del cliente no puede exceder 150 caracteres');
      }
      data.name = trimmed;
    }
    if (raw.phone !== undefined) {
      if (raw.phone !== null && typeof raw.phone !== 'string') {
        throw new Error('Telefono invalido');
      }
      data.phone = raw.phone === null ? null : (raw.phone as string).trim().slice(0, 50) || null;
    }
    if (raw.email !== undefined) {
      if (raw.email !== null && typeof raw.email !== 'string') {
        throw new Error('Correo invalido');
      }
      data.email = raw.email === null ? null : (raw.email as string).trim().slice(0, 150) || null;
    }
    if (raw.notes !== undefined) {
      if (raw.notes !== null && typeof raw.notes !== 'string') {
        throw new Error('Notas invalidas');
      }
      data.notes = raw.notes === null ? null : (raw.notes as string).slice(0, 2000);
    }
    if (raw.is_active !== undefined) {
      const v = Number(raw.is_active);
      if (v !== 0 && v !== 1) {
        throw new Error('Estado de cliente invalido');
      }
      data.is_active = v;
    }

    return cloudApi.updateCustomer(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_DELETE, (_, id: number) => {
    return cloudApi.deleteCustomer(id);
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

      return cloudApi.getCustomersPaginated({
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
    return cloudApi.createSale(data);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_ALL, async (_, limit?: number, offset?: number) => {
    const items = await cloudApi.getSales();
    if (typeof limit === 'number' && typeof offset === 'number') {
      return items.slice(offset, offset + limit);
    }
    return items;
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_BY_ID, (_, id: number) => {
    return cloudApi.getSaleById(id);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_DETAIL, (_, id: number) => {
    return cloudApi.getSaleDetailById(id);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_DELETE, (_, id: number | string) => {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw new Error('ID de venta invalido');
    }

    return cloudApi.deleteSale(parsedId);
  });

  // Sales - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
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
  );

  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_SUMMARY,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getSalesSummary({
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
      });
    }
  );

  // Credits
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_ALL, (_, status?: string) => {
    return cloudApi.getCredits(status);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_ID, (_, id: number) => {
    return cloudApi.getCreditById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER, (_, customerId: number) => {
    return cloudApi.getCreditsByCustomer(customerId);
  });
  ipcMain.handle(
    IPC_CHANNELS.CREDITS_ADD_PAYMENT,
    (_, creditIdInput: unknown, amountInput: unknown, paymentDate?: string, idempotencyKey?: string) => {
      const creditId = normalizePositiveIntegerId(creditIdInput, 'credito');
      const amount = normalizePositiveAmount(amountInput);
      if (paymentDate !== undefined && typeof paymentDate !== 'string') {
        throw new Error('Fecha de abono invalida');
      }

      return cloudApi.addCreditPayment(creditId, amount, paymentDate, idempotencyKey);
    }
  );
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_PAYMENTS, (_, creditId: number) => {
    return cloudApi.getCreditPayments(creditId);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_CHECK_OVERDUE, () => {
    return cloudApi.checkOverdueCredits();
  });

  // Credits - Paginated endpoints (Phase 3)
  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
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
  );

  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER_PAGINATED,
    (_, customerId: number, query: unknown) => {
      if (typeof customerId !== 'number' || !Number.isInteger(customerId) || customerId < 1) {
        throw new Error('ID de cliente invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getCreditsByCustomerPaginated(customerId, {
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
      return cloudApi.getCreditPaymentsPaginated(creditId, {
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
      return cloudApi.getCreditsSummary({
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.CREDITS_DELETE, async (_, id: number | string) => {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw new Error('ID de credito invalido');
    }

    try {
      const credit = await cloudApi.getCreditById(parsedId);
      if (!credit) {
        throw new Error('El credito no existe');
      }
      return cloudApi.deleteSale(credit.sale_id);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('no encontrado')) {
        throw new Error('El credito no existe');
      }
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.CREDITS_UPDATE, (_, id: number | string, data: unknown) => {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw new Error('ID de credito invalido');
    }

    const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    const updateData: { due_date?: string; surcharge_percent?: number } = {};

    if (typeof d.due_date === 'string') {
      const trimmedDate = d.due_date.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        throw new Error('La fecha limite no tiene un formato valido');
      }
      updateData.due_date = trimmedDate;
    }
    if (typeof d.surcharge_percent === 'number') {
      if (!Number.isFinite(d.surcharge_percent) || d.surcharge_percent < 0 || d.surcharge_percent > 100) {
        throw new Error('El porcentaje de recargo debe estar entre 0 y 100');
      }
      updateData.surcharge_percent = d.surcharge_percent;
    }

    return cloudApi.updateCredit(parsedId, updateData);
  });

  // Inventory
  ipcMain.handle(IPC_CHANNELS.INVENTORY_ADD_MOVEMENT, (_, data: unknown) => {
    const raw = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

    const productId = normalizePositiveIntegerId(raw.product_id, 'producto');

    if (raw.type !== 'in' && raw.type !== 'out' && raw.type !== 'adjustment') {
      throw new Error('Tipo de movimiento invalido');
    }
    const type: 'in' | 'out' | 'adjustment' = raw.type;

    const quantityRaw = typeof raw.quantity === 'string' ? Number(raw.quantity) : raw.quantity;
    if (
      typeof quantityRaw !== 'number'
      || !Number.isFinite(quantityRaw)
      || !Number.isInteger(quantityRaw)
      || quantityRaw === 0
    ) {
      throw new Error('La cantidad debe ser un entero distinto de cero');
    }
    if ((type === 'in' || type === 'out') && quantityRaw < 0) {
      throw new Error('La cantidad debe ser positiva para entradas y salidas');
    }

    let referenceId: number | null = null;
    if (raw.reference_id !== undefined && raw.reference_id !== null) {
      const parsedRef = typeof raw.reference_id === 'string' ? Number(raw.reference_id) : raw.reference_id;
      if (typeof parsedRef !== 'number' || !Number.isInteger(parsedRef) || parsedRef < 1) {
        throw new Error('Referencia invalida');
      }
      referenceId = parsedRef;
    }

    let notes: string | null = null;
    if (raw.notes !== undefined && raw.notes !== null) {
      if (typeof raw.notes !== 'string') {
        throw new Error('Las notas deben ser texto');
      }
      const trimmed = raw.notes.trim();
      notes = trimmed.length === 0 ? null : trimmed.slice(0, 500);
    }

    let costPrice: number | undefined;
    if (raw.cost_price !== undefined) {
      const parsed = typeof raw.cost_price === 'string' ? Number(raw.cost_price) : raw.cost_price;
      if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('El precio de costo debe ser mayor a 0');
      }
      costPrice = parsed;
    }

    let marginPercent: number | undefined;
    if (raw.margin_percent !== undefined) {
      const parsed = typeof raw.margin_percent === 'string' ? Number(raw.margin_percent) : raw.margin_percent;
      if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error('El porcentaje de utilidad no puede ser negativo');
      }
      marginPercent = parsed;
    }

    const sanitized = {
      product_id: productId,
      type,
      quantity: quantityRaw,
      reference_id: referenceId,
      notes,
      cost_price: costPrice,
      margin_percent: marginPercent,
    };

    return cloudApi.addInventoryMovement(sanitized);
  });
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT, (_, productId: number) => {
    return cloudApi.getInventoryMovementsByProduct(productId);
  });
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_ALL, async (_, limit?: number, offset?: number) => {
    const items = await cloudApi.getInventoryMovements();
    if (typeof limit === 'number' && typeof offset === 'number') {
      return items.slice(offset, offset + limit);
    }
    return items;
  });

  // Inventory - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.INVENTORY_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
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
  );

  ipcMain.handle(
    IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT_PAGINATED,
    (_, productId: number, query: unknown) => {
      if (typeof productId !== 'number' || !Number.isInteger(productId) || productId < 1) {
        throw new Error('ID de producto invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getInventoryMovementsByProductPaginated(productId, {
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
    return cloudApi.openCashRegister(data);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_CLOSE, (_, id: number, closingCash: number, endDate: string, expectedVersion?: number) => {
    void expectedVersion;
    return cloudApi.closeCashRegister({ id, closing_cash: closingCash, end_date: endDate });
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_CURRENT, () => {
    return cloudApi.getCurrentCashRegister();
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_ALL, () => {
    return cloudApi.getCashRegisterPeriods();
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_ADD_MOVEMENT, (_, data) => {
    return cloudApi.addCashMovement(data);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_UPDATE_MOVEMENT, (_, id: number, data: any) => {
    return cloudApi.updateCashMovement(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_DELETE_MOVEMENT, (_, id: number) => {
    return cloudApi.deleteCashMovement(id);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS, (_, cashRegisterId: number) => {
    return cloudApi.getCashMovements(cashRegisterId);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_SALES_SUMMARY, (_, cashRegisterId: number) => {
    return cloudApi.getCashRegisterSalesSummary(cashRegisterId).then((data) => {
      return {
        sale_count: toSafeInt(data?.sale_count),
        total_cash_sales: toSafeNumber(data?.total_cash_sales),
        total_credit_sales: toSafeNumber(data?.total_credit_sales),
        total_credit_collected: toSafeNumber(data?.total_credit_collected),
      };
    });
  });
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_SALES,
    async (_, cashRegisterId: number, limit?: number, offset?: number) => {
      const items = await cloudApi.getCashRegisterSales(cashRegisterId);
      if (typeof limit === 'number' && typeof offset === 'number') {
        return items.slice(offset, offset + limit);
      }
      return items;
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS,
    async (_, cashRegisterId: number, limit?: number, offset?: number) => {
      const items = await cloudApi.getCashRegisterCreditPayments(cashRegisterId);
      if (typeof limit === 'number' && typeof offset === 'number') {
        return items.slice(offset, offset + limit);
      }
      return items;
    }
  );

  // Cash Register - Paginated endpoints (Phase 1)
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_SALES_PAGINATED,
    (_, rawCashRegisterId: unknown, query: unknown) => {
      const cashRegisterId = Number(rawCashRegisterId);
      if (!Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new Error('ID de periodo invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      const parsedQuery = {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      };
      return cloudApi.getCashRegisterSalesPaginated(cashRegisterId, parsedQuery);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS_PAGINATED,
    (_, rawCashRegisterId: unknown, query: unknown) => {
      const cashRegisterId = Number(rawCashRegisterId);
      if (!Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new Error('ID de periodo invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      const parsedQuery = {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      };
      return cloudApi.getCashRegisterCreditPaymentsPaginated(cashRegisterId, parsedQuery);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS_PAGINATED,
    (_, rawCashRegisterId: unknown, query: unknown) => {
      const cashRegisterId = Number(rawCashRegisterId);
      if (!Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new Error('ID de periodo invalido');
      }
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      const parsedQuery = {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      };
      return cloudApi.getCashMovementsPaginated(cashRegisterId, parsedQuery);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_ALL_PAGINATED,
    async (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      const parsedQuery = {
        page: typeof q.page === 'number' ? q.page : 1,
        pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
        status: typeof q.status === 'string' ? q.status : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      };
      return cloudApi.getCashRegisterPeriodsPaginated(parsedQuery);
    }
  );

  function toSafeNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function toSafeInt(value: unknown): number {
    const n = toSafeNumber(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  function toSafeString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function normalizeDailySalesRows(rows: Array<Record<string, unknown>>): DailySalesRow[] {
    return rows.map((r) => ({
      date: toSafeString(r.date),
      count: toSafeInt(r.count),
      total_cash: toSafeNumber(r.total_cash),
      total_credit: toSafeNumber(r.total_credit),
      total: toSafeNumber(r.total),
    }));
  }

  function normalizeTopProductRows(rows: Array<Record<string, unknown>>): TopProductRow[] {
    return rows.map((r) => ({
      product_id: toSafeInt(r.product_id),
      product_name: toSafeString(r.product_name),
      total_quantity: toSafeNumber(r.total_quantity),
      total_revenue: toSafeNumber(r.total_revenue),
    }));
  }

  function normalizeProfitRows(rows: Array<Record<string, unknown>>): ProfitRow[] {
    return rows.map((r) => ({
      product_id: toSafeInt(r.product_id),
      product_name: toSafeString(r.product_name),
      total_quantity: toSafeNumber(r.total_quantity),
      total_revenue: toSafeNumber(r.total_revenue),
      total_cost: toSafeNumber(r.total_cost),
      profit: toSafeNumber(r.profit),
      margin: toSafeNumber(r.margin),
    }));
  }

  function normalizeInventoryRows(rows: Array<Record<string, unknown>>): InventoryValueRow[] {
    return rows.map((r) => ({
      product_id: toSafeInt(r.product_id),
      product_name: toSafeString(r.product_name),
      stock: toSafeNumber(r.stock),
      min_stock: toSafeNumber(r.min_stock),
      cost_price: toSafeNumber(r.cost_price),
      sale_price: toSafeNumber(r.sale_price),
      stock_value_cost: toSafeNumber(r.stock_value_cost),
      stock_value_sale: toSafeNumber(r.stock_value_sale),
    }));
  }

  function normalizeInventorySummary(row: Record<string, unknown>): InventorySummary {
    return {
      total_products: toSafeInt(row.total_products),
      total_active: toSafeInt(row.total_active),
      total_stock_units: toSafeNumber(row.total_stock_units),
      total_value_cost: toSafeNumber(row.total_value_cost),
      total_value_sale: toSafeNumber(row.total_value_sale),
      low_stock_count: toSafeInt(row.low_stock_count),
    };
  }

  function normalizeCreditsOverviewRows(rows: Array<Record<string, unknown>>): CreditsOverviewRow[] {
    return rows.map((r) => ({
      status: toSafeString(r.status),
      count: toSafeInt(r.count),
      total_due: toSafeNumber(r.total_due),
      total_paid: toSafeNumber(r.total_paid),
      total_remaining: toSafeNumber(r.total_remaining),
    }));
  }

  // Reports
  ipcMain.handle(IPC_CHANNELS.REPORTS_SALES_BY_DATE, (_, startDate: string, endDate: string) => {
    return cloudApi.getSalesByDate(startDate, endDate).then((rows) => {
      return normalizeDailySalesRows(rows);
    });
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_TOP_PRODUCTS, (_, startDate: string, endDate: string, limit?: number) => {
    return cloudApi.getTopProducts(startDate, endDate, limit).then((rows) => {
      return normalizeTopProductRows(rows);
    });
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_PROFIT, (_, startDate: string, endDate: string) => {
    return cloudApi.getProfitReport(startDate, endDate).then((rows) => {
      return normalizeProfitRows(rows);
    });
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY, () => {
    return cloudApi.getInventoryReport().then((rows) => {
      return normalizeInventoryRows(rows);
    });
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY_SUMMARY, () => {
    return cloudApi.getInventorySummary().then((row) => {
      return normalizeInventorySummary(row);
    });
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW, () => {
    return cloudApi.getCreditsOverview().then((rows) => {
      return normalizeCreditsOverviewRows(rows);
    });
  });

  // Reports - Paginated endpoints (Phase 4)
  ipcMain.handle(
    IPC_CHANNELS.REPORTS_INVENTORY_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getReportPaginated(
        cloudApi.getInventoryReport().then((rows) => normalizeInventoryRows(rows)),
        {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS_PROFIT_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getReportPaginated(
        cloudApi.getProfitReport(
          typeof q.dateFrom === 'string' ? q.dateFrom : '1970-01-01',
          typeof q.dateTo === 'string' ? q.dateTo : '9999-12-31'
        ).then((rows) => normalizeProfitRows(rows)),
        {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS_TOP_PRODUCTS_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getReportPaginated(
        cloudApi.getTopProducts(
          typeof q.dateFrom === 'string' ? q.dateFrom : '1970-01-01',
          typeof q.dateTo === 'string' ? q.dateTo : '9999-12-31'
        ).then((rows) => normalizeTopProductRows(rows)),
        {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      return cloudApi.getReportPaginated(
        cloudApi.getCreditsOverview().then((rows) => normalizeCreditsOverviewRows(rows)),
        {
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 25,
          sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
        }
      );
    }
  );

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_, key: string) => {
    const section = getCloudSettingsSectionByKey(key);
    if (!section) throw new Error('Clave de configuración inválida');
    return (await cloudApi.getSettingsSection(section)).values[key];
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    const sections = Object.keys(CLOUD_SETTINGS_SECTION_KEYS) as CloudSettingsSection[];
    const results = await Promise.all(sections.map(section => cloudApi.getSettingsSection(section)));
    return results.flatMap(result => Object.entries(result.values).map(([key, value]) => ({ key, value })));
  });
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_SECTION,
    async (_, section: CloudSettingsSection, entries: Array<{ key: string; value: string }>) => {
      if (!Object.prototype.hasOwnProperty.call(CLOUD_SETTINGS_SECTION_KEYS, section)) throw new Error('Sección inválida');
      const keys = CLOUD_SETTINGS_SECTION_KEYS[section];
      if (!Array.isArray(entries) || !entries.length || entries.length > keys.length) {
        throw new Error('Configuración inválida');
      }
      const values: Record<string, string> = {};
      for (const entry of entries) {
        if (!entry || !keys.includes(entry.key) || typeof entry.value !== 'string' || entry.value.length > 4096) {
          throw new Error('Entrada de configuración inválida');
        }
        values[entry.key] = entry.value;
      }
      await cloudApi.updateSettingsSection(section, values);
    }
  );
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CLOUD_API_KEY, async (_, value: string) => {
    if (typeof value !== 'string') {
      throw new Error('La API key debe ser texto');
    }
    const write = cloudKeyWrite.then(() => setCloudApiKeySecret(value));
    // Keep subsequent writes ordered even if this caller receives an error.
    cloudKeyWrite = write.catch(() => {});
    await write;
    lastCloudHealthStatus = null;
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_HAS_CLOUD_API_KEY, () => hasCloudApiKeySecret());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CHECK_CLOUD_HEALTH, async () => {
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
  registerIpcHandlers();
  if (getAwsRecoveryConfig().aws_api_base_url && hasCloudApiKeySecret()) {
    void cloudApi.checkOverdueCredits().catch(() => {
      console.warn('Cloud overdue credit check unavailable');
    });
  }
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
