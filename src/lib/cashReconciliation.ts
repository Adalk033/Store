import type { CashRegisterPeriod } from '../types/database';

export function expectedCashInPeriod(period: CashRegisterPeriod): number {
  const cents = (amount: number) => Math.round(amount * 100);
  return (cents(period.opening_cash) + cents(period.total_cash_sales) + cents(period.total_credit_collected)
    + cents(period.total_deposits) - cents(period.total_expenses) - cents(period.total_withdrawals)) / 100;
}
