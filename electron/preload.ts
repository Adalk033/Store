import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../src/lib/ipcChannels';

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
  },

  // Sales
  sales: {
    create: (data: {
      sale_type: 'cash' | 'credit';
      customer_id?: number | null;
      items: Array<{ product_id: number; quantity: number; unit_price: number }>;
      cash_register_id?: number | null;
      credit_days?: number;
      surcharge_percent?: number;
    }) => ipcRenderer.invoke(IPC_CHANNELS.SALES_CREATE, data),
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_ALL, limit, offset),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SALES_GET_BY_ID, id),
  },

  // Credits
  credits: {
    getAll: (status?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_ALL, status),
    getById: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_BY_ID, id),
    getByCustomer: (customerId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_BY_CUSTOMER, customerId),
    addPayment: (creditId: number, amount: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_ADD_PAYMENT, creditId, amount),
    getPayments: (creditId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CREDITS_GET_PAYMENTS, creditId),
    checkOverdue: () => ipcRenderer.invoke(IPC_CHANNELS.CREDITS_CHECK_OVERDUE),
  },

  // Inventory
  inventory: {
    addMovement: (data: {
      product_id: number;
      type: 'in' | 'out' | 'adjustment';
      quantity: number;
      reference_id?: number | null;
      notes?: string | null;
    }) => ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_ADD_MOVEMENT, data),
    getByProduct: (productId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_BY_PRODUCT, productId),
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_ALL, limit, offset),
  },

  // Cash Register
  cashRegister: {
    open: (data: { period_name: string; start_date: string; opening_cash: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_OPEN, data),
    close: (id: number, closingCash: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_CLOSE, id, closingCash),
    getCurrent: () => ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_CURRENT),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_GET_ALL),
    addMovement: (data: {
      cash_register_id: number;
      type: 'expense' | 'withdrawal' | 'deposit';
      amount: number;
      description?: string | null;
    }) => ipcRenderer.invoke(IPC_CHANNELS.CASH_REGISTER_ADD_MOVEMENT, data),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    set: (key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI;
