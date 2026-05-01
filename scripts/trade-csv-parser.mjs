export const TRADE_CSV_HEADERS = [
  'datetime',
  'date',
  'account_type',
  'category',
  'type',
  'asset_class',
  'name',
  'symbol',
  'shares',
  'price',
  'amount',
  'fee',
  'tax',
  'currency',
  'original_amount',
  'original_currency',
  'fx_rate',
  'description',
  'transaction_id',
  'counterparty_name',
  'counterparty_iban',
  'payment_reference',
  'mcc_code',
];

const FIELD_USAGE = {
  datetime: 'Horodatage exact et ordre intrajournalier',
  date: 'Période, mois, chronologie',
  account_type: 'Contrôle de périmètre de compte',
  category: 'Segmentation Trading / Cash / Delivery / Corporate action',
  type: 'Nature d’opération et logique de calcul',
  asset_class: 'Répartition actions, ETF/fonds, crypto, dérivés, private fund',
  name: 'Nom affiché de l’instrument',
  symbol: 'Identifiant instrument: ISIN, ticker crypto ou symbole',
  shares: 'Quantités achetées, vendues, livrées ou ajustées',
  price: 'Prix d’exécution et prix moyens',
  amount: 'Flux brut en devise de compte',
  fee: 'Frais explicites par opération',
  tax: 'Taxes explicites par opération',
  currency: 'Devise de compte',
  original_amount: 'Montant source pour revenus en devise étrangère',
  original_currency: 'Devise source',
  fx_rate: 'Taux FX fourni',
  description: 'Fallback descriptif, sanitisé si affiché',
  transaction_id: 'Déduplication et couverture, non affiché brut',
  counterparty_name: 'Champ cash parsé, agrégé seulement',
  counterparty_iban: 'Champ cash parsé, masqué',
  payment_reference: 'Référence paiement si présente',
  mcc_code: 'Analyse carte cash secondaire',
};

const CASH_INCOME_TYPES = new Set(['DIVIDEND', 'DISTRIBUTION', 'INTEREST_PAYMENT', 'BENEFITS_SAVEBACK', 'BONUS', 'STOCKPERK', 'GIFT']);
const BUY_TYPES = new Set(['BUY', 'PRIVATE_MARKET_BUY']);
const SELL_TYPES = new Set(['SELL']);
const DELIVERY_TYPES = new Set(['FREE_RECEIPT', 'FREE_DELIVERY', 'MIGRATION', 'CORRECTION']);
const CORPORATE_QUANTITY_TYPES = new Set(['STOCK_DIVIDEND', 'CAPITAL_INCR_CORP_FUNDS', 'SPLIT']);

export function buildTradeCsvAnalysis(csvText, options = {}) {
  const { headers, rows } = parseCsvObjects(csvText);
  validateHeaders(headers);

  const normalized = rows.map((row, index) => normalizeRow(row, index + 1));
  const sorted = normalized.sort((a, b) => a.datetime.localeCompare(b.datetime) || a.rowNumber - b.rowNumber);
  const assets = buildAssetAnalysis(sorted);
  const monthly = buildMonthlyTrading(sorted);
  const assetClasses = buildAssetClassBreakdown(assets);
  const fieldCoverage = buildFieldCoverage(headers, rows);
  const categories = countBreakdown(sorted, 'category');
  const types = countBreakdown(sorted, 'type');
  const tradingTransactions = sorted.filter(isTradingExecution);
  const investmentRows = sorted.filter(isInvestmentRow);
  const summary = buildSummary(sorted, assets, monthly, tradingTransactions, investmentRows);
  const cash = buildCashContext(sorted);
  const audit = buildCsvAudit(headers, fieldCoverage, summary, cash);

  return {
    sourceType: 'csv',
    generatedAt: new Date().toISOString(),
    meta: {
      fileName: options.fileName ?? 'Transaction export.csv',
      rowCount: sorted.length,
      columnCount: headers.length,
      headers,
      periodLabel: summary.periodLabel,
    },
    summary,
    cash,
    trading: {
      transactions: tradingTransactions,
      investmentRows,
      assets,
      monthly,
      assetClasses,
      categories,
      types,
      fieldCoverage,
    },
    categories: categories.map((item) => ({ category: item.label, amount: item.amount, count: item.count })),
    monthly,
    assets,
    transactions: sorted,
    audit,
  };
}

export function parseCsvObjects(csvText) {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) throw new Error('CSV vide ou sans lignes de transactions.');
  const headers = matrix[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  const rows = matrix.slice(1).filter((row) => row.some((field) => field.trim() !== '')).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] ?? '';
    });
    return object;
  });
  return { headers, rows };
}

export function parseCsvMatrix(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function validateHeaders(headers) {
  const missing = TRADE_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Colonnes CSV manquantes: ${missing.join(', ')}.`);
}

function normalizeRow(row, rowNumber) {
  const amount = num(row.amount);
  const fee = num(row.fee);
  const tax = num(row.tax);
  const shares = num(row.shares);
  const price = num(row.price);
  const date = row.date || row.datetime.slice(0, 10);

  return {
    rowNumber,
    datetime: row.datetime,
    date,
    month: date.slice(0, 7),
    accountType: row.account_type,
    category: row.category,
    type: row.type,
    assetClass: row.asset_class || 'UNSPECIFIED',
    name: row.name || row.symbol || row.type,
    symbol: row.symbol,
    shares,
    price,
    amount,
    fee,
    tax,
    currency: row.currency,
    originalAmount: num(row.original_amount),
    originalCurrency: row.original_currency,
    fxRate: num(row.fx_rate),
    description: sanitizeText(row.description),
    transactionId: row.transaction_id,
    hasCounterpartyName: Boolean(row.counterparty_name),
    hasCounterpartyIban: Boolean(row.counterparty_iban),
    hasPaymentReference: Boolean(row.payment_reference),
    mccCode: row.mcc_code,
    cashImpact: roundMoney((amount ?? 0) + (fee ?? 0) + (tax ?? 0)),
  };
}

function buildAssetAnalysis(rows) {
  const groups = groupBy(rows.filter((row) => row.symbol), (row) => row.symbol);
  const assets = [...groups.entries()].map(([symbol, items]) => summarizeAsset(symbol, items));
  const positiveCost = sum(assets.filter((asset) => asset.openCostBasis > 0).map((asset) => asset.openCostBasis));
  return assets
    .map((asset) => ({ ...asset, openCostWeight: positiveCost > 0 ? (asset.openCostBasis / positiveCost) * 100 : 0 }))
    .sort((a, b) => b.openCostBasis - a.openCostBasis);
}

function summarizeAsset(symbol, rows) {
  const ordered = [...rows].sort((a, b) => a.datetime.localeCompare(b.datetime) || a.rowNumber - b.rowNumber);
  const lots = [];
  let quantityBought = 0;
  let quantitySold = 0;
  let deliveryQuantity = 0;
  let corporateQuantity = 0;
  let buyAmount = 0;
  let sellAmount = 0;
  let buyCash = 0;
  let sellCash = 0;
  let tradingFees = 0;
  let tradingTaxes = 0;
  let realizedPnl = 0;
  let realizedCostBasis = 0;
  let matchedSellQuantity = 0;
  let unmatchedSellQuantity = 0;

  for (const row of ordered) {
    const qty = Math.abs(row.shares ?? 0);
    const feeAbs = Math.abs(row.fee ?? 0);
    const taxAbs = Math.abs(row.tax ?? 0);

    if (BUY_TYPES.has(row.type)) {
      const cost = Math.abs(row.amount ?? 0) + feeAbs + taxAbs;
      quantityBought = roundQuantity(quantityBought + qty);
      buyAmount = roundMoney(buyAmount + Math.abs(row.amount ?? 0));
      buyCash = roundMoney(buyCash + cost);
      tradingFees = roundMoney(tradingFees + feeAbs);
      tradingTaxes = roundMoney(tradingTaxes + taxAbs);
      if (qty > 0) lots.push({ qty, unitCost: cost / qty });
    } else if (SELL_TYPES.has(row.type)) {
      const proceeds = (row.amount ?? 0) + (row.fee ?? 0) + (row.tax ?? 0);
      quantitySold = roundQuantity(quantitySold + qty);
      sellAmount = roundMoney(sellAmount + Math.abs(row.amount ?? 0));
      sellCash = roundMoney(sellCash + proceeds);
      tradingFees = roundMoney(tradingFees + feeAbs);
      tradingTaxes = roundMoney(tradingTaxes + taxAbs);
      const matched = consumeLots(lots, qty);
      matchedSellQuantity = roundQuantity(matchedSellQuantity + matched.quantity);
      unmatchedSellQuantity = roundQuantity(unmatchedSellQuantity + Math.max(0, qty - matched.quantity));
      realizedCostBasis = roundMoney(realizedCostBasis + matched.cost);
      realizedPnl = roundMoney(realizedPnl + proceeds * (matched.quantity / Math.max(qty, 1)) - matched.cost);
    } else if (DELIVERY_TYPES.has(row.type)) {
      deliveryQuantity = roundQuantity(deliveryQuantity + (row.shares ?? 0));
    } else if (CORPORATE_QUANTITY_TYPES.has(row.type)) {
      corporateQuantity = roundQuantity(corporateQuantity + (row.shares ?? 0));
      if ((row.shares ?? 0) > 0) lots.push({ qty: row.shares, unitCost: 0 });
    }
  }

  const netQuantity = roundQuantity(quantityBought - quantitySold + deliveryQuantity + corporateQuantity);
  const openCostBasis = roundMoney(lots.reduce((total, lot) => total + lot.qty * lot.unitCost, 0));
  const dividends = sum(ordered.filter((row) => ['DIVIDEND', 'DISTRIBUTION'].includes(row.type)).map((row) => row.cashImpact));
  const income = sum(ordered.filter((row) => CASH_INCOME_TYPES.has(row.type)).map((row) => row.cashImpact));
  const sample = ordered.find((row) => row.name && row.name !== symbol) ?? ordered[0];

  return {
    symbol,
    name: sample.name || symbol,
    assetClass: sample.assetClass,
    firstDate: ordered[0]?.date ?? '',
    lastDate: ordered.at(-1)?.date ?? '',
    rowCount: ordered.length,
    tradeCount: ordered.filter(isTradingExecution).length,
    buyCount: ordered.filter((row) => BUY_TYPES.has(row.type)).length,
    sellCount: ordered.filter((row) => SELL_TYPES.has(row.type)).length,
    quantityBought,
    quantitySold,
    deliveryQuantity,
    corporateQuantity,
    netQuantity,
    buyAmount,
    sellAmount,
    buyCash,
    sellCash,
    tradingFees,
    tradingTaxes,
    realizedPnl,
    realizedCostBasis,
    realizedReturnPct: realizedCostBasis > 0 ? (realizedPnl / realizedCostBasis) * 100 : null,
    matchedSellQuantity,
    unmatchedSellQuantity,
    openCostBasis,
    dividends,
    income,
    avgBuyPrice: quantityBought > 0 ? buyAmount / quantityBought : null,
    avgSellPrice: quantitySold > 0 ? sellAmount / quantitySold : null,
  };
}

function consumeLots(lots, quantity) {
  let remaining = quantity;
  let cost = 0;
  let matched = 0;

  while (remaining > 0 && lots.length) {
    const lot = lots[0];
    const used = Math.min(lot.qty, remaining);
    cost += used * lot.unitCost;
    matched += used;
    lot.qty = roundQuantity(lot.qty - used);
    remaining = roundQuantity(remaining - used);
    if (lot.qty <= 0.0000001) lots.shift();
  }

  return { quantity: roundQuantity(matched), cost: roundMoney(cost) };
}

function buildMonthlyTrading(rows) {
  const groups = groupBy(rows, (row) => row.month || 'unknown');
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, items]) => {
    const buys = items.filter((row) => BUY_TYPES.has(row.type));
    const sells = items.filter((row) => SELL_TYPES.has(row.type));
    const executionRows = items.filter((row) => BUY_TYPES.has(row.type) || SELL_TYPES.has(row.type));
    return {
      month,
      buyAmount: sum(buys.map((row) => Math.abs(row.amount ?? 0))),
      sellAmount: sum(sells.map((row) => Math.abs(row.amount ?? 0))),
      tradingFees: sum(executionRows.map((row) => Math.abs(row.fee ?? 0))),
      tradingTaxes: sum(executionRows.map((row) => Math.abs(row.tax ?? 0))),
      buyCount: buys.length,
      sellCount: sells.length,
      investmentEventCount: items.filter(isInvestmentRow).length,
      dividendIncome: sum(items.filter((row) => ['DIVIDEND', 'DISTRIBUTION'].includes(row.type)).map((row) => row.cashImpact)),
      cashContribution: sum(items.filter((row) => ['CUSTOMER_INPAYMENT', 'CUSTOMER_INBOUND', 'TRANSFER_INSTANT_INBOUND', 'TRANSFER_INBOUND'].includes(row.type)).map((row) => row.cashImpact)),
    };
  });
}

function buildAssetClassBreakdown(assets) {
  const groups = groupBy(assets, (asset) => asset.assetClass || 'UNSPECIFIED');
  const total = sum(assets.map((asset) => Math.max(0, asset.openCostBasis)));
  return [...groups.entries()]
    .map(([assetClass, items]) => {
      const openCostBasis = sum(items.map((item) => Math.max(0, item.openCostBasis)));
      return {
        assetClass,
        openCostBasis,
        buyCash: sum(items.map((item) => item.buyCash)),
        sellCash: sum(items.map((item) => item.sellCash)),
        realizedPnl: sum(items.map((item) => item.realizedPnl)),
        assetCount: items.length,
        weight: total > 0 ? (openCostBasis / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.openCostBasis - a.openCostBasis);
}

function buildSummary(rows, assets, monthly, tradingTransactions, investmentRows) {
  const buyRows = rows.filter((row) => BUY_TYPES.has(row.type));
  const sellRows = rows.filter((row) => SELL_TYPES.has(row.type));
  const tradingBuyRows = rows.filter((row) => row.category === 'TRADING' && row.type === 'BUY');
  const tradingSellRows = rows.filter((row) => row.category === 'TRADING' && row.type === 'SELL');
  const executionRows = rows.filter((row) => BUY_TYPES.has(row.type) || SELL_TYPES.has(row.type));
  const tradingFees = sum(executionRows.map((row) => Math.abs(row.fee ?? 0)));
  const tradingTaxes = sum(executionRows.map((row) => Math.abs(row.tax ?? 0)));
  const grossBuys = sum(buyRows.map((row) => Math.abs(row.amount ?? 0)));
  const grossSells = sum(sellRows.map((row) => Math.abs(row.amount ?? 0)));
  const openCostBasis = sum(assets.map((asset) => Math.max(0, asset.openCostBasis)));
  const realizedPnl = sum(assets.map((asset) => asset.realizedPnl));
  const realizedCostBasis = sum(assets.map((asset) => asset.realizedCostBasis));
  const positiveAssets = assets.filter((asset) => asset.openCostBasis > 0);
  const topFiveWeight = sum(positiveAssets.slice(0, 5).map((asset) => asset.openCostWeight));
  const activeTradingMonths = monthly.filter((month) => month.buyAmount > 0 || month.sellAmount > 0).length;
  const roundTrips = assets.filter((asset) => asset.sellCount > 0 && asset.realizedCostBasis > 0);
  const winners = roundTrips.filter((asset) => asset.realizedPnl > 0).length;

  return {
    periodLabel: periodLabel(rows),
    firstDate: rows[0]?.date ?? '',
    lastDate: rows.at(-1)?.date ?? '',
    transactionCount: rows.length,
    csvColumnCount: TRADE_CSV_HEADERS.length,
    tradingRows: tradingTransactions.length,
    investmentRows: investmentRows.length,
    buyOrders: tradingBuyRows.length,
    sellOrders: tradingSellRows.length,
    buyLikeOrders: buyRows.length,
    assetsTraded: assets.filter((asset) => asset.tradeCount > 0).length,
    assetsHeldByCost: positiveAssets.length,
    grossBuys,
    grossSells,
    netDeployed: roundMoney(grossBuys + tradingFees + tradingTaxes - grossSells),
    openCostBasis,
    tradingFees,
    tradingTaxes,
    feeDragPct: grossBuys > 0 ? ((tradingFees + tradingTaxes) / grossBuys) * 100 : 0,
    averageBuyOrder: buyRows.length ? grossBuys / buyRows.length : 0,
    averageSellOrder: sellRows.length ? grossSells / sellRows.length : 0,
    activeTradingMonths,
    peakBuyMonth: [...monthly].sort((a, b) => b.buyAmount - a.buyAmount)[0] ?? null,
    topFiveWeight,
    realizedPnl,
    realizedCostBasis,
    realizedReturnPct: realizedCostBasis > 0 ? (realizedPnl / realizedCostBasis) * 100 : null,
    roundTripCount: roundTrips.length,
    winRate: roundTrips.length ? (winners / roundTrips.length) * 100 : null,
    deliveryEventCount: rows.filter((row) => row.category === 'DELIVERY').length,
    corporateActionCount: rows.filter((row) => row.category === 'CORPORATE_ACTION').length,
    fxRowCount: rows.filter((row) => row.originalCurrency).length,
  };
}

function buildCashContext(rows) {
  const cashRows = rows.filter((row) => row.category === 'CASH');
  const deposits = cashRows.filter((row) => ['CUSTOMER_INPAYMENT', 'CUSTOMER_INBOUND', 'TRANSFER_INSTANT_INBOUND', 'TRANSFER_INBOUND'].includes(row.type));
  const card = cashRows.filter((row) => row.type.startsWith('CARD_TRANSACTION'));
  const dividends = cashRows.filter((row) => ['DIVIDEND', 'DISTRIBUTION'].includes(row.type));
  const interest = cashRows.filter((row) => row.type === 'INTEREST_PAYMENT');
  const bonus = cashRows.filter((row) => ['BENEFITS_SAVEBACK', 'BONUS', 'GIFT', 'STOCKPERK'].includes(row.type));
  const mccGroups = [...groupBy(card.filter((row) => row.mccCode), (row) => row.mccCode).entries()]
    .map(([mccCode, items]) => ({ mccCode, amount: sum(items.map((row) => Math.abs(row.cashImpact))), count: items.length }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  return {
    rowCount: cashRows.length,
    deposits: sum(deposits.map((row) => row.cashImpact)),
    cardSpend: sum(card.map((row) => Math.abs(row.cashImpact))),
    dividends: sum(dividends.map((row) => row.cashImpact)),
    interest: sum(interest.map((row) => row.cashImpact)),
    bonus: sum(bonus.map((row) => row.cashImpact)),
    counterpartyRows: cashRows.filter((row) => row.hasCounterpartyName || row.hasCounterpartyIban).length,
    mccGroups,
  };
}

function buildFieldCoverage(headers, rawRows) {
  return headers.map((field) => {
    const nonEmpty = rawRows.filter((row) => String(row[field] ?? '').trim() !== '').length;
    return {
      field,
      nonEmpty,
      empty: rawRows.length - nonEmpty,
      coveragePct: rawRows.length ? (nonEmpty / rawRows.length) * 100 : 0,
      usedFor: FIELD_USAGE[field] ?? 'Champ parsé',
    };
  });
}

function buildCsvAudit(headers, fieldCoverage, summary, cash) {
  return {
    direct: [
      { key: 'columns', label: 'Colonnes CSV reconnues', value: `${headers.length}/${TRADE_CSV_HEADERS.length}`, source: 'Ligne d’en-tête CSV' },
      { key: 'rows', label: 'Lignes parsées', value: summary.transactionCount, source: 'Toutes les lignes du CSV' },
      { key: 'period', label: 'Période', value: summary.periodLabel, source: 'Champs date/datetime' },
      { key: 'tradingRows', label: 'Lignes TRADING', value: summary.tradingRows, source: 'category + type' },
      { key: 'sensitive', label: 'Champs sensibles', value: `${cash.counterpartyRows} lignes contrepartie parsées et masquées`, source: 'counterparty_name / counterparty_iban' },
    ],
    calculated: [
      { key: 'costBasis', label: 'Coût ouvert estimé', formula: 'lots FIFO des BUY moins quantités SELL, frais et taxes inclus', count: summary.assetsHeldByCost },
      { key: 'realizedPnl', label: 'P/L réalisé estimé', formula: 'produit net SELL - coût FIFO des lots vendus', count: summary.roundTripCount },
      { key: 'feeDrag', label: 'Friction trading', formula: '(frais + taxes) / achats bruts', count: summary.investmentRows },
      { key: 'fieldCoverage', label: 'Couverture de colonnes', formula: 'non-empty count calculé pour chaque colonne CSV', count: fieldCoverage.length },
    ],
    unavailable: [
      { key: 'marketValue', label: 'Valeur de marché actuelle', reason: 'absente du CSV export: pas de dernier prix de marché par position' },
      { key: 'unrealizedPnl', label: 'P/L latent fiable', reason: 'nécessite cours actuels ou valorisation positions, non fournis' },
      { key: 'taxAdvice', label: 'Fiscalité complète', reason: 'les taxes CSV ne suffisent pas à produire un conseil fiscal' },
    ],
  };
}

function countBreakdown(rows, key) {
  return [...groupBy(rows, (row) => row[key] || 'EMPTY').entries()]
    .map(([label, items]) => ({ label, count: items.length, amount: sum(items.map((row) => Math.abs(row.cashImpact))) }))
    .sort((a, b) => b.count - a.count);
}

function isTradingExecution(row) {
  return row.category === 'TRADING' && (BUY_TYPES.has(row.type) || SELL_TYPES.has(row.type));
}

function isInvestmentRow(row) {
  return row.symbol || row.category === 'TRADING' || row.category === 'DELIVERY' || row.category === 'CORPORATE_ACTION' || row.type === 'PRIVATE_MARKET_BUY';
}

function periodLabel(rows) {
  if (!rows.length) return '';
  return `${rows[0].date} → ${rows.at(-1).date}`;
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, '[IBAN masqué]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id masqué]')
    .trim();
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function sum(values) {
  return roundMoney(values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0));
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}
