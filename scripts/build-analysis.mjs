import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  buildAnalysis,
  extractStatementMeta,
  extractTransactionsFromLines,
} from './statement-parser.mjs';
import { extractLinesFromPdfData } from './pdfjs-extractor.mjs';

const pdfPath = process.argv[2] ?? process.env.STATEMENT_PDF;
const outputDir = path.resolve('data');
const jsonPath = path.join(outputDir, 'portfolio-analysis.json');
const jsPath = path.join(outputDir, 'portfolio-analysis.js');

if (!pdfPath) {
  console.error('Usage: node scripts/build-analysis.mjs <statement.pdf>');
  console.error('Or set STATEMENT_PDF=/path/to/statement.pdf');
  process.exit(2);
}

const pdfData = new Uint8Array(await readFile(pdfPath));
const lines = await extractLinesFromPdfData(pdfData, pdfjs, { disableWorker: true });
const meta = extractStatementMeta(lines);
const transactions = extractTransactionsFromLines(lines, { openingBalance: meta.openingBalance });
const analysis = buildAnalysis(transactions, meta);

mkdirSync(outputDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(analysis, null, 2)}\n`);
writeFileSync(jsPath, `window.PORTFOLIO_ANALYSIS = ${JSON.stringify(analysis, null, 2)};\n`);

console.log(JSON.stringify({
  jsonPath,
  jsPath,
  transactionCount: analysis.summary.transactionCount,
  expectedInflows: meta.expectedInflows,
  actualInflows: analysis.summary.totalInflows,
  inflowDiff: analysis.diagnostics.inflowDiff,
  expectedOutflows: meta.expectedOutflows,
  actualOutflows: analysis.summary.totalOutflows,
  outflowDiff: analysis.diagnostics.outflowDiff,
  expectedFinalBalance: meta.expectedFinalBalance,
  actualFinalBalance: analysis.summary.finalBalance,
  finalBalanceDiff: analysis.diagnostics.finalBalanceDiff,
}, null, 2));
