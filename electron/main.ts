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

const CLOUD_API_KEY_FILE = 'cloud-api-key.bin';

function getCloudApiKeyPath(): string {
  return path.join(app.getPath('userData'), CLOUD_API_KEY_FILE);
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

function isCloudEnabled(): boolean {
  return settingsRepo.getSetting('aws_enabled') === '1';
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
  const baseUrl = (settingsRepo.getSetting('aws_api_base_url') || '').trim();
  const awsEnv = (settingsRepo.getSetting('aws_env') || 'prod').trim();
  const timeoutMs = Number(settingsRepo.getSetting('aws_timeout_ms') || '5000');
  const retryMax = Number(settingsRepo.getSetting('aws_retry_max') || '2');
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

const cloudApi = new CloudApi(getCloudApiConfig);

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
    if (isCloudEnabled()) {
      return cloudApi.getCategories();
    }
    return categoriesRepo.getAllCategories();
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_BY_ID, async (_, id: number) => {
    if (isCloudEnabled()) {
      const categories = await cloudApi.getCategories();
      return categories.find((c) => c.id === id);
    }
    return categoriesRepo.getCategoryById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_CREATE, (_, data) => {
    if (isCloudEnabled()) {
      return cloudApi.createCategory(data);
    }
    return categoriesRepo.createCategory(data);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_UPDATE, (_, id: number, data) => {
    if (isCloudEnabled()) {
      return cloudApi.updateCategory(id, data);
    }
    return categoriesRepo.updateCategory(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_DELETE, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.deleteCategory(id);
    }
    return categoriesRepo.deleteCategory(id);
  });

  // Products
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_ALL, () => {
    if (isCloudEnabled()) {
      return cloudApi.getProducts();
    }
    return productsRepo.getAllProducts();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_ID, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getProductById(id);
    }
    return productsRepo.getProductById(id);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_BARCODE, (_, barcode: string) => {
    if (isCloudEnabled()) {
      return cloudApi.getProductByBarcode(barcode);
    }
    return productsRepo.getProductByBarcode(barcode);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_SEARCH, (_, query: string) => {
    if (isCloudEnabled()) {
      return cloudApi.getProducts({ search: query });
    }
    return productsRepo.searchProducts(query);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_LOW_STOCK, () => {
    if (isCloudEnabled()) {
      return cloudApi.getLowStockProducts();
    }
    return productsRepo.getLowStockProducts();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CREATE, (_, data) => {
    if (isCloudEnabled()) {
      return cloudApi.createProduct(data);
    }
    return productsRepo.createProduct(data);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_UPDATE, (_, id: number, data) => {
    if (isCloudEnabled()) {
      return cloudApi.updateProduct(id, data);
    }
    return productsRepo.updateProduct(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.deleteProduct(id);
    }
    return productsRepo.deleteProduct(id);
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CAN_DELETE_PERMANENTLY, (_, id: number) =>
    isCloudEnabled() ? cloudApi.canDeleteProductPermanently(id) : productsRepo.canDeleteProductPermanently(id)
  );
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE_PERMANENTLY, (_, id: number) =>
    isCloudEnabled() ? cloudApi.deleteProductPermanently(id) : productsRepo.deleteProductPermanently(id)
  );

  // Products - Paginated endpoint (Phase 4)
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (isCloudEnabled()) {
        return cloudApi.getProductsPaginated({
          page: typeof q.page === 'number' ? q.page : 1,
          pageSize: typeof q.pageSize === 'number' ? q.pageSize : 50,
          search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
          status: typeof q.status === 'string' ? q.status : undefined,
          categoryId: typeof q.categoryId === 'number' ? q.categoryId : undefined,
          lowStock: typeof q.lowStock === 'boolean' ? q.lowStock : undefined,
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
        sort: typeof q.sort === 'object' && q.sort !== null ? q.sort as { field: string; direction: 'ASC' | 'DESC' } : undefined,
      });
    }
  );

  // Customers
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_ALL, () => {
    if (isCloudEnabled()) {
      return cloudApi.getCustomers({ status: 'active' });
    }
    return customersRepo.getAllCustomers();
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getCustomerById(id);
    }
    return customersRepo.getCustomerById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_CREATE, (_, data) => {
    if (isCloudEnabled()) {
      return cloudApi.createCustomer(data);
    }
    return customersRepo.createCustomer(data);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_UPDATE, (_, id: number, data) => {
    if (isCloudEnabled()) {
      return cloudApi.updateCustomer(id, data);
    }
    return customersRepo.updateCustomer(id, data);
  });
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_DELETE, (_, id: number) => {
    if (isCloudEnabled()) {
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

      if (isCloudEnabled()) {
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
    if (isCloudEnabled()) {
      return cloudApi.createSale(data);
    }
    const result = salesRepo.createSale(data);
    return result.data;
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_ALL, async (_, limit?: number, offset?: number) => {
    if (isCloudEnabled()) {
      const items = await cloudApi.getSales();
      if (typeof limit === 'number' && typeof offset === 'number') {
        return items.slice(offset, offset + limit);
      }
      return items;
    }
    return salesRepo.getAllSales(limit, offset);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_BY_ID, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getSaleById(id);
    }
    return salesRepo.getSaleById(id);
  });
  ipcMain.handle(IPC_CHANNELS.SALES_GET_DETAIL, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getSaleDetailById(id);
    }
    return salesRepo.getSaleDetailById(id);
  });

  // Sales - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
    if (isCloudEnabled()) {
      return cloudApi.getCredits(status);
    }
    return creditsRepo.getAllCredits(status);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_ID, (_, id: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getCreditById(id);
    }
    return creditsRepo.getCreditById(id);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER, (_, customerId: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getCreditsByCustomer(customerId);
    }
    return creditsRepo.getCreditsByCustomer(customerId);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_ADD_PAYMENT, (_, creditId: number, amount: number, idempotencyKey?: string) => {
    if (isCloudEnabled()) {
      return cloudApi.addCreditPayment(creditId, amount, idempotencyKey);
    }
    const result = creditsRepo.addCreditPayment(creditId, amount, idempotencyKey);
    return result.data;
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_PAYMENTS, (_, creditId: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getCreditPayments(creditId);
    }
    return creditsRepo.getCreditPayments(creditId);
  });
  ipcMain.handle(IPC_CHANNELS.CREDITS_CHECK_OVERDUE, () => {
    if (isCloudEnabled()) {
      return cloudApi.checkOverdueCredits();
    }
    return creditsRepo.checkOverdueCredits();
  });

  // Credits - Paginated endpoints (Phase 3)
  ipcMain.handle(
    IPC_CHANNELS.CREDITS_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
    if (isCloudEnabled()) {
      return cloudApi.addInventoryMovement(data);
    }
    return inventoryRepo.addInventoryMovement(data);
  });
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT, (_, productId: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getInventoryMovementsByProduct(productId);
    }
    return inventoryRepo.getMovementsByProduct(productId);
  });
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_ALL, async (_, limit?: number, offset?: number) => {
    if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
    if (isCloudEnabled()) {
      return cloudApi.openCashRegister(data);
    }
    return cashRegisterRepo.openPeriod(data);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_CLOSE, (_, id: number, closingCash: number, endDate: string, expectedVersion?: number) => {
    if (isCloudEnabled()) {
      void expectedVersion;
      return cloudApi.closeCashRegister({ id, closing_cash: closingCash, end_date: endDate });
    }
    return cashRegisterRepo.closePeriod(id, closingCash, endDate, expectedVersion);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_CURRENT, () => {
    if (isCloudEnabled()) {
      return cloudApi.getCurrentCashRegister();
    }
    return cashRegisterRepo.getCurrentPeriod();
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_ALL, () => {
    if (isCloudEnabled()) {
      return cloudApi.getCashRegisterPeriods();
    }
    return cashRegisterRepo.getAllPeriods();
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_ADD_MOVEMENT, (_, data) => {
    if (isCloudEnabled()) {
      return cloudApi.addCashMovement(data);
    }
    const result = cashRegisterRepo.addCashMovement(data);
    return result.data;
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS, (_, cashRegisterId: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getCashMovements(cashRegisterId);
    }
    return cashRegisterRepo.getMovementsByPeriod(cashRegisterId);
  });
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_SALES_SUMMARY, (_, cashRegisterId: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getCashRegisterSalesSummary(cashRegisterId);
    }
    return cashRegisterRepo.getSalesSummaryByPeriod(cashRegisterId);
  });
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_SALES,
    async (_, cashRegisterId: number, limit?: number, offset?: number) => {
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
    if (isCloudEnabled()) {
      return cloudApi.getSalesByDate(startDate, endDate);
    }
    return reportsRepo.getSalesByDateRange(startDate, endDate);
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_TOP_PRODUCTS, (_, startDate: string, endDate: string, limit?: number) => {
    if (isCloudEnabled()) {
      return cloudApi.getTopProducts(startDate, endDate, limit);
    }
    return reportsRepo.getTopProducts(startDate, endDate, limit);
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_PROFIT, (_, startDate: string, endDate: string) => {
    if (isCloudEnabled()) {
      return cloudApi.getProfitReport(startDate, endDate);
    }
    return reportsRepo.getProfitReport(startDate, endDate);
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY, () => {
    if (isCloudEnabled()) {
      return cloudApi.getInventoryReport();
    }
    return reportsRepo.getInventoryReport();
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY_SUMMARY, () => {
    if (isCloudEnabled()) {
      return cloudApi.getInventorySummary();
    }
    return reportsRepo.getInventorySummary();
  });
  ipcMain.handle(IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW, () => {
    if (isCloudEnabled()) {
      return cloudApi.getCreditsOverview();
    }
    return reportsRepo.getCreditsOverview();
  });

  // Reports - Paginated endpoints (Phase 4)
  ipcMain.handle(
    IPC_CHANNELS.REPORTS_INVENTORY_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
      if (isCloudEnabled()) {
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
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_, key: string) => settingsRepo.getSetting(key));
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => settingsRepo.getAllSettings());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_, key: string, value: string) => settingsRepo.setSetting(key, value));
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CLOUD_API_KEY, (_, value: string) => {
    if (typeof value !== 'string') {
      throw new Error('La API key debe ser texto');
    }
    setCloudApiKeySecret(value);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_HAS_CLOUD_API_KEY, () => hasCloudApiKeySecret());

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
