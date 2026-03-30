// Database entity types matching the SQLite schema

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
}

export interface Product {
  id: number;
  barcode: string;
  name: string;
  description: string | null;
  category_id: number | null;
  cost_price: number;
  margin_percent: number;
  sale_price: number; // GENERATED STORED column
  stock: number;
  min_stock: number;
  is_active: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
}

export interface Sale {
  id: number;
  sale_type: 'cash' | 'credit';
  customer_id: number | null;
  subtotal: number;
  surcharge: number;
  total: number;
  cash_register_id: number | null;
  created_at: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  line_total: number; // GENERATED STORED column
}

export interface Credit {
  id: number;
  sale_id: number;
  customer_id: number;
  original_amount: number;
  due_date: string;
  surcharge_percent: number;
  surcharge_applied: number; // 0 or 1
  total_due: number;
  amount_paid: number;
  status: 'pending' | 'overdue' | 'paid';
  paid_at: string | null;
  created_at: string;
}

export interface CreditPayment {
  id: number;
  credit_id: number;
  amount: number;
  created_at: string;
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reference_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface CashRegisterPeriod {
  id: number;
  period_name: string;
  start_date: string;
  end_date: string | null;
  opening_cash: number;
  total_cash_sales: number;
  total_credit_sales: number;
  total_credit_collected: number;
  total_expenses: number;
  closing_cash: number | null;
  status: 'open' | 'closed';
  created_at: string;
}

export interface CashMovement {
  id: number;
  cash_register_id: number;
  type: 'expense' | 'withdrawal' | 'deposit';
  amount: number;
  description: string | null;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}
