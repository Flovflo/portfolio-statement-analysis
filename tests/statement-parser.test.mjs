import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnalysis,
  classifyInstrument,
  extractTransactionsFromLines,
  parseCurrency,
} from '../scripts/statement-parser.mjs';

test('parseCurrency handles French euro amounts and negatives', () => {
  assert.equal(parseCurrency('1 234,56 €'), 1234.56);
  assert.equal(parseCurrency('-332,24 €'), -332.24);
  assert.equal(parseCurrency('0,01 €'), 0.01);
});

test('extractTransactionsFromLines reconstructs split PDF rows and infers cash direction from balances', () => {
  const lines = [
    { page: 104, x: 74.44, y: 652.16, text: '23' },
    { page: 104, x: 74.44, y: 644.58, text: 'mars' },
    { page: 104, x: 74.44, y: 637.01, text: '2026' },
    { page: 104, x: 101.48, y: 648.37, text: 'Exécution' },
    { page: 104, x: 101.48, y: 640.79, text: "d'ordre" },
    {
      page: 104,
      x: 140.4,
      y: 640.79,
      text: 'Buy trade IE00BLRPRL42 WITR MU.AS.I.NA100 3X 62, quantity: 0.863036',
    },
    { page: 104, x: 450.26, y: 640.79, text: '201,02 €' },
    { page: 104, x: 494.14, y: 640.79, text: '27,83 €' },
    { page: 104, x: 74.44, y: 612.93, text: '25' },
    { page: 104, x: 74.44, y: 605.35, text: 'mars' },
    { page: 104, x: 74.44, y: 597.78, text: '2026' },
    { page: 104, x: 101.48, y: 605.35, text: 'Avoir INTERMARCHE' },
    { page: 104, x: 450.26, y: 605.35, text: '14,70 € 13,13 €' },
  ];

  const transactions = extractTransactionsFromLines(lines, { openingBalance: 228.85 });

  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].date, '2026-03-23');
  assert.equal(transactions[0].amount, 201.02);
  assert.equal(transactions[0].direction, 'outflow');
  assert.equal(transactions[0].kind, 'buy');
  assert.equal(transactions[0].asset.isin, 'IE00BLRPRL42');
  assert.equal(transactions[0].asset.quantity, 0.863036);
  assert.equal(transactions[1].kind, 'card');
  assert.equal(transactions[1].amount, 14.7);
  assert.equal(transactions[1].balance, 13.13);
});

test('buildAnalysis separates portfolio cost basis from card and cash flows', () => {
  const transactions = [
    {
      id: 't1',
      date: '2026-01-01',
      month: '2026-01',
      amount: 500,
      signedAmount: 500,
      direction: 'inflow',
      balance: 500,
      kind: 'deposit',
      category: 'Apports',
      description: 'Incoming transfer',
    },
    {
      id: 't2',
      date: '2026-01-02',
      month: '2026-01',
      amount: 300,
      signedAmount: -300,
      direction: 'outflow',
      balance: 200,
      kind: 'buy',
      category: 'Achats portefeuille',
      description: 'Buy trade US67066G1040 NVIDIA CORP.',
      asset: {
        isin: 'US67066G1040',
        name: 'NVIDIA CORP.',
        class: 'Action',
        theme: 'Semi-conducteurs / IA',
      },
    },
    {
      id: 't3',
      date: '2026-01-03',
      month: '2026-01',
      amount: 25,
      signedAmount: -25,
      direction: 'outflow',
      balance: 175,
      kind: 'card',
      category: 'Dépenses carte',
      description: 'Avoir INTERMARCHE',
    },
    {
      id: 't4',
      date: '2026-01-04',
      month: '2026-01',
      amount: 2,
      signedAmount: 2,
      direction: 'inflow',
      balance: 177,
      kind: 'dividend',
      category: 'Dividendes',
      description: 'Cash Dividend for ISIN US67066G1040',
      asset: { isin: 'US67066G1040', name: 'NVIDIA CORP.' },
    },
  ];

  const analysis = buildAnalysis(transactions, { periodLabel: 'fixture' });

  assert.equal(analysis.summary.totalDeposits, 500);
  assert.equal(analysis.summary.totalBuys, 300);
  assert.equal(analysis.summary.cardSpend, 25);
  assert.equal(analysis.summary.passiveIncome, 2);
  assert.equal(analysis.assets[0].isin, 'US67066G1040');
  assert.equal(analysis.assets[0].netInvested, 300);
});

test('classifyInstrument recognizes ETFs, crypto proxies, and semiconductor exposure', () => {
  assert.equal(classifyInstrument('IE00B3WJKG14', 'ISHSV-S+500INF.T. SECT.DLA').class, 'ETF / ETP');
  assert.equal(classifyInstrument('XF000BTC0017', '').class, 'Crypto');
  assert.equal(classifyInstrument('US67066G1040', 'NVIDIA CORP. DL-,001').theme, 'Semi-conducteurs / IA');
});
