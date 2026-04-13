import pg from "pg";
import crypto from "node:crypto";
const { Pool } = pg;

function getDbSslConfig() {
  return { rejectUnauthorized: false };
  //Se tiene que buscar solucion para agregar el tls, 
  //no se puede quedar asi en produccion, pero por ahora en render no se puede conectar con ssl aunque se configure la base de datos para requerirlo, 
  // //asi que se deja asi para que funcione en render y se puede configurar para usar ssl en otros entornos
  if (process.env.DB_SSL_MODE !== "require") {
    return void 0;
  }

  const caFromPem = (process.env.DB_SSL_CA_PEM || "").trim();
  const caFromBase64 = (process.env.DB_SSL_CA_PEM_B64 || "").trim();

  if (caFromPem) {
    return { rejectUnauthorized: true, ca: caFromPem };
  }

  if (caFromBase64) {
    const decodedCa = Buffer.from(caFromBase64, "base64").toString("utf8").trim();
    if (!decodedCa) {
      throw new Error("DB_SSL_CA_PEM_B64 is configured but decoded CA is empty");
    }
    return { rejectUnauthorized: true, ca: decodedCa };
  }

  return { rejectUnauthorized: true };
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 5,
  idleTimeoutMillis: 3e4,
  connectionTimeoutMillis: 1e4,
  ssl: getDbSslConfig()
});
class HttpError extends Error {
  statusCode;
  code;
  details;
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
function getRequestId(event) {
  const requestContext = event.requestContext;
  return getHeader(event, "x-request-id") || requestContext?.requestId || crypto.randomUUID();
}
function getHeader(event, name) {
  const headers = event.headers || {};
  const direct = headers[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return void 0;
}
function getHttpMethod(event) {
  const requestContext = event.requestContext;
  const method = requestContext?.http?.method || requestContext?.httpMethod;
  if (!method) {
    throw new HttpError(400, "bad_request", "HTTP method is missing in requestContext");
  }
  return method.toUpperCase();
}
function getRequestPath(event) {
  const path = event.rawPath || event.path;
  if (!path) {
    throw new HttpError(400, "bad_request", "Request path is missing");
  }
  return normalizePath(path);
}
function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
function ok(statusCode, data, requestId) {
  return json(statusCode, { ok: true, data, request_id: requestId });
}
function fail(statusCode, code, message, requestId, details) {
  return json(statusCode, {
    ok: false,
    error: { code, message, details, request_id: requestId }
  });
}
function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, "bad_request", "Invalid JSON body");
  }
}
function requirePositiveNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpError(422, "validation_error", `${field} must be > 0`);
  }
  return n;
}
function requireNonNegativeNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpError(422, "validation_error", `${field} must be >= 0`);
  }
  return n;
}

function requireNonNegativeInteger(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new HttpError(422, "validation_error", `${field} must be integer >= 0`);
  }
  return n;
}

function requireMinStock(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || (n < 0 && n !== -1)) {
    throw new HttpError(422, "validation_error", `${field} must be integer >= 0 or -1 to disable alert`);
  }
  return n;
}
function requireString(value, field, max = 255) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(422, "validation_error", `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new HttpError(422, "validation_error", `${field} exceeds max length`);
  }
  return trimmed;
}

function parseDateOnly(value, field) {
  const raw = requireString(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(422, "validation_error", `${field} must be YYYY-MM-DD`);
  }
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new HttpError(422, "validation_error", `${field} is invalid`);
  }
  return raw;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function resolveCreatedAtFromDate(dateOnly, field) {
  if (!dateOnly) {
    return null;
  }
  const validDate = parseDateOnly(dateOnly, field);
  if (validDate > todayDateOnly()) {
    throw new HttpError(422, "validation_error", `${field} cannot be in the future`);
  }
  if (validDate === todayDateOnly()) {
    return null;
  }
  return `${validDate} 00:00:00`;
}

function addDaysToDateOnly(dateOnly, days) {
  const base = new Date(`${dateOnly}T00:00:00`);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}
function normalizePath(rawPath) {
  return rawPath.replace(/\/+$/, "") || "/";
}
function getPathId(path, regex, fieldName) {
  const match = path.match(regex);
  if (!match?.[1]) {
    throw new HttpError(400, "bad_request", `Invalid ${fieldName} in path`);
  }
  const id = Number(match[1]);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(422, "validation_error", `${fieldName} must be integer >= 1`);
  }
  return id;
}

const SETTINGS_SECTION_KEYS = {
  store: ["store_name", "store_address", "store_phone", "ticket_footer_text"],
  products: ["default_margin_percent"],
  credits: ["default_credit_days", "default_surcharge_percent", "business_timezone"]
};

function parseSettingsSection(path) {
  const match = path.match(/^\/v1\/settings\/sections\/(store|products|credits)$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1];
}

function validateSettingValueByKey(key, value) {
  if (typeof value !== "string") {
    throw new HttpError(422, "validation_error", `${key} must be string`);
  }
  const trimmed = value.trim();

  if (key === "default_margin_percent") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new HttpError(422, "validation_error", "default_margin_percent must be >= 0");
    }
    return String(n);
  }

  if (key === "default_credit_days") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
      throw new HttpError(422, "validation_error", "default_credit_days must be integer >= 1");
    }
    return String(n);
  }

  if (key === "default_surcharge_percent") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new HttpError(422, "validation_error", "default_surcharge_percent must be >= 0");
    }
    return String(n);
  }

  if (key === "business_timezone") {
    if (!trimmed) {
      throw new HttpError(422, "validation_error", "business_timezone is required");
    }
    if (trimmed.length > 80) {
      throw new HttpError(422, "validation_error", "business_timezone exceeds max length");
    }
    return trimmed;
  }

  if (key === "store_name") {
    if (!trimmed) {
      throw new HttpError(422, "validation_error", "store_name is required");
    }
    if (trimmed.length > 150) {
      throw new HttpError(422, "validation_error", "store_name exceeds max length");
    }
    return trimmed;
  }

  if (key === "store_address") {
    if (trimmed.length > 255) {
      throw new HttpError(422, "validation_error", "store_address exceeds max length");
    }
    return trimmed;
  }

  if (key === "store_phone") {
    if (trimmed.length > 30) {
      throw new HttpError(422, "validation_error", "store_phone exceeds max length");
    }
    return trimmed;
  }

  if (key === "ticket_footer_text") {
    if (value.length > 300) {
      throw new HttpError(422, "validation_error", "ticket_footer_text exceeds max length");
    }
    return value;
  }

  throw new HttpError(422, "validation_error", `Unsupported setting key: ${key}`);
}
function enforceApiKey(event) {
  const requireKey = (process.env.REQUIRE_API_KEY || "true") === "true";
  if (!requireKey) return;
  const expectedKeys = [
    ...(process.env.EXPECTED_API_KEYS || "").split(",").map((value) => value.trim()).filter(Boolean),
    ...(process.env.EXPECTED_API_KEY || "").split(",").map((value) => value.trim()).filter(Boolean)
  ];

  if (expectedKeys.length === 0) {
    throw new HttpError(500, "misconfiguration", "API key authentication is not configured");
  }

  const expectedSet = new Set(expectedKeys);
  const incoming = (getHeader(event, "x-api-key") || "").trim();
  if (!incoming || !expectedSet.has(incoming)) {
    throw new HttpError(403, "forbidden", "Invalid API key");
  }
}
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
async function getOpenCashRegisterId(client) {
  const r = await client.query("SELECT id FROM cash_register_periods WHERE status = 'open' LIMIT 1");
  if (r.rowCount === 0) {
    throw new HttpError(409, "business_conflict", "No open cash register period");
  }
  return Number(r.rows[0].id);
}
const handler = async (event) => {
  const requestId = getRequestId(event);
  try {
    const method = getHttpMethod(event);
    const path = getRequestPath(event);
    enforceApiKey(event);
    if (method === "GET" && path === "/v1/health") {
      const now = await pool.query("SELECT NOW() AS now");
      return ok(
        200,
        {
          status: "ok",
          service: "pos-api",
          env: process.env.APP_ENV || "prod",
          db_time: now.rows[0].now
        },
        requestId
      );
    }
    if (method === "GET" && path === "/v1/cash-register/current") {
      const r = await pool.query("SELECT * FROM cash_register_periods WHERE status='open' LIMIT 1");
      return ok(200, r.rows[0] || null, requestId);
    }
    if (method === "POST" && path === "/v1/cash-register/open") {
      const body = parseBody(event);
      const periodName = requireString(body.period_name, "period_name");
      const startDate = requireString(body.start_date, "start_date");
      const openingCash = requireNonNegativeNumber(body.opening_cash, "opening_cash");
      const data = await withTx(async (client) => {
        const existing = await client.query("SELECT id FROM cash_register_periods WHERE status='open' LIMIT 1");
        if (existing.rowCount > 0) {
          throw new HttpError(409, "business_conflict", "There is already an open cash register period");
        }
        const ins = await client.query(
          `INSERT INTO cash_register_periods (period_name, start_date, opening_cash, version, status)
           VALUES ($1, $2, $3, 1, 'open')
           RETURNING *`,
          [periodName, startDate, openingCash]
        );
        return ins.rows[0];
      });
      return ok(201, data, requestId);
    }
    if (method === "POST" && path === "/v1/cash-register/close") {
      const body = parseBody(event);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) {
        throw new HttpError(422, "validation_error", "id must be integer >= 1");
      }
      const closingCash = requireNonNegativeNumber(body.closing_cash, "closing_cash");
      const endDate = requireString(body.end_date, "end_date");
      const data = await withTx(async (client) => {
        const open = await client.query(
          "SELECT * FROM cash_register_periods WHERE id = $1 AND status = 'open' LIMIT 1",
          [id]
        );
        if (open.rowCount === 0) {
          throw new HttpError(404, "not_found", "Open period not found");
        }
        const cashSales = await client.query(
          "SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE cash_register_id=$1 AND sale_type='cash'",
          [id]
        );
        const creditSales = await client.query(
          "SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE cash_register_id=$1 AND sale_type='credit'",
          [id]
        );
        const creditCollected = await client.query(
          "SELECT COALESCE(SUM(amount),0) AS total FROM credit_payments WHERE cash_register_id=$1",
          [id]
        );
        const expenses = await client.query(
          "SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE cash_register_id=$1 AND type='expense'",
          [id]
        );
        const upd = await client.query(
          `UPDATE cash_register_periods
           SET end_date=$1,
               total_cash_sales=$2,
               total_credit_sales=$3,
               total_credit_collected=$4,
               total_expenses=$5,
               closing_cash=$6,
               status='closed',
               version=version+1
           WHERE id=$7 AND status='open'
           RETURNING *`,
          [
            endDate,
            Number(cashSales.rows[0].total),
            Number(creditSales.rows[0].total),
            Number(creditCollected.rows[0].total),
            Number(expenses.rows[0].total),
            closingCash,
            id
          ]
        );
        return upd.rows[0];
      });
      return ok(200, data, requestId);
    }
    if (method === "GET" && path === "/v1/cash-register/periods") {
      const r = await pool.query("SELECT * FROM cash_register_periods ORDER BY created_at DESC");
      return ok(200, r.rows, requestId);
    }
    if (method === "POST" && path === "/v1/cash-register/movements") {
      const body = parseBody(event);
      if (!["expense", "withdrawal", "deposit"].includes(body.type)) {
        throw new HttpError(422, "validation_error", "type must be expense|withdrawal|deposit");
      }
      const cashRegisterId = Number(body.cash_register_id);
      if (!Number.isInteger(cashRegisterId) || cashRegisterId < 1) {
        throw new HttpError(422, "validation_error", "cash_register_id must be integer >= 1");
      }
      const amount = requirePositiveNumber(body.amount, "amount");
      const idempotencyKey = body.idempotency_key?.trim() || null;
      const data = await withTx(async (client) => {
        if (idempotencyKey) {
          const existing = await client.query(
            "SELECT * FROM cash_movements WHERE idempotency_key = $1 LIMIT 1",
            [idempotencyKey]
          );
          if (existing.rowCount > 0) {
            return existing.rows[0];
          }
        }
        const ins = await client.query(
          `INSERT INTO cash_movements (cash_register_id, type, amount, description, idempotency_key)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [cashRegisterId, body.type, amount, body.description ?? null, idempotencyKey]
        );
        return ins.rows[0];
      });
      return ok(201, data, requestId);
    }
    if (method === "GET" && /^\/v1\/cash-register\/\d+\/movements$/.test(path)) {
      const cashRegisterId = getPathId(path, /^\/v1\/cash-register\/(\d+)\/movements$/, "id");
      const r = await pool.query(
        "SELECT * FROM cash_movements WHERE cash_register_id = $1 ORDER BY created_at DESC",
        [cashRegisterId]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/cash-register\/\d+\/sales$/.test(path)) {
      const cashRegisterId = getPathId(path, /^\/v1\/cash-register\/(\d+)\/sales$/, "id");
      const r = await pool.query(
        `SELECT
          s.*,
          c.name AS customer_name,
          COALESCE(SUM(si.quantity), 0) AS item_count
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN sale_items si ON si.sale_id = s.id
         WHERE s.cash_register_id = $1
         GROUP BY s.id, c.name
         ORDER BY s.created_at DESC`,
        [cashRegisterId]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/cash-register\/\d+\/credit-payments$/.test(path)) {
      const cashRegisterId = getPathId(path, /^\/v1\/cash-register\/(\d+)\/credit-payments$/, "id");
      const r = await pool.query(
        `SELECT
          cp.*,
          c.sale_id,
          c.customer_id,
          c.status AS credit_status,
          cu.name AS customer_name
         FROM credit_payments cp
         INNER JOIN credits c ON c.id = cp.credit_id
         LEFT JOIN customers cu ON cu.id = c.customer_id
         WHERE cp.cash_register_id = $1
         ORDER BY cp.created_at DESC`,
        [cashRegisterId]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/cash-register\/\d+\/sales-summary$/.test(path)) {
      const cashRegisterId = getPathId(path, /^\/v1\/cash-register\/(\d+)\/sales-summary$/, "id");
      const r = await pool.query(
        `SELECT
          COUNT(*) AS sale_count,
          COALESCE(SUM(CASE WHEN sale_type = 'cash' THEN total ELSE 0 END), 0) AS total_cash_sales,
          COALESCE(SUM(CASE WHEN sale_type = 'credit' THEN total ELSE 0 END), 0) AS total_credit_sales,
          COALESCE((SELECT SUM(amount) FROM credit_payments WHERE cash_register_id = $1), 0) AS total_credit_collected
         FROM sales
         WHERE cash_register_id = $1`,
        [cashRegisterId]
      );
      return ok(200, r.rows[0], requestId);
    }
    if (method === "GET" && path === "/v1/customers") {
      const q = event.queryStringParameters || {};
      const search = (q.search || "").trim().toLowerCase();
      const status = q.status;
      const creditStatus = q.credit_status;
      const where = [];
      const params = [];
      let idx = 1;
      if (status === "active") {
        where.push(`c.is_active = $${idx++}`);
        params.push(1);
      } else if (status === "inactive") {
        where.push(`c.is_active = $${idx++}`);
        params.push(0);
      } else {
        where.push("c.is_active = 1");
      }
      if (search) {
        where.push(`(LOWER(c.name) LIKE $${idx} OR LOWER(COALESCE(c.phone, '')) LIKE $${idx + 1} OR LOWER(COALESCE(c.email, '')) LIKE $${idx + 2})`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        idx += 3;
      }
      if (creditStatus === "withDebt") {
        where.push("COALESCE(cs.total_debt, 0) > 0");
      } else if (creditStatus === "overdue") {
        where.push("COALESCE(cs.overdue_credits, 0) > 0");
      } else if (creditStatus === "withoutCredits") {
        where.push("COALESCE(cs.total_credits, 0) = 0");
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT
          c.*,
          COALESCE(cs.total_credits, 0) AS total_credits,
          COALESCE(cs.active_credits, 0) AS active_credits,
          COALESCE(cs.overdue_credits, 0) AS overdue_credits,
          COALESCE(cs.total_debt, 0) AS total_debt,
          COALESCE(cs.total_paid, 0) AS total_paid,
          cs.last_credit_date
         FROM customers c
         LEFT JOIN (
           SELECT
             customer_id,
             COUNT(*) AS total_credits,
             SUM(CASE WHEN status != 'paid' THEN 1 ELSE 0 END) AS active_credits,
             SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_credits,
             SUM(CASE WHEN status != 'paid' THEN total_due - amount_paid ELSE 0 END) AS total_debt,
             SUM(amount_paid) AS total_paid,
             MAX(created_at) AS last_credit_date
           FROM credits
           GROUP BY customer_id
         ) cs ON cs.customer_id = c.id
         ${whereSql}
         ORDER BY c.name ASC, c.id DESC`,
        params
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/customers\/\d+$/.test(path)) {
      const id = getPathId(path, /^\/v1\/customers\/(\d+)$/, "id");
      const r = await pool.query("SELECT * FROM customers WHERE id = $1 LIMIT 1", [id]);
      return ok(200, r.rows[0] || null, requestId);
    }
    if (method === "POST" && path === "/v1/customers") {
      const body = parseBody(event);
      const name = requireString(body.name, "name", 150);
      const r = await pool.query(
        "INSERT INTO customers (name, phone, email, notes) VALUES ($1, $2, $3, $4) RETURNING *",
        [name, body.phone ?? null, body.email ?? null, body.notes ?? null]
      );
      return ok(201, r.rows[0], requestId);
    }
    if (method === "PUT" && /^\/v1\/customers\/\d+$/.test(path)) {
      const id = getPathId(path, /^\/v1\/customers\/(\d+)$/, "id");
      const body = parseBody(event);
      const setParts = [];
      const values = [];
      let idx = 1;
      if (body.name !== void 0) {
        setParts.push(`name = $${idx++}`);
        values.push(requireString(body.name, "name", 150));
      }
      if (body.phone !== void 0) {
        setParts.push(`phone = $${idx++}`);
        values.push(body.phone ?? null);
      }
      if (body.email !== void 0) {
        setParts.push(`email = $${idx++}`);
        values.push(body.email ?? null);
      }
      if (body.notes !== void 0) {
        setParts.push(`notes = $${idx++}`);
        values.push(body.notes ?? null);
      }
      if (body.is_active !== void 0) {
        setParts.push(`is_active = $${idx++}`);
        values.push(Number(body.is_active) ? 1 : 0);
      }
      if (setParts.length === 0) {
        throw new HttpError(400, "bad_request", "No fields to update");
      }
      values.push(id);
      const r = await pool.query(
        `UPDATE customers SET ${setParts.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (r.rowCount === 0) {
        throw new HttpError(404, "not_found", "Customer not found");
      }
      return ok(200, r.rows[0], requestId);
    }
    if (method === "DELETE" && /^\/v1\/customers\/\d+$/.test(path)) {
      const id = getPathId(path, /^\/v1\/customers\/(\d+)$/, "id");
      const r = await pool.query("UPDATE customers SET is_active = 0 WHERE id = $1", [id]);
      return ok(200, { deleted: r.rowCount > 0 }, requestId);
    }
    if (method === "GET" && path === "/v1/categories") {
      const r = await pool.query("SELECT * FROM categories ORDER BY name ASC");
      return ok(200, r.rows, requestId);
    }
    if (method === "POST" && path === "/v1/categories") {
      const body = parseBody(event);
      const name = requireString(body.name, "name", 150);
      const r = await pool.query(
        "INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING *",
        [name, body.parent_id ?? null]
      );
      return ok(201, r.rows[0], requestId);
    }
    if (method === "PUT" && /^\/v1\/categories\/\d+$/.test(path)) {
      const id = getPathId(path, /^\/v1\/categories\/(\d+)$/, "id");
      const body = parseBody(event);
      const setParts = [];
      const values = [];
      let idx = 1;
      if (body.name !== void 0) {
        setParts.push(`name = $${idx++}`);
        values.push(requireString(body.name, "name", 150));
      }
      if (body.parent_id !== void 0) {
        setParts.push(`parent_id = $${idx++}`);
        values.push(body.parent_id ?? null);
      }
      if (setParts.length === 0) {
        throw new HttpError(400, "bad_request", "No fields to update");
      }
      values.push(id);
      const r = await pool.query(
        `UPDATE categories SET ${setParts.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (r.rowCount === 0) {
        throw new HttpError(404, "not_found", "Category not found");
      }
      return ok(200, r.rows[0], requestId);
    }
    if (method === "DELETE" && /^\/v1\/categories\/\d+$/.test(path)) {
      const id = getPathId(path, /^\/v1\/categories\/(\d+)$/, "id");
      const r = await pool.query("DELETE FROM categories WHERE id = $1", [id]);
      return ok(200, { deleted: r.rowCount > 0 }, requestId);
    }
    if (method === "GET" && path === "/v1/products/low-stock") {
      const r = await pool.query(
        `SELECT p.*, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.min_stock >= 0 AND p.stock <= p.min_stock AND p.is_active = 1
         ORDER BY p.stock ASC, p.name ASC`
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/products\/barcode\/.+/.test(path)) {
      const barcode = decodeURIComponent(path.replace("/v1/products/barcode/", ""));
      const r = await pool.query(
        `SELECT p.*, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.barcode = $1
         LIMIT 1`,
        [barcode]
      );
      return ok(200, r.rows[0] || null, requestId);
    }
    if (method === "GET" && path === "/v1/products") {
      const q = event.queryStringParameters || {};
      const search = (q.search || "").trim();
      const categoryId = q.category_id ? Number(q.category_id) : null;
      const lowStock = q.low_stock === "1" || q.low_stock === "true";
      const where = [];
      const params = [];
      let idx = 1;
      if (search) {
        where.push(
          `(p.name ILIKE $${idx} OR p.barcode ILIKE $${idx + 1} OR COALESCE(p.description, '') ILIKE $${idx + 2})`
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        idx += 3;
      }
      if (Number.isInteger(categoryId) && categoryId > 0) {
        where.push(`p.category_id = $${idx}`);
        params.push(categoryId);
        idx += 1;
      }
      if (lowStock) {
        where.push("p.min_stock >= 0 AND p.stock <= p.min_stock AND p.is_active = 1");
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT p.*, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         ${whereSql}
         ORDER BY p.name ASC`,
        params
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/products\/\d+\/can-delete-permanently$/.test(path)) {
      const id = getPathId(path, /^\/v1\/products\/(\d+)\/can-delete-permanently$/, "id");
      const row = await pool.query(
        "SELECT COUNT(1) AS total FROM sale_items WHERE product_id = $1",
        [id]
      );
      return ok(200, { canDelete: Number(row.rows[0].total) === 0 }, requestId);
    }
    if (method === "DELETE" && /^\/v1\/products\/\d+\/permanent$/.test(path)) {
      const id = getPathId(path, /^\/v1\/products\/(\d+)\/permanent$/, "id");
      const row = await pool.query(
        "SELECT COUNT(1) AS total FROM sale_items WHERE product_id = $1",
        [id]
      );
      if (Number(row.rows[0].total) > 0) {
        throw new HttpError(409, "business_conflict", "No se puede eliminar permanentemente: tiene ventas asociadas");
      }
      const del = await pool.query("DELETE FROM products WHERE id = $1", [id]);
      return ok(200, { deleted: del.rowCount > 0 }, requestId);
    }
    if (method === "GET" && /^\/v1\/products\/\d+$/.test(path)) {
      const productId = getPathId(path, /^\/v1\/products\/(\d+)$/, "id");
      const r = await pool.query(
        `SELECT p.*, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1
         LIMIT 1`,
        [productId]
      );
      return ok(200, r.rows[0] || null, requestId);
    }
    if (method === "POST" && path === "/v1/products") {
      const body = parseBody(event);
      const barcode = requireString(body.barcode, "barcode", 120);
      const name = requireString(body.name, "name", 255);
      const costPrice = requireNonNegativeNumber(body.cost_price, "cost_price");
      const marginPercent = requireNonNegativeNumber(body.margin_percent, "margin_percent");
      const stock = body.stock === void 0 ? 0 : requireNonNegativeInteger(body.stock, "stock");
      const minStock = body.min_stock === void 0 ? 5 : requireMinStock(body.min_stock, "min_stock");
      const r = await pool.query(
        `INSERT INTO products (barcode, name, description, category_id, cost_price, margin_percent, stock, min_stock, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
         RETURNING *`,
        [
          barcode,
          name,
          body.description ?? null,
          body.category_id ?? null,
          costPrice,
          marginPercent,
          stock,
          minStock
        ]
      );
      return ok(201, r.rows[0], requestId);
    }
    if (method === "PUT" && /^\/v1\/products\/\d+$/.test(path)) {
      const productId = getPathId(path, /^\/v1\/products\/(\d+)$/, "id");
      const body = parseBody(event);
      const setParts = [];
      const values = [];
      let idx = 1;
      if (body.name !== void 0) {
        setParts.push(`name = $${idx++}`);
        values.push(requireString(body.name, "name"));
      }
      if (body.description !== void 0) {
        setParts.push(`description = $${idx++}`);
        values.push(body.description ?? null);
      }
      if (body.category_id !== void 0) {
        setParts.push(`category_id = $${idx++}`);
        values.push(body.category_id ?? null);
      }
      if (body.cost_price !== void 0) {
        setParts.push(`cost_price = $${idx++}`);
        values.push(requireNonNegativeNumber(body.cost_price, "cost_price"));
      }
      if (body.margin_percent !== void 0) {
        setParts.push(`margin_percent = $${idx++}`);
        values.push(requireNonNegativeNumber(body.margin_percent, "margin_percent"));
      }
      if (body.min_stock !== void 0) {
        setParts.push(`min_stock = $${idx++}`);
        values.push(requireMinStock(body.min_stock, "min_stock"));
      }
      if (body.is_active !== void 0) {
        setParts.push(`is_active = $${idx++}`);
        values.push(Number(body.is_active) ? 1 : 0);
      }
      if (setParts.length === 0) {
        throw new HttpError(400, "bad_request", "No fields to update");
      }
      values.push(productId);
      const r = await pool.query(
        `UPDATE products SET ${setParts.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (r.rowCount === 0) {
        throw new HttpError(404, "not_found", "Product not found");
      }
      return ok(200, r.rows[0], requestId);
    }
    if (method === "DELETE" && /^\/v1\/products\/\d+$/.test(path)) {
      const productId = getPathId(path, /^\/v1\/products\/(\d+)$/, "id");
      const r = await pool.query("UPDATE products SET is_active = 0 WHERE id = $1", [productId]);
      return ok(200, { deleted: r.rowCount > 0 }, requestId);
    }
    if (method === "POST" && path === "/v1/sales") {
      const body = parseBody(event);
      if (body.sale_type !== "cash" && body.sale_type !== "credit") {
        throw new HttpError(422, "validation_error", "sale_type must be cash or credit");
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        throw new HttpError(422, "validation_error", "items is required");
      }
      const saleCreatedAt = resolveCreatedAtFromDate(body.sale_date, "sale_date");
      const saleDateOnly = saleCreatedAt ? saleCreatedAt.slice(0, 10) : todayDateOnly();
      const idempotencyKey = body.idempotency_key?.trim() || null;
      const data = await withTx(async (client) => {
        if (idempotencyKey) {
          const existing = await client.query(
            "SELECT id FROM sales WHERE idempotency_key = $1 LIMIT 1",
            [idempotencyKey]
          );
          if (existing.rowCount > 0) {
            const sale2 = await client.query("SELECT * FROM sales WHERE id = $1", [existing.rows[0].id]);
            return { created: false, sale: sale2.rows[0] };
          }
        }
        const cashRegisterId = await getOpenCashRegisterId(client);
        let subtotal = 0;
        for (const item of body.items) {
          const qty = requirePositiveNumber(item.quantity, "quantity");
          const unitPrice = requireNonNegativeNumber(item.unit_price, "unit_price");
          subtotal += qty * unitPrice;
          const prod = await client.query("SELECT id, stock FROM products WHERE id = $1 LIMIT 1", [
            item.product_id
          ]);
          if (prod.rowCount === 0) {
            throw new HttpError(404, "not_found", `Product ${item.product_id} not found`);
          }
          if (Number(prod.rows[0].stock) < qty) {
            throw new HttpError(409, "business_conflict", `Insufficient stock for product ${item.product_id}`);
          }
        }
        const saleIns = await client.query(
          `INSERT INTO sales (sale_type, customer_id, subtotal, surcharge, total, cash_received, cash_change, cash_register_id, idempotency_key, created_at)
           VALUES ($1, $2, $3, 0, $3, $4, $5, $6, $7, COALESCE($8::timestamp, NOW()))
           RETURNING *`,
          [
            body.sale_type,
            body.customer_id ?? null,
            subtotal,
            body.sale_type === "cash" ? body.cash_received ?? subtotal : null,
            body.sale_type === "cash" ? body.cash_change ?? 0 : null,
            cashRegisterId,
            idempotencyKey,
            saleCreatedAt
          ]
        );
        const sale = saleIns.rows[0];
        const saleId = Number(sale.id);
        for (const item of body.items) {
          const qty = requirePositiveNumber(item.quantity, "quantity");
          const unitPrice = requireNonNegativeNumber(item.unit_price, "unit_price");
          await client.query(
            "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)",
            [saleId, item.product_id, qty, unitPrice]
          );
          await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [qty, item.product_id]);
          await client.query(
            "INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes, created_at) VALUES ($1, 'out', $2, $3, $4, COALESCE($5::timestamp, NOW()))",
            [item.product_id, -qty, saleId, "Venta automatica", saleCreatedAt]
          );
        }
        if (body.sale_type === "credit") {
          if (!body.customer_id) {
            throw new HttpError(422, "validation_error", "customer_id is required for credit sale");
          }
          const creditDays = body.credit_days ?? 5;
          const surchargePercent = body.surcharge_percent ?? 0;
          const initialPayment = body.initial_payment ?? 0;
          if (creditDays < 1) {
            throw new HttpError(422, "validation_error", "credit_days must be >= 1");
          }
          if (surchargePercent < 0) {
            throw new HttpError(422, "validation_error", "surcharge_percent must be >= 0");
          }
          if (initialPayment < 0 || initialPayment > subtotal) {
            throw new HttpError(422, "validation_error", "initial_payment is out of range");
          }
          const dueDateStr = addDaysToDateOnly(saleDateOnly, creditDays);
          const status = initialPayment >= subtotal ? "paid" : "pending";
          const creditIns = await client.query(
            `INSERT INTO credits (sale_id, customer_id, original_amount, due_date, surcharge_percent, surcharge_applied, total_due, amount_paid, status, paid_at, created_at)
             VALUES ($1, $2, $3, $4, $5, 0, $3, $6, $7, CASE WHEN $7='paid' THEN COALESCE($8::timestamp, NOW()) ELSE NULL END, COALESCE($8::timestamp, NOW()))
             RETURNING *`,
            [saleId, body.customer_id, subtotal, dueDateStr, surchargePercent, initialPayment, status, saleCreatedAt]
          );
          if (initialPayment > 0) {
            await client.query(
              "INSERT INTO credit_payments (credit_id, amount, cash_register_id, created_at) VALUES ($1, $2, $3, COALESCE($4::timestamp, NOW()))",
              [creditIns.rows[0].id, initialPayment, cashRegisterId, saleCreatedAt]
            );
          }
        }
        return { created: true, sale };
      });
      return ok(data.created ? 201 : 200, data, requestId);
    }
    if (method === "DELETE" && /^\/v1\/sales\/\d+$/.test(path)) {
      const saleId = getPathId(path, /^\/v1\/sales\/(\d+)$/, "id");
      const data = await withTx(async (client) => {
        const sale = await client.query("SELECT id FROM sales WHERE id = $1 LIMIT 1", [saleId]);
        if (sale.rowCount === 0) {
          return { deleted: false };
        }

        const items = await client.query(
          "SELECT product_id, quantity FROM sale_items WHERE sale_id = $1",
          [saleId]
        );

        for (const item of items.rows) {
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.product_id]);
          await client.query(
            "INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes) VALUES ($1, 'in', $2, $3, $4)",
            [item.product_id, item.quantity, saleId, "Reversion por eliminacion de venta"]
          );
        }

        await client.query(
          "DELETE FROM credit_payments WHERE credit_id IN (SELECT id FROM credits WHERE sale_id = $1)",
          [saleId]
        );
        await client.query("DELETE FROM credits WHERE sale_id = $1", [saleId]);
        await client.query("DELETE FROM sales WHERE id = $1", [saleId]);

        return { deleted: true };
      });

      return ok(200, data, requestId);
    }
    if (method === "GET" && path === "/v1/sales") {
      const q = event.queryStringParameters || {};
      const dateFrom = q.date_from;
      const dateTo = q.date_to;
      const type = q.type;
      const where = [];
      const params = [];
      let idx = 1;
      if (type && (type === "cash" || type === "credit")) {
        where.push(`s.sale_type = $${idx++}`);
        params.push(type);
      }
      if (dateFrom) {
        where.push(`s.created_at >= $${idx++}`);
        params.push(`${dateFrom} 00:00:00`);
      }
      if (dateTo) {
        where.push(`s.created_at <= $${idx++}`);
        params.push(`${dateTo} 23:59:59`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT
          s.*,
          c.name AS customer_name,
          COALESCE(SUM(si.quantity), 0) AS item_count
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN sale_items si ON si.sale_id = s.id
         ${whereSql}
         GROUP BY s.id, c.name
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 500`,
        params
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/sales/summary") {
      const q = event.queryStringParameters || {};
      const search = (q.search || "").trim().toLowerCase();
      const dateFrom = q.date_from;
      const dateTo = q.date_to;
      const type = q.type;
      const where = [];
      const params = [];
      let idx = 1;
      if (type && (type === "cash" || type === "credit")) {
        where.push(`s.sale_type = $${idx++}`);
        params.push(type);
      }
      if (dateFrom) {
        where.push(`s.created_at >= $${idx++}`);
        params.push(`${dateFrom} 00:00:00`);
      }
      if (dateTo) {
        where.push(`s.created_at <= $${idx++}`);
        params.push(`${dateTo} 23:59:59`);
      }
      if (search) {
        where.push(`(LOWER(COALESCE(c.name,'')) LIKE $${idx} OR CAST(s.id AS TEXT) LIKE $${idx + 1} OR CAST(s.total AS TEXT) LIKE $${idx + 2})`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        idx += 3;
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT
          COUNT(*) AS "totalSales",
          COALESCE(SUM(s.total), 0) AS "totalRevenue",
          COALESCE(SUM(CASE WHEN s.sale_type = 'cash' THEN s.total ELSE 0 END), 0) AS "cashRevenue",
          COALESCE(SUM(CASE WHEN s.sale_type = 'credit' THEN s.total ELSE 0 END), 0) AS "creditRevenue"
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        ${whereSql}`,
        params
      );
      return ok(200, r.rows[0], requestId);
    }
    if (method === "GET" && /^\/v1\/sales\/\d+\/detail$/.test(path)) {
      const saleId = getPathId(path, /^\/v1\/sales\/(\d+)\/detail$/, "id");
      const sale = await pool.query(
        `SELECT
          s.*,
          c.name AS customer_name,
          c.phone AS customer_phone,
          c.email AS customer_email
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.id = $1
         LIMIT 1`,
        [saleId]
      );
      if (sale.rowCount === 0) {
        return ok(200, null, requestId);
      }
      const items = await pool.query(
        `SELECT
          si.*,
          COALESCE(p.name, 'Producto eliminado') AS product_name,
          COALESCE(p.barcode, '') AS product_barcode
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = $1
         ORDER BY si.id ASC`,
        [saleId]
      );
      return ok(200, { ...sale.rows[0], items: items.rows }, requestId);
    }
    if (method === "GET" && /^\/v1\/sales\/\d+$/.test(path)) {
      const saleId = getPathId(path, /^\/v1\/sales\/(\d+)$/, "id");
      const r = await pool.query("SELECT * FROM sales WHERE id = $1 LIMIT 1", [saleId]);
      return ok(200, r.rows[0] || null, requestId);
    }
    if (method === "GET" && path === "/v1/credits") {
      const q = event.queryStringParameters || {};
      const status = q.status;
      let sql = `
        SELECT cr.*, cu.name AS customer_name
        FROM credits cr
        LEFT JOIN customers cu ON cu.id = cr.customer_id
      `;
      const params = [];
      if (status && ["pending", "overdue", "paid"].includes(status)) {
        sql += " WHERE cr.status = $1";
        params.push(status);
      }
      sql += " ORDER BY cr.due_date ASC, cr.id DESC LIMIT 500";
      const r = await pool.query(sql, params);
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/credits\/\d+$/.test(path)) {
      const creditId = getPathId(path, /^\/v1\/credits\/(\d+)$/, "id");
      const r = await pool.query("SELECT * FROM credits WHERE id = $1 LIMIT 1", [creditId]);
      return ok(200, r.rows[0] || null, requestId);
    }
    if (method === "GET" && /^\/v1\/customers\/\d+\/credits$/.test(path)) {
      const customerId = getPathId(path, /^\/v1\/customers\/(\d+)\/credits$/, "id");
      const r = await pool.query(
        "SELECT * FROM credits WHERE customer_id = $1 ORDER BY created_at DESC",
        [customerId]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "POST" && /^\/v1\/credits\/\d+\/payments$/.test(path)) {
      const creditId = getPathId(path, /^\/v1\/credits\/(\d+)\/payments$/, "credit_id");
      const body = parseBody(event);
      const amount = requirePositiveNumber(body.amount, "amount");
      const paymentCreatedAt = resolveCreatedAtFromDate(body.payment_date, "payment_date");
      const idempotencyKey = body.idempotency_key?.trim() || null;
      const data = await withTx(async (client) => {
        if (idempotencyKey) {
          const existing = await client.query(
            "SELECT credit_id FROM credit_payments WHERE idempotency_key = $1 LIMIT 1",
            [idempotencyKey]
          );
          if (existing.rowCount > 0) {
            const credit = await client.query("SELECT * FROM credits WHERE id = $1", [
              existing.rows[0].credit_id
            ]);
            return { created: false, credit: credit.rows[0] };
          }
        }
        const cashRegisterId = await getOpenCashRegisterId(client);
        const creditQ = await client.query("SELECT * FROM credits WHERE id = $1 LIMIT 1", [creditId]);
        if (creditQ.rowCount === 0) {
          throw new HttpError(404, "not_found", "Credit not found");
        }
        if (creditQ.rows[0].status === "paid") {
          throw new HttpError(409, "business_conflict", "Credit is already paid");
        }
        await client.query(
          "INSERT INTO credit_payments (credit_id, amount, cash_register_id, idempotency_key, created_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, NOW()))",
          [creditId, amount, cashRegisterId, idempotencyKey, paymentCreatedAt]
        );
        const upd = await client.query(
          `UPDATE credits
           SET amount_paid = amount_paid + $1
           WHERE id = $2
           RETURNING *`,
          [amount, creditId]
        );
        const updated = upd.rows[0];
        if (Number(updated.amount_paid) >= Number(updated.total_due)) {
          const paid = await client.query(
            "UPDATE credits SET status='paid', paid_at=COALESCE($1::timestamp, NOW()) WHERE id = $2 RETURNING *",
            [paymentCreatedAt, creditId]
          );
          return { created: true, credit: paid.rows[0] };
        }
        return { created: true, credit: updated };
      });
      return ok(data.created ? 201 : 200, data, requestId);
    }
    if (method === "GET" && /^\/v1\/credits\/\d+\/payments$/.test(path)) {
      const creditId = getPathId(path, /^\/v1\/credits\/(\d+)\/payments$/, "credit_id");
      const r = await pool.query(
        "SELECT * FROM credit_payments WHERE credit_id = $1 ORDER BY created_at DESC",
        [creditId]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/credits/summary") {
      const q = event.queryStringParameters || {};
      const search = (q.search || "").trim().toLowerCase();
      const status = q.status;
      const dateFrom = q.date_from;
      const dateTo = q.date_to;
      const where = [];
      const params = [];
      let idx = 1;
      if (status && ["pending", "overdue", "paid"].includes(status)) {
        where.push(`cr.status = $${idx++}`);
        params.push(status);
      }
      if (dateFrom) {
        where.push(`cr.created_at >= $${idx++}`);
        params.push(`${dateFrom} 00:00:00`);
      }
      if (dateTo) {
        where.push(`cr.created_at <= $${idx++}`);
        params.push(`${dateTo} 23:59:59`);
      }
      if (search) {
        where.push(`(LOWER(COALESCE(cu.name,'')) LIKE $${idx} OR CAST(cr.id AS TEXT) LIKE $${idx + 1} OR CAST(cr.sale_id AS TEXT) LIKE $${idx + 2})`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        idx += 3;
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE cr.status != 'paid') AS "countActive",
          COALESCE(SUM(CASE WHEN cr.status = 'pending' THEN cr.total_due - cr.amount_paid ELSE 0 END), 0) AS "totalPending",
          COALESCE(SUM(CASE WHEN cr.status = 'overdue' THEN cr.total_due - cr.amount_paid ELSE 0 END), 0) AS "totalOverdue",
          COALESCE(SUM(cr.amount_paid), 0) AS "totalCollected"
         FROM credits cr
         LEFT JOIN customers cu ON cu.id = cr.customer_id
         ${whereSql}`,
        params
      );
      return ok(200, r.rows[0], requestId);
    }
    if (method === "POST" && path === "/v1/credits/recalculate-overdue") {
      const data = await withTx(async (client) => {
        const upd = await client.query(
          `UPDATE credits
           SET total_due = ROUND(original_amount * (1 + surcharge_percent / 100.0), 2),
               surcharge_applied = 1,
               status = 'overdue'
           WHERE status = 'pending'
             AND surcharge_applied = 0
             AND due_date < CURRENT_DATE
           RETURNING id, sale_id`
        );
        for (const row of upd.rows) {
          await client.query(
            `UPDATE sales
             SET surcharge = ROUND(
                   (SELECT original_amount FROM credits WHERE sale_id = sales.id) *
                   (SELECT surcharge_percent FROM credits WHERE sale_id = sales.id) / 100.0, 2
                 ),
                 total = subtotal + ROUND(
                   (SELECT original_amount FROM credits WHERE sale_id = sales.id) *
                   (SELECT surcharge_percent FROM credits WHERE sale_id = sales.id) / 100.0, 2
                 )
             WHERE id = $1`,
            [row.sale_id]
          );
        }
        return { updated_count: upd.rowCount };
      });
      return ok(200, data, requestId);
    }
    if (method === "POST" && path === "/v1/inventory/movements") {
      const body = parseBody(event);
      if (!["in", "out", "adjustment"].includes(body.type)) {
        throw new HttpError(422, "validation_error", "type must be in|out|adjustment");
      }
      const productId = Number(body.product_id);
      if (!Number.isInteger(productId) || productId < 1) {
        throw new HttpError(422, "validation_error", "product_id must be integer >= 1");
      }
      const qty = requirePositiveNumber(body.quantity, "quantity");
      const data = await withTx(async (client) => {
        const p = await client.query("SELECT id, stock FROM products WHERE id = $1 LIMIT 1", [productId]);
        if (p.rowCount === 0) {
          throw new HttpError(404, "not_found", "Product not found");
        }
        if (body.type === "in" && (body.cost_price !== void 0 || body.margin_percent !== void 0)) {
          const fields = [];
          const values = [];
          if (body.cost_price !== void 0) {
            const costPrice = requirePositiveNumber(body.cost_price, "cost_price");
            fields.push(`cost_price = $${fields.length + 1}`);
            values.push(costPrice);
          }
          if (body.margin_percent !== void 0) {
            const marginPercent = requireNonNegativeNumber(body.margin_percent, "margin_percent");
            fields.push(`margin_percent = $${fields.length + 1}`);
            values.push(marginPercent);
          }
          if (fields.length > 0) {
            await client.query(
              `UPDATE products SET ${fields.join(", ")} WHERE id = $${fields.length + 1}`,
              [...values, productId]
            );
          }
        }
        const ins = await client.query(
          `INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [productId, body.type, qty, body.reference_id ?? null, body.notes ?? null]
        );
        if (body.type === "in") {
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [Math.abs(qty), productId]);
        } else if (body.type === "out") {
          const stock = Number(p.rows[0].stock);
          if (stock < Math.abs(qty)) {
            throw new HttpError(409, "business_conflict", "Insufficient stock");
          }
          await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [Math.abs(qty), productId]);
        } else {
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [qty, productId]);
        }
        return ins.rows[0];
      });
      return ok(201, data, requestId);
    }
    if (method === "GET" && path === "/v1/inventory/movements") {
      const q = event.queryStringParameters || {};
      const type = q.type;
      const where = [];
      const params = [];
      let idx = 1;
      if (type && ["in", "out", "adjustment"].includes(type)) {
        where.push(`m.type = $${idx++}`);
        params.push(type);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT m.*, p.name AS product_name, p.barcode AS product_barcode
         FROM inventory_movements m
         LEFT JOIN products p ON p.id = m.product_id
         ${whereSql}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 500`,
        params
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && /^\/v1\/products\/\d+\/inventory-movements$/.test(path)) {
      const productId = getPathId(path, /^\/v1\/products\/(\d+)\/inventory-movements$/, "id");
      const r = await pool.query(
        `SELECT m.*, COALESCE(p.name, 'Producto eliminado') AS product_name, COALESCE(p.barcode, '') AS product_barcode
         FROM inventory_movements m
         LEFT JOIN products p ON p.id = m.product_id
         WHERE m.product_id = $1
         ORDER BY m.created_at DESC, m.id DESC`,
        [productId]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/reports/sales-by-date") {
      const q = event.queryStringParameters || {};
      const startDate = requireString(q.start_date, "start_date");
      const endDate = requireString(q.end_date, "end_date");
      const r = await pool.query(
        `SELECT
          DATE(created_at) AS date,
          COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN sale_type = 'cash' THEN total ELSE 0 END), 0) AS total_cash,
          COALESCE(SUM(CASE WHEN sale_type = 'credit' THEN total ELSE 0 END), 0) AS total_credit,
          COALESCE(SUM(total), 0) AS total
         FROM sales
         WHERE DATE(created_at) BETWEEN $1 AND $2
         GROUP BY DATE(created_at)
         ORDER BY DATE(created_at) ASC`,
        [startDate, endDate]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/reports/top-products") {
      const q = event.queryStringParameters || {};
      const startDate = requireString(q.start_date, "start_date");
      const endDate = requireString(q.end_date, "end_date");
      const limit = Number(q.limit || 10);
      const r = await pool.query(
        `SELECT
          p.id AS product_id,
          p.name AS product_name,
          SUM(si.quantity) AS total_quantity,
          SUM(si.line_total) AS total_revenue
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         JOIN sales s ON si.sale_id = s.id
         WHERE DATE(s.created_at) BETWEEN $1 AND $2
         GROUP BY p.id
         ORDER BY total_revenue DESC
         LIMIT $3`,
        [startDate, endDate, Number.isFinite(limit) && limit > 0 ? limit : 10]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/reports/profit") {
      const q = event.queryStringParameters || {};
      const startDate = requireString(q.start_date, "start_date");
      const endDate = requireString(q.end_date, "end_date");
      const r = await pool.query(
        `SELECT
          p.id AS product_id,
          p.name AS product_name,
          SUM(si.quantity) AS total_quantity,
          SUM(si.line_total) AS total_revenue,
          SUM(si.quantity * p.cost_price) AS total_cost,
          SUM(si.line_total) - SUM(si.quantity * p.cost_price) AS profit,
          CASE
            WHEN SUM(si.line_total) > 0
            THEN ROUND((SUM(si.line_total) - SUM(si.quantity * p.cost_price)) * 100.0 / SUM(si.line_total), 2)
            ELSE 0
          END AS margin
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         JOIN sales s ON si.sale_id = s.id
         WHERE DATE(s.created_at) BETWEEN $1 AND $2
         GROUP BY p.id
         ORDER BY profit DESC`,
        [startDate, endDate]
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/reports/inventory") {
      const r = await pool.query(
        `SELECT
          id AS product_id,
          name AS product_name,
          stock,
          min_stock,
          cost_price,
          sale_price,
          ROUND(stock * cost_price, 2) AS stock_value_cost,
          ROUND(stock * sale_price, 2) AS stock_value_sale
         FROM products
         WHERE is_active = 1
         ORDER BY stock_value_cost DESC`
      );
      return ok(200, r.rows, requestId);
    }
    if (method === "GET" && path === "/v1/reports/inventory-summary") {
      const r = await pool.query(
        `SELECT
          COUNT(*) AS total_products,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS total_active,
          COALESCE(SUM(CASE WHEN is_active = 1 THEN stock ELSE 0 END), 0) AS total_stock_units,
          COALESCE(SUM(CASE WHEN is_active = 1 THEN ROUND(stock * cost_price, 2) ELSE 0 END), 0) AS total_value_cost,
          COALESCE(SUM(CASE WHEN is_active = 1 THEN ROUND(stock * sale_price, 2) ELSE 0 END), 0) AS total_value_sale,
          SUM(CASE WHEN is_active = 1 AND min_stock >= 0 AND stock <= min_stock THEN 1 ELSE 0 END) AS low_stock_count
         FROM products`
      );
      return ok(200, r.rows[0], requestId);
    }
    if (method === "GET" && path === "/v1/reports/credits-overview") {
      const r = await pool.query(
        `SELECT
          status,
          COUNT(*) AS count,
          COALESCE(SUM(total_due), 0) AS total_due,
          COALESCE(SUM(amount_paid), 0) AS total_paid,
          COALESCE(SUM(total_due - amount_paid), 0) AS total_remaining
         FROM credits
         GROUP BY status
         ORDER BY CASE status WHEN 'overdue' THEN 1 WHEN 'pending' THEN 2 WHEN 'paid' THEN 3 END`
      );
      return ok(200, r.rows, requestId);
    }
    const settingsSection = parseSettingsSection(path);
    if (settingsSection && method === "GET") {
      const keys = SETTINGS_SECTION_KEYS[settingsSection];
      const r = await pool.query(
        "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
        [keys]
      );
      const map = {};
      for (const row of r.rows) {
        map[row.key] = row.value ?? "";
      }
      for (const key of keys) {
        if (!(key in map)) {
          map[key] = "";
        }
      }
      return ok(200, { section: settingsSection, values: map }, requestId);
    }
    if (settingsSection && method === "PUT") {
      const body = parseBody(event);
      const incomingValues = typeof body.values === "object" && body.values !== null ? body.values : null;
      if (!incomingValues) {
        throw new HttpError(422, "validation_error", "values object is required");
      }

      const allowedKeys = new Set(SETTINGS_SECTION_KEYS[settingsSection]);
      const rows = [];
      for (const [key, rawValue] of Object.entries(incomingValues)) {
        if (!allowedKeys.has(key)) {
          throw new HttpError(422, "validation_error", `Key ${key} is not allowed for section ${settingsSection}`);
        }
        rows.push([key, validateSettingValueByKey(key, rawValue)]);
      }

      if (rows.length === 0) {
        throw new HttpError(422, "validation_error", "At least one setting is required");
      }

      await withTx(async (client) => {
        for (const [key, value] of rows) {
          await client.query(
            `INSERT INTO settings (key, value)
             VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [key, value]
          );
        }
      });

      const r = await pool.query(
        "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
        [Array.from(allowedKeys)]
      );
      const map = {};
      for (const row of r.rows) {
        map[row.key] = row.value ?? "";
      }
      return ok(200, { section: settingsSection, values: map }, requestId);
    }
    return fail(404, "not_found", "Route not found", requestId);
  } catch (err) {
    if (err instanceof HttpError) {
      return fail(err.statusCode, err.code, err.message, requestId, err.details);
    }
    console.error("handler_error", {
      request_id: requestId,
      name: err instanceof Error ? err.name : "UnknownError",
      message: err instanceof Error ? err.message : "unknown_error",
      stack: err instanceof Error ? err.stack : void 0
    });
    return fail(500, "internal_error", "Internal server error", requestId);
  }
};
export {
  handler
};