// IPC channel constants shared between main and renderer
export const IPC_CHANNELS = {
  // Categories
  CATEGORIES_GET_ALL: 'categories:getAll',
  CATEGORIES_GET_BY_ID: 'categories:getById',
  CATEGORIES_CREATE: 'categories:create',
  CATEGORIES_UPDATE: 'categories:update',
  CATEGORIES_DELETE: 'categories:delete',

  // Products
  PRODUCTS_GET_ALL: 'products:getAll',
  PRODUCTS_GET_BY_ID: 'products:getById',
  PRODUCTS_GET_BY_BARCODE: 'products:getByBarcode',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_CAN_DELETE_PERMANENTLY: 'products:canDeletePermanently',
  PRODUCTS_DELETE_PERMANENTLY: 'products:deletePermanently',
  PRODUCTS_SEARCH: 'products:search',
  PRODUCTS_LOW_STOCK: 'products:lowStock',
  PRODUCTS_GET_ALL_PAGINATED: 'products:getAllPaginated',

  // Customers
  CUSTOMERS_GET_ALL: 'customers:getAll',
  CUSTOMERS_GET_BY_ID: 'customers:getById',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_DELETE: 'customers:delete',
  CUSTOMERS_GET_ALL_PAGINATED: 'customers:getAllPaginated',

  // Sales
  SALES_CREATE: 'sales:create',
  SALES_GET_ALL: 'sales:getAll',
  SALES_GET_BY_ID: 'sales:getById',
  SALES_GET_DETAIL: 'sales:getDetail',
  SALES_GET_ALL_PAGINATED: 'sales:getAllPaginated',
  SALES_GET_SUMMARY: 'sales:getSummary',
  SALES_GET_ALL_CURSOR: 'sales:getAllCursor',

  // Credits
  CREDITS_GET_ALL: 'credits:getAll',
  CREDITS_GET_BY_ID: 'credits:getById',
  CREDITS_GET_BY_CUSTOMER: 'credits:getByCustomer',
  CREDITS_ADD_PAYMENT: 'credits:addPayment',
  CREDITS_GET_PAYMENTS: 'credits:getPayments',
  CREDITS_CHECK_OVERDUE: 'credits:checkOverdue',
  CREDITS_GET_ALL_PAGINATED: 'credits:getAllPaginated',
  CREDITS_GET_BY_CUSTOMER_PAGINATED: 'credits:getByCustomerPaginated',
  CREDITS_GET_PAYMENTS_PAGINATED: 'credits:getPaymentsPaginated',
  CREDITS_GET_SUMMARY: 'credits:getSummary',

  // Inventory
  INVENTORY_ADD_MOVEMENT: 'inventory:addMovement',
  INVENTORY_GET_BY_PRODUCT: 'inventory:getByProduct',
  INVENTORY_GET_ALL: 'inventory:getAll',
  INVENTORY_GET_ALL_PAGINATED: 'inventory:getAllPaginated',
  INVENTORY_GET_BY_PRODUCT_PAGINATED: 'inventory:getByProductPaginated',

  // Cash Register
  CASH_REGISTER_OPEN: 'cashRegister:open',
  CASH_REGISTER_CLOSE: 'cashRegister:close',
  CASH_REGISTER_GET_CURRENT: 'cashRegister:getCurrent',
  CASH_REGISTER_GET_ALL: 'cashRegister:getAll',
  CASH_REGISTER_ADD_MOVEMENT: 'cashRegister:addMovement',
  CASH_REGISTER_GET_MOVEMENTS: 'cashRegister:getMovements',
  CASH_REGISTER_GET_SALES_SUMMARY: 'cashRegister:getSalesSummary',
  CASH_REGISTER_GET_SALES: 'cashRegister:getSales',
  CASH_REGISTER_GET_CREDIT_PAYMENTS: 'cashRegister:getCreditPayments',
  CASH_REGISTER_GET_SALES_PAGINATED: 'cashRegister:getSalesPaginated',
  CASH_REGISTER_GET_CREDIT_PAYMENTS_PAGINATED: 'cashRegister:getCreditPaymentsPaginated',
  CASH_REGISTER_GET_MOVEMENTS_PAGINATED: 'cashRegister:getMovementsPaginated',
  CASH_REGISTER_GET_ALL_PAGINATED: 'cashRegister:getAllPaginated',

  // Reports
  REPORTS_SALES_BY_DATE: 'reports:salesByDate',
  REPORTS_TOP_PRODUCTS: 'reports:topProducts',
  REPORTS_PROFIT: 'reports:profit',
  REPORTS_INVENTORY: 'reports:inventory',
  REPORTS_INVENTORY_SUMMARY: 'reports:inventorySummary',
  REPORTS_CREDITS_OVERVIEW: 'reports:creditsOverview',
  REPORTS_INVENTORY_PAGINATED: 'reports:inventoryPaginated',
  REPORTS_PROFIT_PAGINATED: 'reports:profitPaginated',
  REPORTS_TOP_PRODUCTS_PAGINATED: 'reports:topProductsPaginated',
  REPORTS_CREDITS_OVERVIEW_PAGINATED: 'reports:creditsOverviewPaginated',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SET_SECTION: 'settings:setSection',
  SETTINGS_SET_CLOUD_API_KEY: 'settings:setCloudApiKey',
  SETTINGS_HAS_CLOUD_API_KEY: 'settings:hasCloudApiKey',
  SETTINGS_BACKUP_DB: 'settings:backupDatabase',

  // Data Versions (Phase 5)
  DATA_VERSIONS_GET_ALL: 'dataVersions:getAll',

  // Metrics (Phase 5)
  METRICS_GET_SUMMARY: 'metrics:getSummary',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
