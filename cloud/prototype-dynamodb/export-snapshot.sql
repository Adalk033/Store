\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '750ms';
SET LOCAL TIME ZONE 'UTC';

WITH source_table(name, records) AS (
  SELECT 'categories', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.categories t UNION ALL
  SELECT 'products', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t UNION ALL
  SELECT 'customers', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customers t UNION ALL
  SELECT 'cash_register_periods', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_register_periods t UNION ALL
  SELECT 'cash_register_corrections', jsonb_agg(to_jsonb(t) ORDER BY operation_id) FROM public.cash_register_corrections t UNION ALL
  SELECT 'sales', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t UNION ALL
  SELECT 'sale_items', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sale_items t UNION ALL
  SELECT 'credits', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.credits t UNION ALL
  SELECT 'credit_payments', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.credit_payments t UNION ALL
  SELECT 'inventory_movements', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t UNION ALL
  SELECT 'cash_movements', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_movements t UNION ALL
  SELECT 'settings', jsonb_agg(to_jsonb(t) ORDER BY key) FROM public.settings t UNION ALL
  SELECT 'data_versions', jsonb_agg(to_jsonb(t) ORDER BY module) FROM public.data_versions t
), identity_tables(name) AS (
  VALUES ('categories'), ('products'), ('customers'), ('cash_register_periods'), ('sales'),
    ('sale_items'), ('credits'), ('credit_payments'), ('inventory_movements'), ('cash_movements')
), zone AS (
  SELECT COALESCE(
    (SELECT NULLIF(value,'') FROM public.settings WHERE key='business_timezone'),
    (SELECT NULLIF(value,'') FROM public.settings WHERE key='business_time_zone'),
    'America/Mexico_City'
  ) name
), sale_totals AS (
  SELECT cash_register_id,
    SUM(total) FILTER (WHERE sale_type='cash') cash,
    SUM(total) FILTER (WHERE sale_type='credit') credit
  FROM public.sales GROUP BY cash_register_id
), payment_totals AS (
  SELECT cash_register_id, SUM(amount) amount FROM public.credit_payments GROUP BY cash_register_id
), movement_totals AS (
  SELECT cash_register_id,
    SUM(amount) FILTER (WHERE type='expense') expense,
    SUM(amount) FILTER (WHERE type='deposit') deposit,
    SUM(amount) FILTER (WHERE type='withdrawal') withdrawal
  FROM public.cash_movements GROUP BY cash_register_id
), cash AS (
  SELECT c.id,
    COALESCE(s.cash,0) total_cash_sales, COALESCE(s.credit,0) total_credit_sales,
    COALESCE(p.amount,0) total_credit_collected, COALESCE(m.expense,0) total_expenses,
    COALESCE(m.deposit,0) total_deposits, COALESCE(m.withdrawal,0) total_withdrawals
  FROM public.cash_register_periods c
  LEFT JOIN sale_totals s ON s.cash_register_id=c.id
  LEFT JOIN payment_totals p ON p.cash_register_id=c.id
  LEFT JOIN movement_totals m ON m.cash_register_id=c.id
), daily AS (
  SELECT (s.created_at AT TIME ZONE zone.name)::date AS date,
    COUNT(*) AS count,
    COALESCE(SUM(s.total) FILTER (WHERE s.sale_type='cash'),0) total_cash,
    COALESCE(SUM(s.total) FILTER (WHERE s.sale_type='credit'),0) total_credit
  FROM public.sales s CROSS JOIN zone GROUP BY 1
)
SELECT jsonb_build_object(
  'exportedAt', transaction_timestamp(),
  'sourceEngineVersion', current_setting('server_version'),
  'rows', (SELECT jsonb_object_agg(name, COALESCE(records,'[]'::jsonb)) FROM source_table),
  'sequences', (SELECT jsonb_object_agg(i.name,s.last_value)
    FROM identity_tables i
    LEFT JOIN pg_sequences s ON to_regclass(format('%I.%I',s.schemaname,s.sequencename))
      = to_regclass(pg_get_serial_sequence(format('%I.%I','public',i.name),'id'))),
  'cash', COALESCE((SELECT jsonb_agg(to_jsonb(cash) ORDER BY id) FROM cash),'[]'::jsonb),
  'daily', COALESCE((SELECT jsonb_agg(to_jsonb(daily) ORDER BY date) FROM daily),'[]'::jsonb)
);
COMMIT;
