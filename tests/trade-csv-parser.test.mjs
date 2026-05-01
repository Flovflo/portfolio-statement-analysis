import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildTradeCsvAnalysis, parseCsvObjects, TRADE_CSV_HEADERS } from '../scripts/trade-csv-parser.mjs';

const HEADER = TRADE_CSV_HEADERS.map((field) => `"${field}"`).join(',');

test('parseCsvObjects parses every expected CSV column including quoted descriptions', () => {
  const csv = `${HEADER}
"2024-01-01T09:00:00Z","2024-01-01","DEFAULT","TRADING","BUY","STOCK","ACME, Inc.","US0000000001","2.0000000000","10.000000","-20.00","-1.00","","EUR","","","","note ""quoted""","tx-1","","","",""`;

  const { headers, rows } = parseCsvObjects(csv);

  assert.deepEqual(headers, TRADE_CSV_HEADERS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'ACME, Inc.');
  assert.equal(rows[0].description, 'note "quoted"');
  assert.equal(Object.keys(rows[0]).length, TRADE_CSV_HEADERS.length);
});

test('buildTradeCsvAnalysis computes trading metrics from all numeric execution fields', () => {
  const csv = `${HEADER}
"2024-01-01T09:00:00Z","2024-01-01","DEFAULT","TRADING","BUY","STOCK","ACME","US0000000001","2.0000000000","10.000000","-20.00","-1.00","-0.10","EUR","","","","","buy-1","","","",""
"2024-02-01T09:00:00Z","2024-02-01","DEFAULT","TRADING","SELL","STOCK","ACME","US0000000001","-1.0000000000","14.000000","14.00","-1.00","","EUR","","","","","sell-1","","","",""
"2024-02-02T09:00:00Z","2024-02-02","DEFAULT","CASH","DIVIDEND","STOCK","ACME","US0000000001","1.0000000000","","0.50","","-0.05","EUR","0.55","USD","1.100000","dividend","div-1","","","",""
"2024-03-01T09:00:00Z","2024-03-01","DEFAULT","DELIVERY","FREE_RECEIPT","STOCK","ACME","US0000000001","0.5000000000","","","","","EUR","","","","","del-1","","","",""`;

  const analysis = buildTradeCsvAnalysis(csv, { fileName: 'fixture.csv' });
  const asset = analysis.trading.assets[0];

  assert.equal(analysis.sourceType, 'csv');
  assert.equal(analysis.meta.columnCount, TRADE_CSV_HEADERS.length);
  assert.equal(analysis.summary.tradingRows, 2);
  assert.equal(analysis.summary.buyOrders, 1);
  assert.equal(analysis.summary.sellOrders, 1);
  assert.equal(analysis.summary.grossBuys, 20);
  assert.equal(analysis.summary.grossSells, 14);
  assert.equal(analysis.summary.tradingFees, 2);
  assert.equal(analysis.summary.tradingTaxes, 0.1);
  assert.equal(asset.realizedPnl, 2.45);
  assert.equal(asset.netQuantity, 1.5);
  assert.equal(asset.dividends, 0.45);
  assert.equal(analysis.trading.fieldCoverage.length, TRADE_CSV_HEADERS.length);
  assert.equal(analysis.audit.direct.some((item) => item.key === 'columns' && item.value === '23/23'), true);
});

test('real Transaction export fixture parses all columns without exposing raw IBANs in descriptions', { skip: !process.env.TRANSACTION_CSV }, () => {
  const csv = fs.readFileSync(process.env.TRANSACTION_CSV, 'utf8');
  const analysis = buildTradeCsvAnalysis(csv, { fileName: 'Transaction export.csv' });

  assert.equal(analysis.meta.columnCount, 23);
  assert.equal(analysis.trading.fieldCoverage.length, 23);
  assert.equal(analysis.summary.transactionCount > 1000, true);
  assert.equal(analysis.summary.tradingRows > 500, true);
  assert.equal(analysis.summary.buyOrders > analysis.summary.sellOrders, true);
  assert.equal(analysis.trading.assets.length > 40, true);
  assert.equal(JSON.stringify(analysis.trading.transactions).includes('counterparty_iban'), false);
});
