const MONTHS = {
  'janv.': '01',
  'févr.': '02',
  mars: '03',
  'avr.': '04',
  mai: '05',
  juin: '06',
  'juil.': '07',
  août: '08',
  'sept.': '09',
  'oct.': '10',
  'nov.': '11',
  'déc.': '12',
};

const MONTH_PATTERN = Object.keys(MONTHS)
  .map((month) => month.replace('.', '\\.'))
  .join('|');

const CURRENCY_PATTERN = /(?<![\d.])-?(?:\d{1,3}(?: \d{3})+|\d+),\d{2}\s*€/g;
const HONORIFIC_PERSON_PATTERN =
  /\b(?:M|MME|MLLE|MR|MRS|MS|MONSIEUR|MADAME)\.?\s+[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'-]+(?:\s+[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'-]+){1,3}\b/g;
const BANK_ID_NAME_PATTERN = /\b[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'-]+(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'-]+){1,3}\b(?=.*\b(?:IBAN|BIC|TRBK)\b)/g;
const TRANSFER_FROM_NAME_PATTERN =
  /\b(from|de)\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'-]+(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'-]+){1,3}\b(?=.*(?:[A-Z]{2}\d{2}[A-Z0-9]{10,30}|\bIBAN\b|\bBIC\b|\bTRBK\b))/gi;

const CRYPTO_NAMES = {
  XF000BTC0017: 'Bitcoin',
  XF000ETH0019: 'Ethereum',
  XF000SOL0012: 'Solana',
};

export function parseCurrency(value) {
  const normalized = value
    .replace(/\s/g, '')
    .replace('€', '')
    .replace(/\./g, '')
    .replace(',', '.');
  return roundMoney(Number.parseFloat(normalized));
}

export function extractTransactionsFromLines(lines, options = {}) {
  const pages = groupBy(lines, (line) => line.page);
  const transactions = [];
  let previousBalance = options.openingBalance ?? 0;

  for (const page of [...pages.keys()].sort((a, b) => Number(a) - Number(b))) {
    const rows = toVisualRows(pages.get(page));
    const blocks = transactionBlocks(rows);

    for (const block of blocks) {
      const transaction = parseBlock(block, previousBalance, transactions.length + 1);
      if (!transaction) continue;
      previousBalance = transaction.balance;
      transactions.push(transaction);
    }
  }

  enrichAssetNames(transactions);
  return transactions;
}

export function extractStatementMeta(lines) {
  const text = lines.map((line) => line.text).join(' ');
  const summary = text.match(
    /Compte courant\s+(-?\d+(?:[ .]\d{3})*,\d{2}\s*€)\s+(-?\d+(?:[ .]\d{3})*,\d{2}\s*€)\s+(-?\d+(?:[ .]\d{3})*,\d{2}\s*€)\s+(-?\d+(?:[ .]\d{3})*,\d{2}\s*€)/,
  );
  const period = text.match(/DATE\s+(\d{2}\s+\S+\s+\d{4}\s+-\s+\d{2}\s+\S+\s+\d{4})/);

  return {
    periodLabel: period?.[1] ?? '',
    pageCount: new Set(lines.map((line) => line.page)).size,
    extractedLineCount: lines.length,
    openingBalance: summary ? parseCurrency(summary[1]) : null,
    expectedInflows: summary ? parseCurrency(summary[2]) : null,
    expectedOutflows: summary ? parseCurrency(summary[3]) : null,
    expectedFinalBalance: summary ? parseCurrency(summary[4]) : null,
  };
}

export function buildAnalysis(transactions, meta = {}) {
  const enriched = transactions.map((transaction) => ({ ...transaction }));
  const summary = buildSummary(enriched, meta);
  const monthly = buildMonthly(enriched);
  const assets = buildAssets(enriched);
  const categories = buildCategoryBreakdown(enriched);
  const merchants = buildMerchantBreakdown(enriched);
  const diagnostics = buildDiagnostics(summary, meta);
  const coverage = buildCoverage(enriched, assets, meta, diagnostics);
  const audit = buildAudit(summary, meta, diagnostics, coverage);

  return {
    generatedAt: new Date().toISOString(),
    meta,
    summary,
    monthly,
    assets,
    categories,
    merchants,
    diagnostics,
    coverage,
    audit,
    transactions: enriched,
  };
}

function toVisualRows(lines) {
  const sorted = [...lines]
    .filter((line) => line.text && !isNoiseLine(line.text))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];

  for (const line of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - line.y) <= 1.6);
    if (row) {
      row.fragments.push(line);
      row.y = average(row.fragments.map((fragment) => fragment.y));
    } else {
      rows.push({ page: line.page, y: line.y, fragments: [line] });
    }
  }

  return rows.map(finalizeRow).sort((a, b) => b.y - a.y || a.xMin - b.xMin);
}

function finalizeRow(row) {
  const fragments = row.fragments.sort((a, b) => a.x - b.x);
  return {
    page: row.page,
    y: row.y,
    xMin: Math.min(...fragments.map((fragment) => fragment.x)),
    text: normalizeSpaces(fragments.map((fragment) => fragment.text).join(' ')),
    fragments,
  };
}

function transactionBlocks(rows) {
  const tableRows = rows.slice(0, firstTerminatorIndex(rows));
  const starts = tableRows
    .map((row, index) => (isDateStart(tableRows, index) ? index : -1))
    .filter((index) => index >= 0);

  return starts.map((start, position) => {
    const end = starts[position + 1] ?? tableRows.length;
    return tableRows.slice(start, end);
  });
}

function firstTerminatorIndex(rows) {
  const index = rows.findIndex((row) => /^(APERÇU DU SOLDE|COMPTES ESPÈCES|FONDS MONÉTAIRE|REMARQUES SUR LE RELEVÉ)/.test(row.text));
  return index >= 0 ? index : rows.length;
}

function isDateStart(rows, index) {
  const lead = dateColumnText(rows[index]);
  if (new RegExp(`^\\d{2}\\s+(?:${MONTH_PATTERN})(?=\\s|$)`, 'i').test(lead)) return true;
  if (!/^\d{2}$/.test(lead)) return false;

  const nextDateTexts = rows
    .slice(index + 1, index + 5)
    .map(dateColumnText)
    .filter(Boolean);
  return nextDateTexts.some((text) => new RegExp(`^(?:${MONTH_PATTERN})$`, 'i').test(text));
}

function parseBlock(rows, previousBalance, sequence) {
  const date = parseDate(rows);
  const currencies = currenciesFromRows(rows);
  if (!date || currencies.length === 0) return null;

  const balance = currencies.at(-1);
  const signedAmount = roundMoney(balance - previousBalance);
  const description = cleanDescription(descriptionFromRows(rows));
  const classification = classifyTransaction(description, signedAmount);
  const asset = extractAsset(description) ?? extractSyntheticAsset(description);

  return {
    id: `tx-${String(sequence).padStart(4, '0')}`,
    date,
    month: date.slice(0, 7),
    description: sanitizeSensitive(description),
    balance,
    signedAmount,
    amount: Math.abs(signedAmount),
    direction: signedAmount >= 0 ? 'inflow' : 'outflow',
    feesDeclared: extractDeclaredFee(description),
    ...classification,
    ...(asset ? { asset } : {}),
  };
}

function parseDate(rows) {
  const parts = rows.flatMap((row) => row.fragments.filter((line) => line.x < 96).map((line) => normalizeSpaces(line.text)));
  const dayMonth = findDayMonth(parts);
  if (!dayMonth) return null;

  const year = parts.map((part) => part.match(/^(20\d{2})\b/)?.[1]).find(Boolean);
  if (!year) return null;

  return `${year}-${MONTHS[dayMonth.month]}-${dayMonth.day}`;
}

function findDayMonth(parts) {
  for (let index = 0; index < parts.length; index += 1) {
    const combined = parts[index].match(new RegExp(`^(\\d{2})\\s+(${MONTH_PATTERN})(?=\\s|$)`, 'i'));
    if (combined) return { day: combined[1], month: normalizeMonth(combined[2]) };

    const split = parts[index].match(/^(\d{2})$/);
    if (split && parts[index + 1] && MONTHS[normalizeMonth(parts[index + 1])]) {
      return { day: split[1], month: normalizeMonth(parts[index + 1]) };
    }
  }
  return null;
}

function descriptionFromRows(rows) {
  const fragments = rows.flatMap((row) => row.fragments.sort((a, b) => a.x - b.x));
  const parts = [];

  for (const fragment of fragments) {
    const text = normalizeSpaces(fragment.text);
    if (fragment.x < 96) {
      const afterYear = text.match(/^20\d{2}\s+(.+)/)?.[1];
      if (afterYear) parts.push(afterYear);
      continue;
    }
    parts.push(text);
  }

  return normalizeSpaces(parts.join(' '));
}

function classifyTransaction(description, signedAmount) {
  const text = description.toLowerCase();
  if (/vente directe|sell trade|\bvente\b/.test(text)) return transactionClass('sell', 'Ventes portefeuille');
  if (/savings plan execution|buy trade|achat direct/.test(text)) return transactionClass('buy', 'Achats portefeuille');
  if (/ordre d'achat private markets/.test(text)) return transactionClass('buy', 'Achats portefeuille');
  if (/dividend|rendement|ertrag/.test(text)) return transactionClass('dividend', 'Dividendes');
  if (/interest|intérêts/.test(text)) return transactionClass('interest', 'Intérêts cash');
  if (/saveback|cash reward|bonus|parrainage/.test(text)) return transactionClass('bonus', 'Bonus / saveback');
  if (/^frais\b|fee booking/.test(text)) return transactionClass('fee', 'Frais');
  if (/^impôt\b|tax optimisation/.test(text)) return transactionClass('tax', 'Impôts');
  if (/cadeau|gift|lottery|prize/.test(text) && signedAmount > 0) return transactionClass('bonus', 'Bonus / saveback');
  if (/virement|incoming transfer|top up|paiement accepté/.test(text)) {
    return signedAmount >= 0 ? transactionClass('deposit', 'Apports') : transactionClass('withdrawal', 'Retraits');
  }
  if (/^avoir\b|card/.test(text)) {
    return signedAmount >= 0 ? transactionClass('card_refund', 'Remboursements carte') : transactionClass('card', 'Dépenses carte');
  }
  return signedAmount >= 0 ? transactionClass('other_inflow', 'Autres entrées') : transactionClass('other_outflow', 'Autres sorties');
}

function extractAsset(description) {
  const match = description.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/);
  if (!match) return null;

  const isin = match[0];
  const name = cleanAssetName(description.slice(match.index + isin.length), isin);
  const quantity = Number.parseFloat(description.match(/quantity:\s*([0-9.]+)/i)?.[1] ?? '');

  return {
    isin,
    name,
    ...(Number.isFinite(quantity) ? { quantity } : {}),
  };
}

function extractSyntheticAsset(description) {
  return null;
}

function cleanAssetName(rawName, isin) {
  if (CRYPTO_NAMES[isin]) return CRYPTO_NAMES[isin];

  const fallback = isin;
  const name = normalizeSpaces(
    rawName
      .replace(/^\s*(?:0%\s*)/i, '')
      .replace(/,\s*quantity:.*/i, '')
      .replace(/\bquantity:\s*[0-9.]+.*/i, '')
      .replace(/\b\d{8,}\b.*$/i, '')
      .replace(/\b(?:kw|bruttoertrag|payout)\b.*$/i, '')
      .replace(/\b(?:exécution|d'ordre)\b/gi, '')
      .replace(/\s+(?:Rendement|Avoir|Virement|Intérêts|Bonus|Frais|Impôt)\b.*$/i, '')
      .replace(CURRENCY_PATTERN, '')
  );
  return name || fallback;
}

function buildSummary(transactions, meta) {
  const sumKind = (kind) => sum(transactions.filter((tx) => tx.kind === kind).map((tx) => tx.amount));
  const totalInflows = sum(transactions.filter((tx) => tx.signedAmount > 0).map((tx) => tx.amount));
  const totalOutflows = sum(transactions.filter((tx) => tx.signedAmount < 0).map((tx) => tx.amount));
  const firstDate = transactions[0]?.date ?? null;
  const lastDate = transactions.at(-1)?.date ?? null;

  return {
    periodLabel: meta.periodLabel ?? '',
    openingBalance: meta.openingBalance ?? null,
    expectedInflows: meta.expectedInflows ?? null,
    expectedOutflows: meta.expectedOutflows ?? null,
    expectedFinalBalance: meta.expectedFinalBalance ?? null,
    firstDate,
    lastDate,
    transactionCount: transactions.length,
    totalInflows,
    totalOutflows,
    netCashFlow: roundMoney(totalInflows - totalOutflows),
    finalBalance: transactions.at(-1)?.balance ?? 0,
    totalDeposits: sumKind('deposit'),
    totalWithdrawals: sumKind('withdrawal'),
    totalBuys: sumKind('buy'),
    totalSells: sumKind('sell'),
    netInvested: roundMoney(sumKind('buy') - sumKind('sell')),
    passiveIncome: sumKind('dividend') + sumKind('interest'),
    dividends: sumKind('dividend'),
    interest: sumKind('interest'),
    bonus: sumKind('bonus'),
    cardSpend: sumKind('card'),
    cardRefunds: sumKind('card_refund'),
    accountFees: sumKind('fee'),
    taxes: sumKind('tax'),
    declaredFees: sum(transactions.map((tx) => tx.feesDeclared)),
  };
}

function buildMonthly(transactions) {
  const months = groupBy(transactions, (tx) => tx.month);
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, items]) => ({
    month,
    deposits: sumKind(items, 'deposit'),
    withdrawals: sumKind(items, 'withdrawal'),
    buys: sumKind(items, 'buy'),
    sells: sumKind(items, 'sell'),
    dividends: sumKind(items, 'dividend'),
    interest: sumKind(items, 'interest'),
    bonus: sumKind(items, 'bonus'),
    cardSpend: sumKind(items, 'card'),
    netCashFlow: sum(items.map((tx) => tx.signedAmount)),
    endBalance: items.at(-1)?.balance ?? 0,
    transactionCount: items.length,
  }));
}

function buildAssets(transactions) {
  const assetTransactions = transactions.filter((transaction) => transaction.asset);
  const grouped = groupBy(assetTransactions, (transaction) => transaction.asset.isin);

  return [...grouped.entries()]
    .map(([isin, items]) => assetSummary(isin, items))
    .sort((a, b) => b.netInvested - a.netInvested)
    .map((asset, _, list) => ({ ...asset, weight: percent(asset.netInvested, sumPositiveNetInvested(list)) }));
}

function assetSummary(isin, items) {
  const sample = items.find((item) => item.asset.name !== isin)?.asset ?? items[0].asset;
  const quantityDelta = sumQuantity(items.map((item) => quantityImpact(item)));
  const quantityRows = items.filter((item) => Number.isFinite(item.asset?.quantity)).length;

  return {
    isin,
    name: sample.name,
    buyAmount: sumKind(items, 'buy'),
    sellAmount: sumKind(items, 'sell'),
    dividendAmount: sumKind(items, 'dividend'),
    netInvested: roundMoney(sumKind(items, 'buy') - sumKind(items, 'sell')),
    transactionCount: items.length,
    buyCount: items.filter((item) => item.kind === 'buy').length,
    sellCount: items.filter((item) => item.kind === 'sell').length,
    dividendCount: items.filter((item) => item.kind === 'dividend').length,
    quantityDelta,
    quantityRows,
    firstDate: items[0]?.date ?? null,
    lastDate: items.at(-1)?.date ?? null,
  };
}

function buildCategoryBreakdown(transactions) {
  return [...groupBy(transactions, (tx) => tx.category).entries()]
    .map(([category, items]) => ({ category, amount: sum(items.map((tx) => tx.amount)), count: items.length }))
    .sort((a, b) => b.amount - a.amount);
}

function buildMerchantBreakdown(transactions) {
  const cardTransactions = transactions.filter((transaction) => transaction.kind === 'card');
  return [...groupBy(cardTransactions, merchantName).entries()]
    .map(([merchant, items]) => ({ merchant, amount: sum(items.map((tx) => tx.amount)), count: items.length }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12);
}

function buildDiagnostics(summary, meta) {
  return {
    inflowDiff: diffOrNull(summary.totalInflows, meta.expectedInflows),
    outflowDiff: diffOrNull(summary.totalOutflows, meta.expectedOutflows),
    finalBalanceDiff: diffOrNull(summary.finalBalance, meta.expectedFinalBalance),
  };
}

function buildCoverage(transactions, assets, meta, diagnostics) {
  const assetTransactions = transactions.filter((transaction) => transaction.asset?.isin);
  return {
    pageCount: meta.pageCount ?? null,
    extractedLineCount: meta.extractedLineCount ?? null,
    assetCount: assets.length,
    transactionsWithIsin: assetTransactions.length,
    transactionsWithQuantity: assetTransactions.filter((transaction) => Number.isFinite(transaction.asset?.quantity)).length,
    unknownTransactionCount: transactions.filter((transaction) => transaction.kind.startsWith('other')).length,
    reconciled: [diagnostics.inflowDiff, diagnostics.outflowDiff, diagnostics.finalBalanceDiff]
      .filter((value) => value !== null)
      .every((value) => Math.abs(value) <= 0.01),
  };
}

function buildAudit(summary, meta, diagnostics, coverage) {
  return {
    direct: [
      auditItem('period', 'Période du relevé', meta.periodLabel || 'Non trouvée', 'En-tête DATE du PDF'),
      auditItem('openingBalance', 'Solde initial', meta.openingBalance, 'Bloc Compte courant du PDF'),
      auditItem('expectedInflows', 'Entrées déclarées', meta.expectedInflows, 'Bloc Compte courant du PDF'),
      auditItem('expectedOutflows', 'Sorties déclarées', meta.expectedOutflows, 'Bloc Compte courant du PDF'),
      auditItem('expectedFinalBalance', 'Solde final déclaré', meta.expectedFinalBalance, 'Bloc Compte courant du PDF'),
      auditItem('pages', 'Pages lues', coverage.pageCount, 'PDF chargé dans le navigateur'),
    ],
    calculated: [
      auditFormula('transactionAmounts', 'Montant de chaque transaction', 'solde après transaction - solde précédent', summary.transactionCount),
      auditFormula('monthlyTotals', 'Totaux mensuels', 'somme des transactions par mois et par type', null),
      auditFormula('assetCost', 'Coût net par ISIN', 'achats portefeuille - ventes portefeuille pour chaque ISIN trouvé', coverage.assetCount),
      auditFormula('reconciliation', 'Rapprochement comptable', `écarts: entrées ${diagnostics.inflowDiff}, sorties ${diagnostics.outflowDiff}, solde ${diagnostics.finalBalanceDiff}`, null),
    ],
    unavailable: [
      unavailableItem('marketValue', 'Valeur de marché actuelle', 'absente du relevé de compte'),
      unavailableItem('unrealizedPnl', 'Plus-value ou moins-value latente', 'cours actuels et prix de revient fiscal non fournis'),
      unavailableItem('currentAllocation', 'Allocation réelle actuelle', 'le PDF donne des flux cash, pas les valorisations de positions'),
      unavailableItem('taxReturn', 'Déclaration fiscale complète', 'les lignes de taxes visibles ne suffisent pas à produire une déclaration'),
      unavailableItem('riskScore', 'Score de risque ou avis expert', 'aucun prix de marché, volatilité ou profil investisseur dans le PDF'),
    ],
  };
}

function auditItem(key, label, value, source) {
  return { key, label, value, source, basis: 'pdf' };
}

function auditFormula(key, label, formula, count) {
  return { key, label, formula, count, basis: 'calculated' };
}

function unavailableItem(key, label, reason) {
  return { key, label, reason, basis: 'unavailable' };
}

function enrichAssetNames(transactions) {
  const names = new Map();
  for (const transaction of transactions) {
    if (!transaction.asset?.name || transaction.asset.name === transaction.asset.isin) continue;
    if (!['buy', 'sell'].includes(transaction.kind) && !CRYPTO_NAMES[transaction.asset.isin]) continue;

    const current = names.get(transaction.asset.isin);
    if (!current || assetNameScore(transaction.asset.name) > assetNameScore(current)) {
      names.set(transaction.asset.isin, transaction.asset.name);
    }
  }
  for (const transaction of transactions) {
    if (transaction.asset && names.has(transaction.asset.isin)) {
      transaction.asset.name = names.get(transaction.asset.isin);
    }
  }
}

function assetNameScore(name) {
  const suspicious = /(Savings plan|Cash Dividend|Rendement|Virement|Avoir|Exécution|d'ordre)/i.test(name);
  const lengthPenalty = Math.max(0, name.length - 85) / 10;
  return 100 - lengthPenalty - (suspicious ? 80 : 0);
}

function currenciesFromRows(rows) {
  return allRowText(rows).match(CURRENCY_PATTERN)?.map(parseCurrency) ?? [];
}

function cleanDescription(description) {
  return normalizeSpaces(description.replace(CURRENCY_PATTERN, '').replace(/\s+,/g, ','));
}

function sanitizeSensitive(description) {
  return description
    .replace(HONORIFIC_PERSON_PATTERN, 'Compte personnel')
    .replace(TRANSFER_FROM_NAME_PATTERN, '$1 Compte personnel')
    .replace(BANK_ID_NAME_PATTERN, 'Compte personnel')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, '[IBAN masqué]')
    .replace(/\bBIC\s+[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi, 'BIC [BIC masqué]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id masqué]');
}

function allRowText(rows) {
  return normalizeSpaces(rows.map((row) => row.text).join(' '));
}

function dateColumnText(row) {
  return normalizeSpaces(row.fragments.filter((fragment) => fragment.x < 96).map((fragment) => fragment.text).join(' '));
}

function extractDeclaredFee(description) {
  const fee = description.match(/\bfee:\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1];
  return fee ? Number.parseFloat(fee.replace(',', '.')) : 0;
}

function transactionClass(kind, category) {
  return { kind, category };
}

function sumKind(items, kind) {
  return sum(items.filter((item) => item.kind === kind).map((item) => item.amount));
}

function quantityImpact(transaction) {
  if (!Number.isFinite(transaction.asset?.quantity)) return 0;
  return transaction.kind === 'sell' ? -transaction.asset.quantity : transaction.asset.quantity;
}

function merchantName(transaction) {
  return normalizeSpaces(transaction.description.replace(/^Avoir\s+/i, '').replace(CURRENCY_PATTERN, '')).slice(0, 40) || 'Carte';
}

function isNoiseLine(text) {
  return /^(TRADE REPUBLIC|Trade Republic Bank|c\/o Regus|75008 Paris|900 796|www\.traderepublic|TVA |Siège social|Brunnenstrasse|Registre du commerce|Charlottenburg|Directeurs Généraux|Andreas|Gernot|Christian|Thomas|Généré le|Page \d+)/.test(text);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function normalizeMonth(month) {
  return month.trim().toLowerCase();
}

function normalizeSpaces(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function sum(values) {
  return roundMoney(values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0));
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function sumQuantity(values) {
  return roundQuantity(values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0));
}

function percent(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function sumPositiveNetInvested(assets) {
  return sum(assets.filter((asset) => asset.netInvested > 0).map((asset) => asset.netInvested));
}

function diffOrNull(actual, expected) {
  return expected === null || expected === undefined ? null : roundMoney(actual - expected);
}
