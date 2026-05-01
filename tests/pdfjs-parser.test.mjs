import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  buildAnalysis,
  extractStatementMeta,
  extractTransactionsFromLines,
} from '../scripts/statement-parser.mjs';
import { extractLinesFromPdfData } from '../scripts/pdfjs-extractor.mjs';

const statementPath = process.env.STATEMENT_PDF;
const hasStatementFixture = statementPath ? await fileExists(statementPath) : false;

test('PDF.js browser-style extraction reconciles the statement totals', { skip: !hasStatementFixture }, async () => {
  const pdfData = await readFile(statementPath);
  const lines = await extractLinesFromPdfData(new Uint8Array(pdfData), pdfjs);
  const meta = extractStatementMeta(lines);
  const transactions = extractTransactionsFromLines(lines, { openingBalance: meta.openingBalance });
  const analysis = buildAnalysis(transactions, meta);

  assert.equal(analysis.summary.transactionCount, 1587);
  assert.equal(analysis.diagnostics.inflowDiff, 0);
  assert.equal(analysis.diagnostics.outflowDiff, 0);
  assert.equal(analysis.diagnostics.finalBalanceDiff, 0);
});

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
