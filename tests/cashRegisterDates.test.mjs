import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CloudApi } from '../electron/lib/cloudApi.ts';
import { formatCalendarDate, formatDate, formatDateTime, getCalendarDate } from '../src/lib/formatters.ts';

test('calendar boundaries preserve May 1 for local and legacy AWS formats', () => {
  for (const value of ['2026-05-01', '2026-05-01 00:00:00', '2026-05-01T00:00:00.000Z']) {
    assert.equal(getCalendarDate(value), '2026-05-01');
    assert.equal(formatCalendarDate(value), formatDate('2026-05-01'));
  }
  assert.equal(getCalendarDate('2026-04-30 18:55:45'), '2026-04-30');
  assert.equal(getCalendarDate('2024-02-29'), '2024-02-29');
});

test('missing and invalid calendar boundaries cannot become input limits', () => {
  for (const value of [null, undefined, '', 'invalid', '2026-02-29', '2026-04-31', '2026-05-01junk']) {
    assert.equal(getCalendarDate(value), '');
    assert.equal(formatCalendarDate(value), '-');
  }
});

test('real transaction timestamps still use the business timezone', () => {
  const timestamp = '2026-05-01T00:00:00.000Z';
  assert.equal(formatDate(timestamp), formatDate('2026-04-30'));
  assert.equal(formatDateTime(timestamp), formatDateTime('2026-04-30 18:00:00'));
  assert.notEqual(formatCalendarDate(timestamp), formatDate(timestamp));
});

test('cloud period responses normalize boundaries without modifying transaction timestamps', async (t) => {
  const api = new CloudApi(() => ({
    baseUrl: 'https://example.invalid', apiKey: 'test-only', timeoutMs: 1000, retryMax: 0,
  }));
  const timestamp = '2026-05-01T00:00:00.000Z';
  const row = {
    id: '1', period_name: 'Fixture', start_date: timestamp,
    end_date: '2026-05-31T00:00:00.000Z', status: 'closed', version: '1',
    opening_cash: '0', closing_cash: '0', created_at: timestamp,
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: options.body ? JSON.parse(options.body) : null });
    const data = path.endsWith('/periods') ? [row] : row;
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  });

  for (const period of [
    await api.getCurrentCashRegister(),
    ...(await api.getCashRegisterPeriods()),
    ...(await api.getCashRegisterPeriodsPaginated({ page: 1, pageSize: 5 })).items,
    await api.openCashRegister({ period_name: 'Fixture', start_date: '2026-05-01', opening_cash: 0 }),
    await api.closeCashRegister({ id: 1, closing_cash: 0, end_date: '2026-05-31' }),
  ]) {
    assert.equal(period.start_date, '2026-05-01');
    assert.equal(period.end_date, '2026-05-31');
    assert.equal(period.created_at, timestamp);
  }
  assert.equal(requests.find((request) => request.path.endsWith('/open')).body.start_date, '2026-05-01');
  assert.equal(requests.find((request) => request.path.endsWith('/close')).body.end_date, '2026-05-31');

  row.end_date = null;
  assert.equal((await api.getCurrentCashRegister()).end_date, null);
});
