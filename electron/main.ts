import { app, BrowserWindow, ipcMain } from 'electron';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server URL or built file path
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(__dirname, '../dist');

let mainWindow: BrowserWindow | null = null;

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
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_ALL, () => categoriesRepo.getAllCategories());
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_GET_BY_ID, (_, id: number) => categoriesRepo.getCategoryById(id));
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_CREATE, (_, data) => categoriesRepo.createCategory(data));
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_UPDATE, (_, id: number, data) => categoriesRepo.updateCategory(id, data));
  ipcMain.handle(IPC_CHANNELS.CATEGORIES_DELETE, (_, id: number) => categoriesRepo.deleteCategory(id));

  // Products
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_ALL, () => productsRepo.getAllProducts());
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_ID, (_, id: number) => productsRepo.getProductById(id));
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_GET_BY_BARCODE, (_, barcode: string) => productsRepo.getProductByBarcode(barcode));
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_SEARCH, (_, query: string) => productsRepo.searchProducts(query));
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_LOW_STOCK, () => productsRepo.getLowStockProducts());
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CREATE, (_, data) => productsRepo.createProduct(data));
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_UPDATE, (_, id: number, data) => productsRepo.updateProduct(id, data));
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE, (_, id: number) => productsRepo.deleteProduct(id));
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_CAN_DELETE_PERMANENTLY, (_, id: number) =>
    productsRepo.canDeleteProductPermanently(id)
  );
  ipcMain.handle(IPC_CHANNELS.PRODUCTS_DELETE_PERMANENTLY, (_, id: number) =>
    productsRepo.deleteProductPermanently(id)
  );

  // Customers
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_ALL, () => customersRepo.getAllCustomers());
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, (_, id: number) => customersRepo.getCustomerById(id));
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_CREATE, (_, data) => customersRepo.createCustomer(data));
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_UPDATE, (_, id: number, data) => customersRepo.updateCustomer(id, data));
  ipcMain.handle(IPC_CHANNELS.CUSTOMERS_DELETE, (_, id: number) => customersRepo.deleteCustomer(id));

  // Sales
  ipcMain.handle(IPC_CHANNELS.SALES_CREATE, (_, data) => salesRepo.createSale(data));
  ipcMain.handle(IPC_CHANNELS.SALES_GET_ALL, (_, limit?: number, offset?: number) => salesRepo.getAllSales(limit, offset));
  ipcMain.handle(IPC_CHANNELS.SALES_GET_BY_ID, (_, id: number) => salesRepo.getSaleById(id));
  ipcMain.handle(IPC_CHANNELS.SALES_GET_DETAIL, (_, id: number) => salesRepo.getSaleDetailById(id));

  // Sales - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.SALES_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
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
      return salesRepo.getSalesSummary({
        search: typeof q.search === 'string' ? q.search.slice(0, 200) : undefined,
        type: typeof q.type === 'string' ? q.type : undefined,
        dateFrom: typeof q.dateFrom === 'string' ? q.dateFrom : undefined,
        dateTo: typeof q.dateTo === 'string' ? q.dateTo : undefined,
      });
    }
  );

  // Credits
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_ALL, (_, status?: string) => creditsRepo.getAllCredits(status));
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_ID, (_, id: number) => creditsRepo.getCreditById(id));
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER, (_, customerId: number) => creditsRepo.getCreditsByCustomer(customerId));
  ipcMain.handle(IPC_CHANNELS.CREDITS_ADD_PAYMENT, (_, creditId: number, amount: number) => creditsRepo.addCreditPayment(creditId, amount));
  ipcMain.handle(IPC_CHANNELS.CREDITS_GET_PAYMENTS, (_, creditId: number) => creditsRepo.getCreditPayments(creditId));
  ipcMain.handle(IPC_CHANNELS.CREDITS_CHECK_OVERDUE, () => creditsRepo.checkOverdueCredits());

  // Inventory
  ipcMain.handle(IPC_CHANNELS.INVENTORY_ADD_MOVEMENT, (_, data) => inventoryRepo.addInventoryMovement(data));
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT, (_, productId: number) => inventoryRepo.getMovementsByProduct(productId));
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_ALL, (_, limit?: number, offset?: number) => inventoryRepo.getAllMovements(limit, offset));

  // Inventory - Paginated endpoints (Phase 2)
  ipcMain.handle(
    IPC_CHANNELS.INVENTORY_GET_ALL_PAGINATED,
    (_, query: unknown) => {
      const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
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
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_OPEN, (_, data) => cashRegisterRepo.openPeriod(data));
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_CLOSE, (_, id: number, closingCash: number, endDate: string) => cashRegisterRepo.closePeriod(id, closingCash, endDate));
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_CURRENT, () => cashRegisterRepo.getCurrentPeriod());
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_ALL, () => cashRegisterRepo.getAllPeriods());
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_ADD_MOVEMENT, (_, data) => cashRegisterRepo.addCashMovement(data));
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS, (_, cashRegisterId: number) => cashRegisterRepo.getMovementsByPeriod(cashRegisterId));
  ipcMain.handle(IPC_CHANNELS.CASH_REGISTER_GET_SALES_SUMMARY, (_, cashRegisterId: number) => cashRegisterRepo.getSalesSummaryByPeriod(cashRegisterId));
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_SALES,
    (_, cashRegisterId: number, limit?: number, offset?: number) => cashRegisterRepo.getSalesByPeriod(cashRegisterId, limit, offset)
  );
  ipcMain.handle(
    IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS,
    (_, cashRegisterId: number, limit?: number, offset?: number) =>
      cashRegisterRepo.getCreditPaymentsByPeriod(cashRegisterId, limit, offset)
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
  ipcMain.handle(IPC_CHANNELS.REPORTS_SALES_BY_DATE, (_, startDate: string, endDate: string) => reportsRepo.getSalesByDateRange(startDate, endDate));
  ipcMain.handle(IPC_CHANNELS.REPORTS_TOP_PRODUCTS, (_, startDate: string, endDate: string, limit?: number) => reportsRepo.getTopProducts(startDate, endDate, limit));
  ipcMain.handle(IPC_CHANNELS.REPORTS_PROFIT, (_, startDate: string, endDate: string) => reportsRepo.getProfitReport(startDate, endDate));
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY, () => reportsRepo.getInventoryReport());
  ipcMain.handle(IPC_CHANNELS.REPORTS_INVENTORY_SUMMARY, () => reportsRepo.getInventorySummary());
  ipcMain.handle(IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW, () => reportsRepo.getCreditsOverview());

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_, key: string) => settingsRepo.getSetting(key));
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => settingsRepo.getAllSettings());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_, key: string, value: string) => settingsRepo.setSetting(key, value));

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
}

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
