import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../src/lib/ipcChannels';
import type { PaginatedQuery, CursorPaginatedQuery, CustomersPaginatedQuery } from '../src/types/database';

// Typed API exposed to the renderer process
const electronAPI = {
  // Categories
  categories: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_GET_ALL),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_GET_BY_ID, id),
    create: (data: { name: string; parent_id?: number | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_CREATE, data),
    update: (id: number, data: { name?: string; parent_id?: number | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_UPDATE, id, data),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_DELETE, id),
  },

  // Products
  products: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_GET_ALL),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_GET_BY_ID, id),
    getByBarcode: (barcode: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_GET_BY_BARCODE, barcode),
    search: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_SEARCH, query),
    lowStock: () => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_LOW_STOCK),
    create: (data: {
      barcode: string;
      name: string;
      description?: string | null;
      category_id?: number | null;
      cost_price: number;
      margin_percent: number;
      stock?: number;
      min_stock?: number;
    }) => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_CREATE, data),
    update: (id: number, data: {
      name?: string;
      description?: string | null;
      category_id?: number | null;
      cost_price?: number;
      margin_percent?: number;
      min_stock?: number;
      is_active?: number;
    }) => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_UPDATE, id, data),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_DELETE, id),
    canDeletePermanently: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_CAN_DELETE_PERMANENTLY, id),
    deletePermanently: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_DELETE_PERMANENTLY, id),
    getAllPaginated: (query: PaginatedQuery & { categoryId?: number; lowStock?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRODUCTS_GET_ALL_PAGINATED, query),
  },

  // Customers
  customers: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CUSTOMERS_GET_ALL),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.CUSTOMERS_GET_BY_ID, id),
    create: (data: { name: string; phone?: string | null; email?: string | null; notes?: string | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CUSTOMERS_CREATE, data),
    update: (id: number, data: { name?: string; phone?: string | null; email?: string | null; notes?: string | null; is_active?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CUSTOMERS_UPDATE, id, data),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.CUSTOMERS_DELETE, id),
    getAllPaginated: (query: CustomersPaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CUSTOMERS_GET_ALL_PAGINATED, query),
  },

  // Sales
  sales: {
    create: (data: {
      sale_type: 'cash' | 'credit';
      customer_id?: number | null;
      sale_date?: string;
      items: Array<{ product_id: number; quantity: number; unit_price: number }>;
      cash_register_id?: number | null;
      credit_days?: number;
      surcharge_percent?: number;
      initial_payment?: number;
      cash_received?: number;
      cash_change?: number;
      idempotency_key?: string;
    }) => ipcRenderer.invoke(IPC_CHANNELS.SALES_CREATE, data),
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_ALL, limit, offset),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_BY_ID, id),
    getDetail: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_DETAIL, id),
    getAllPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_ALL_PAGINATED, query),
    getSummary: (query: { search?: string; type?: string; dateFrom?: string; dateTo?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_SUMMARY, query),
    getAllCursor: (query: CursorPaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_ALL_CURSOR, query),
  },

  // Credits
  credits: {
    getAll: (status?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_ALL, status),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_BY_ID, id),
    getByCustomer: (customerId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER, customerId),
    addPayment: (creditId: number, amount: number, idempotencyKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_ADD_PAYMENT, creditId, amount, idempotencyKey),
    getPayments: (creditId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_PAYMENTS, creditId),
    checkOverdue: () => ipcRenderer.invoke(IPC_CHANNELS.CREDITS_CHECK_OVERDUE),
    getAllPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_ALL_PAGINATED, query),
    getByCustomerPaginated: (customerId: number, query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER_PAGINATED, customerId, query),
    getPaymentsPaginated: (creditId: number, query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_PAYMENTS_PAGINATED, creditId, query),
    getSummary: (query: { search?: string; status?: string; dateFrom?: string; dateTo?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_SUMMARY, query),
  },

  // Inventory
  inventory: {
    addMovement: (data: {
      product_id: number;
      type: 'in' | 'out' | 'adjustment';
      quantity: number;
      reference_id?: number | null;
      notes?: string | null;
      cost_price?: number;
      margin_percent?: number;
    }) => ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_ADD_MOVEMENT, data),
    getByProduct: (productId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT, productId),
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_ALL, limit, offset),
    getAllPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_ALL_PAGINATED, query),
    getByProductPaginated: (productId: number, query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT_PAGINATED, productId, query),
  },

  // Cash Register
  cashRegister: {
    open: (data: { period_name: string; start_date: string; opening_cash: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_OPEN, data),
    close: (id: number, closingCash: number, endDate: string, expectedVersion?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_CLOSE, id, closingCash, endDate, expectedVersion),
    getCurrent: () => ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_CURRENT),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_ALL),
    addMovement: (data: {
      cash_register_id: number;
      type: 'expense' | 'withdrawal' | 'deposit';
      amount: number;
      description?: string | null;
      idempotency_key?: string;
    }) => ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_ADD_MOVEMENT, data),
    getMovements: (cashRegisterId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS, cashRegisterId),
    getSalesSummary: (cashRegisterId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_SALES_SUMMARY, cashRegisterId),
    getSales: (cashRegisterId: number, limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_SALES, cashRegisterId, limit, offset),
    getCreditPayments: (cashRegisterId: number, limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS, cashRegisterId, limit, offset),
    getSalesPaginated: (cashRegisterId: number, query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_SALES_PAGINATED, cashRegisterId, query),
    getCreditPaymentsPaginated: (cashRegisterId: number, query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_CREDIT_PAYMENTS_PAGINATED, cashRegisterId, query),
    getMovementsPaginated: (cashRegisterId: number, query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_MOVEMENTS_PAGINATED, cashRegisterId, query),
    getAllPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_ALL_PAGINATED, query),
  },

  // Reports
  reports: {
    salesByDate: (startDate: string, endDate: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_SALES_BY_DATE, startDate, endDate),
    topProducts: (startDate: string, endDate: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_TOP_PRODUCTS, startDate, endDate, limit),
    profit: (startDate: string, endDate: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_PROFIT, startDate, endDate),
    inventory: () =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_INVENTORY),
    inventorySummary: () =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_INVENTORY_SUMMARY),
    creditsOverview: () =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW),
    inventoryPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_INVENTORY_PAGINATED, query),
    profitPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_PROFIT_PAGINATED, query),
    topProductsPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_TOP_PRODUCTS_PAGINATED, query),
    creditsOverviewPaginated: (query: PaginatedQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPORTS_CREDITS_OVERVIEW_PAGINATED, query),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    set: (key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
    backupDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_BACKUP_DB),
  },

  // Data Versions (Phase 5)
  dataVersions: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_VERSIONS_GET_ALL),
  },

  // Metrics (Phase 5)
  metrics: {
    getSummary: () => ipcRenderer.invoke(IPC_CHANNELS.METRICS_GET_SUMMARY),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI;
