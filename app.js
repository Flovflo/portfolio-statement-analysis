import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import { extractLinesFromPdfData } from './scripts/pdfjs-extractor.mjs';
import {
  buildAnalysis,
  extractStatementMeta,
  extractTransactionsFromLines,
} from './scripts/statement-parser.mjs';
import { buildTradeCsvAnalysis } from './scripts/trade-csv-parser.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).toString();

const ChartKit = window.ChartKit;
let data = null;
const uploadState = {
  status: 'idle',
  message: 'Dépose ton relevé Trade Republic PDF pour lancer l’analyse.',
  fileName: '',
  fileSize: 0,
};

function portfolioDashboard() {
  const state = { tab: 'overview', category: 'all', search: '' };

  const formatEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  const formatNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const app = document.getElementById('app');

  function render() {
    if (!data) {
      app.innerHTML = renderUploadShell();
      bindUploadControls();
      return;
    }

    app.innerHTML = `${renderHeader()}${renderTabs()}${renderActiveTab()}`;
    bindUploadControls();
    bindTabs();
    bindTransactionControls();
    renderCharts();
  }

  function renderUploadShell() {
    const busy = uploadState.status === 'processing';
    return `
      <section class="upload-hero">
        <div class="upload-copy">
          <h1>Terminal privé pour décoder ton relevé.</h1>
          <p>Un parseur local lit le PDF ou le CSV Trade Republic dans ton navigateur. Le CSV active une analyse trading complète: ordres, frais, P/L réalisé, positions et concentration.</p>
          <div class="upload-status ${uploadState.status}">
            <strong>${esc(statusTitle())}</strong>
            <span>${esc(uploadState.message)}</span>
            ${busy ? '<progress max="100"></progress>' : ''}
          </div>
        </div>
        <label class="drop-zone terminal-window" for="pdf-file" data-drop-zone>
          <div class="terminal-toolbar"><i></i><i></i><i></i><span>local-parser</span></div>
          <input id="pdf-file" data-file-input type="file" accept="application/pdf,.pdf,text/csv,.csv" ${busy ? 'disabled' : ''} />
          <span class="terminal-prompt">run export.csv</span>
          <strong>Choisir ou déposer CSV/PDF</strong>
          <small>Tout reste dans ton navigateur. Aucune API, aucun upload serveur.</small>
        </label>
      </section>
      <section class="panel-grid three upload-notes">
        ${uploadNote('Static build', 'Compatible GitHub Pages: HTML, CSS, JS, PDF.js vendored.')}
        ${uploadNote('CSV 23/23', 'Chaque colonne exportée est parsée, typée et auditée en couverture.')}
        ${uploadNote('Trading first', 'Le CSV pilote les métriques d’ordres, positions, frais et P/L réalisé FIFO.')}
      </section>`;
  }

  function uploadNote(title, body) {
    return `<article class="analysis-card compact-card"><h2>${esc(title)}</h2><p>${esc(body)}</p></article>`;
  }

  function statusTitle() {
    if (uploadState.status === 'processing') return 'Extraction en cours';
    if (uploadState.status === 'error') return 'Import impossible';
    if (uploadState.status === 'done') return 'Analyse prête';
    return 'Prêt';
  }

  function renderHeader() {
    if (isCsvReport()) return renderCsvHeader();
    const d = data.diagnostics;
    const ok = [d.inflowDiff, d.outflowDiff, d.finalBalanceDiff].every((value) => value === 0);
    return `
      <header class="topbar">
        <div class="title-block">
          <div class="meta-line">Trade Republic / ${esc(data.summary.periodLabel)}</div>
          <h1>Rapport comptable du relevé.</h1>
          <p>Un rapport strict: champs lus dans le PDF, calculs dérivés des soldes, dates, montants, libellés et ISIN extraits. Rien d’inventé.</p>
        </div>
        <div class="header-actions">
          <div class="terminal-window terminal-readout">
            <div class="terminal-toolbar"><i></i><i></i><i></i><span>audit.log</span></div>
            <div class="audit-pill ${ok ? 'is-ok' : 'is-warning'}">
              <span>reconcile --statement</span>
              <strong>${ok ? 'OK · 0,00 €' : 'Écart détecté'}</strong>
            </div>
            <div class="terminal-matrix">
              <div><span>tx</span><strong>${int(data.summary.transactionCount)}</strong></div>
              <div><span>pages</span><strong>${int(data.coverage.pageCount || 0)}</strong></div>
              <div><span>isin</span><strong>${int(data.coverage.assetCount)}</strong></div>
            </div>
          </div>
          <label class="replace-file">
            <input data-pdf-input type="file" accept="application/pdf,.pdf" />
            Importer un autre PDF
          </label>
        </div>
      </header>`;
  }

  function renderCsvHeader() {
    return `
      <header class="topbar">
        <div class="title-block">
          <div class="meta-line">Transaction export / ${esc(data.summary.periodLabel)}</div>
          <h1>Trading report du CSV.</h1>
          <p>Analyse centrée sur les opérations de marché: tous les champs du CSV sont parsés, les champs cash restent en contexte, les champs sensibles sont masqués ou agrégés.</p>
        </div>
        <div class="header-actions">
          <div class="terminal-window terminal-readout">
            <div class="terminal-toolbar"><i></i><i></i><i></i><span>trading.csv</span></div>
            <div class="audit-pill is-ok">
              <span>parse --columns</span>
              <strong>${int(data.meta.columnCount)}/${int(data.summary.csvColumnCount)} · OK</strong>
            </div>
            <div class="terminal-matrix">
              <div><span>orders</span><strong>${int(data.summary.tradingRows)}</strong></div>
              <div><span>assets</span><strong>${int(data.summary.assetsHeldByCost)}</strong></div>
              <div><span>fifo pnl</span><strong>${eur(data.summary.realizedPnl)}</strong></div>
            </div>
          </div>
          <label class="replace-file">
            <input data-file-input type="file" accept="application/pdf,.pdf,text/csv,.csv" />
            Importer un autre fichier
          </label>
        </div>
      </header>`;
  }

  function renderTabs() {
    const tabs = isCsvReport() ? [
      ['overview', 'Trading'],
      ['instruments', 'Positions'],
      ['flows', 'Activité'],
      ['income', 'P/L & frais'],
      ['controls', 'Audit CSV'],
      ['transactions', 'Ordres'],
    ] : [
      ['overview', 'Synthèse'],
      ['instruments', 'Instruments'],
      ['flows', 'Flux'],
      ['income', 'Revenus & frais'],
      ['controls', 'Contrôles'],
      ['transactions', 'Transactions'],
    ];
    return `<nav class="tabs" aria-label="Sections du rapport">${tabs.map(([id, label]) => `<button class="${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>`;
  }

  function renderActiveTab() {
    if (isCsvReport()) return renderCsvActiveTab();
    if (state.tab === 'instruments') return renderInstruments();
    if (state.tab === 'flows') return renderFlows();
    if (state.tab === 'income') return renderIncome();
    if (state.tab === 'controls') return renderControls();
    if (state.tab === 'transactions') return renderTransactions();
    return renderOverview();
  }

  function renderCsvActiveTab() {
    if (state.tab === 'instruments') return renderCsvPositions();
    if (state.tab === 'flows') return renderCsvActivity();
    if (state.tab === 'income') return renderCsvPerformance();
    if (state.tab === 'controls') return renderCsvControls();
    if (state.tab === 'transactions') return renderTransactions();
    return renderCsvOverview();
  }

  function renderCsvOverview() {
    return `
      <section class="kpi-grid">${renderKpis()}</section>
      <section class="panel-grid two">
        ${analysisPanel('Lecture trading', csvTradingFindings())}
        ${analysisPanel('Diagnostic exécution', csvExecutionFindings())}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Achats / ventes mensuels', 'Montants bruts issus des champs amount, fee, tax et type.', 'csv-monthly-trades')}
        ${chartPanel('Allocation par classe', 'Coût ouvert estimé par asset_class, sans valeur de marché actuelle.', 'csv-asset-class-donut', 'legend-csv-asset-class')}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Top coût ouvert', 'Lots FIFO restants après ventes, frais et taxes inclus.', 'csv-top-open-cost')}
        ${chartPanel('Friction par instrument', 'Frais + taxes explicites sur ordres BUY/SELL.', 'csv-fee-drag')}
      </section>`;
  }

  function renderCsvPositions() {
    return `
      <section class="panel-grid two">
        ${analysisPanel('Concentration', csvConcentrationFindings())}
        ${analysisPanel('Limites volontairement non inventées', csvUnavailableFindings())}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Top positions au coût', 'Coût ouvert FIFO par instrument.', 'csv-top-open-cost-wide')}
        ${chartPanel('Classes d’actifs', 'Répartition des coûts ouverts par asset_class.', 'csv-asset-class-bars')}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Positions reconstruites</h2><p>Quantités, prix moyens, coût ouvert, ventes réalisées et revenus par instrument.</p></div>
        ${csvAssetTable()}
      </section>`;
  }

  function renderCsvActivity() {
    return `
      <section class="panel-grid two">
        ${analysisPanel('Rythme d’investissement', csvActivityFindings())}
        ${chartPanel('Types d’évènements', 'Toutes les valeurs du champ type, trading et cash inclus.', 'csv-type-bars')}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Montants mensuels', 'Achats, ventes et frais/taxes par mois.', 'csv-monthly-trades-wide')}
        ${chartPanel('Apports cash contexte', 'Cash uniquement en support du trading.', 'csv-cash-context')}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Activité mensuelle</h2><p>Ordres BUY/SELL, frais, taxes, revenus et apports cash par mois.</p></div>
        ${csvMonthlyTable()}
      </section>`;
  }

  function renderCsvPerformance() {
    return `
      <section class="kpi-grid compact">${renderCsvPerformanceKpis()}</section>
      <section class="panel-grid two">
        ${analysisPanel('P/L réalisé FIFO', csvPerformanceFindings())}
        ${analysisPanel('Frais et taxes', csvFeeFindings())}
      </section>
      <section class="panel-grid two">
        ${chartPanel('P/L réalisé positif', 'Uniquement les instruments avec ventes et P/L FIFO positif.', 'csv-realized-winners')}
        ${chartPanel('Revenus instruments', 'Dividendes, distributions, perks et bonus liés aux instruments.', 'csv-income-assets')}
      </section>`;
  }

  function renderCsvControls() {
    return `
      <section class="panel-grid two">
        ${analysisPanel('100 % des champs parsés', csvCoverageFindings())}
        ${analysisPanel('Protection données privées', csvPrivacyFindings())}
      </section>
      <section class="panel-grid two">
        ${auditTablePanel('Lu directement', data.audit.direct)}
        ${auditFormulaPanel('Calculé', data.audit.calculated)}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Couverture des colonnes CSV</h2><p>Chaque colonne est lue, typée quand applicable, comptée et reliée à un usage analytique.</p></div>
        ${csvFieldCoverageTable()}
      </section>`;
  }

  function renderOverview() {
    const metrics = derivedMetrics();
    return `
      <section class="kpi-grid">${renderKpis(metrics)}</section>
      <section class="panel-grid two">
        ${analysisPanel('Données lues dans le PDF', directFindings())}
        ${analysisPanel('Calculs effectués', calculatedFindings(metrics))}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Flux mensuels calculés', 'Sommes mensuelles issues des transactions reconstruites.', 'monthly-flow')}
        ${chartPanel('Solde après transactions', 'Dernier solde observé chaque mois dans le relevé.', 'cash-line')}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Répartition par type de flux', 'Montants cumulés par catégories extraites des libellés.', 'category-donut', 'legend-category')}
        ${chartPanel('Top ISIN au coût net', 'Achats moins ventes, uniquement pour les ISIN trouvés dans le PDF.', 'top-assets')}
      </section>`;
  }

  function renderInstruments() {
    const metrics = derivedMetrics();
    return `
      <section class="panel-grid two">
        ${analysisPanel('Lecture des instruments', instrumentFindings(metrics))}
        ${analysisPanel('Données indisponibles', unavailableFindings())}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Coût net par ISIN', 'Achats portefeuille moins ventes portefeuille par identifiant trouvé.', 'top-assets-wide')}
        ${chartPanel('Poids cumulé du coût net', 'Part cumulée des ISIN triés par coût net positif.', 'concentration-bars')}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Instruments trouvés</h2><p>ISIN, nom extrait, achats, ventes, dividendes et quantités quand le libellé les donne.</p></div>
        ${assetTable()}
      </section>`;
  }

  function renderFlows() {
    const metrics = derivedMetrics();
    return `
      <section class="panel-grid two">
        ${analysisPanel('Flux calculés', flowFindings(metrics))}
        ${chartPanel('Mois avec achats', 'Intensité mensuelle des achats portefeuille calculés.', 'buy-heatmap')}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Entrées et usages du cash', 'Totaux extraits ou calculés par type de transaction.', 'deployment-bars')}
        ${chartPanel('Solde mensuel observé', 'Dernier solde disponible pour chaque mois.', 'monthly-cash-bars')}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Lecture mensuelle</h2><p>Apports, achats, ventes, carte, revenus et solde.</p></div>
        ${monthlyTable()}
      </section>`;
  }

  function renderIncome() {
    const metrics = derivedMetrics();
    return `
      <section class="kpi-grid compact">${renderIncomeKpis(metrics)}</section>
      <section class="panel-grid two">
        ${chartPanel('Revenus mensuels', 'Dividendes, intérêts et bonus/saveback.', 'income-bars')}
        ${chartPanel('Marchands carte principaux', 'Dépenses carte détectées dans le relevé.', 'merchant-bars')}
      </section>
      <section class="panel-grid two">
        ${analysisPanel('Revenus calculés', incomeFindings(metrics))}
        ${analysisPanel('Frais et taxes détectés', feeFindings(metrics))}
      </section>`;
  }

  function renderControls() {
    return `
      <section class="panel-grid two">
        ${analysisPanel('Données non inventées', unavailableFindings())}
        ${analysisPanel('Couverture d’extraction', coverageFindings())}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Rapprochement au relevé</h2><p>Comparaison entre le bloc Compte courant du PDF et les transactions reconstruites.</p></div>
        ${reconciliationTable()}
      </section>
      <section class="panel-grid two">
        ${auditTablePanel('Lu directement', data.audit.direct)}
        ${auditFormulaPanel('Calculé', data.audit.calculated)}
      </section>`;
  }

  function renderTransactions() {
    const categories = isCsvReport()
      ? ['all', ...data.trading.types.filter((item) => ['BUY', 'SELL'].includes(item.label)).map((item) => item.label)]
      : ['all', ...data.categories.map((item) => item.category)];
    const rows = filteredTransactions();
    return `
      <section class="data-panel">
        <div class="panel-head with-controls">
          <div><h2>${isCsvReport() ? 'Journal des ordres' : 'Journal reconstruit'}</h2><p id="transaction-count">${rows.length} transactions filtrées, affichage limité aux 300 plus récentes.</p></div>
          <div class="controls">
            <select id="category-filter">${categories.map((cat) => `<option value="${esc(cat)}" ${state.category === cat ? 'selected' : ''}>${cat === 'all' ? 'Tous types' : esc(cat)}</option>`).join('')}</select>
            <input id="search-filter" type="search" value="${esc(state.search)}" placeholder="Chercher un actif, marchand, type..." />
          </div>
        </div>
        <div id="transaction-table-slot">${transactionTable(rows.slice(0, 300))}</div>
      </section>`;
  }

  function renderKpis(metrics) {
    if (isCsvReport()) {
      return [
        kpi('Ordres trading', data.summary.tradingRows, `${data.summary.buyOrders} BUY · ${data.summary.sellOrders} SELL`, 'integer'),
        kpi('Achats bruts', data.summary.grossBuys, `${data.summary.buyOrders} ordres BUY`),
        kpi('Ventes brutes', data.summary.grossSells, `${data.summary.sellOrders} ordres SELL`),
        kpi('Coût ouvert estimé', data.summary.openCostBasis, 'Lots FIFO restants'),
        kpi('P/L réalisé FIFO', data.summary.realizedPnl, data.summary.realizedReturnPct === null ? 'Aucune vente matchée' : `${formatNumber.format(data.summary.realizedReturnPct)} % réalisé`),
        kpi('Frais + taxes trading', data.summary.tradingFees + data.summary.tradingTaxes, `${formatNumber.format(data.summary.feeDragPct)} % des achats bruts`),
        kpi('Actifs au coût', data.summary.assetsHeldByCost, `${data.summary.assetsTraded} instruments tradés`, 'integer'),
        kpi('Top 5 concentration', data.summary.topFiveWeight, 'Poids du coût ouvert', 'percent'),
      ].join('');
    }
    return [
      kpi('Solde initial PDF', data.summary.openingBalance, 'Bloc Compte courant'),
      kpi('Entrées PDF', data.summary.expectedInflows, `Calculé: ${eur(data.summary.totalInflows)}`),
      kpi('Sorties PDF', data.summary.expectedOutflows, `Calculé: ${eur(data.summary.totalOutflows)}`),
      kpi('Solde final PDF', data.summary.expectedFinalBalance, `Calculé: ${eur(data.summary.finalBalance)}`),
      kpi('Transactions', data.summary.transactionCount, `${data.coverage.pageCount || 'n/a'} pages lues`, 'integer'),
      kpi('ISIN trouvés', data.coverage.assetCount, `${data.coverage.transactionsWithIsin} lignes avec ISIN`, 'integer'),
      kpi('Coût net ISIN', metrics.netInvested, 'Achats - ventes par ISIN'),
      kpi('Catégorie inconnue', data.coverage.unknownTransactionCount, 'Libellés non classés', 'integer'),
    ].join('');
  }

  function renderIncomeKpis(metrics) {
    return [
      kpi('Dividendes', data.summary.dividends, `${pct(data.summary.dividends, metrics.netInvested)} du coût net ISIN`),
      kpi('Intérêts cash', data.summary.interest, 'Somme des lignes intérêts'),
      kpi('Bonus / saveback', data.summary.bonus, 'Somme des lignes bonus'),
      kpi('Frais + taxes', data.summary.accountFees + data.summary.taxes, `Frais déclarés: ${eur(data.summary.declaredFees)}`),
    ].join('');
  }

  function renderCsvPerformanceKpis() {
    return [
      kpi('P/L réalisé', data.summary.realizedPnl, 'Produit net SELL - coût FIFO'),
      kpi('Return réalisé', data.summary.realizedReturnPct, `${data.summary.roundTripCount} instruments vendus`, 'percentNullable'),
      kpi('Win rate réalisé', data.summary.winRate, 'Sur instruments avec vente matchée', 'percentNullable'),
      kpi('Friction trading', data.summary.tradingFees + data.summary.tradingTaxes, `${formatNumber.format(data.summary.feeDragPct)} % des achats bruts`),
    ].join('');
  }

  function kpi(label, value, note, type = 'currency') {
    const formatted = formatKpiValue(value, type);
    return `<article class="kpi"><span>${esc(label)}</span><strong>${esc(formatted)}</strong><small>${esc(note)}</small></article>`;
  }

  function formatKpiValue(value, type) {
    if (type === 'integer') return int(value);
    if (type === 'number') return Number.isFinite(value) ? formatNumber.format(value) : 'n/a';
    if (type === 'percent') return Number.isFinite(value) ? `${formatNumber.format(value)} %` : 'n/a';
    if (type === 'percentNullable') return Number.isFinite(value) ? `${formatNumber.format(value)} %` : 'Non calculable';
    return eur(value);
  }

  function analysisPanel(title, items) {
    return `<article class="analysis-card"><h2>${esc(title)}</h2><div class="finding-list">${items.map(findingItem).join('')}</div></article>`;
  }

  function findingItem(item) {
    return `<div class="finding ${item.tone || 'neutral'}"><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div>`;
  }

  function chartPanel(title, subtitle, chartId, legendId = '') {
    return `
      <article class="chart-panel">
        <div class="panel-head"><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
        <div id="${chartId}" class="chart-slot"></div>
        ${legendId ? `<div id="${legendId}" class="legend"></div>` : ''}
      </article>`;
  }

  function csvTradingFindings() {
    const peak = data.summary.peakBuyMonth;
    return [
      { title: 'Source CSV complète', body: `${int(data.summary.transactionCount)} lignes et ${int(data.meta.columnCount)} colonnes parsées. ${int(data.summary.tradingRows)} ordres BUY/SELL détectés.` },
      { title: 'Comportement dominant', body: `${int(data.summary.buyOrders)} achats contre ${int(data.summary.sellOrders)} ventes: profil surtout accumulation, pas trading haute rotation.` },
      { title: 'Mois le plus chargé', body: peak ? `${peak.month}: ${eur(peak.buyAmount)} d’achats bruts sur ${int(peak.buyCount)} ordres.` : 'Aucun mois avec achat.' },
    ];
  }

  function csvExecutionFindings() {
    return [
      { title: 'Ticket moyen BUY', body: `${eur(data.summary.averageBuyOrder)} par achat, calculé depuis amount sur les lignes type=BUY.` },
      { title: 'Friction explicite', body: `${eur(data.summary.tradingFees + data.summary.tradingTaxes)} de frais/taxes trading, soit ${formatNumber.format(data.summary.feeDragPct)} % des achats bruts.`, tone: data.summary.feeDragPct > 1 ? 'warning' : 'neutral' },
      { title: 'P/L réalisé', body: data.summary.realizedReturnPct === null ? 'Pas assez de ventes matchées pour calculer un rendement réalisé.' : `${eur(data.summary.realizedPnl)} selon une méthode FIFO sur ${int(data.summary.roundTripCount)} instruments vendus.`, tone: data.summary.realizedPnl >= 0 ? 'positive' : 'warning' },
    ];
  }

  function csvConcentrationFindings() {
    const top = data.trading.assets.filter((asset) => asset.openCostBasis > 0)[0];
    return [
      { title: 'Coût ouvert', body: `${eur(data.summary.openCostBasis)} de coût restant reconstruit depuis BUY/SELL, frais et taxes inclus.` },
      { title: 'Top 5', body: `${formatNumber.format(data.summary.topFiveWeight)} % du coût ouvert est concentré sur les 5 premières lignes.` },
      { title: 'Première ligne', body: top ? `${top.name}: ${eur(top.openCostBasis)} (${formatNumber.format(top.openCostWeight)} % du coût ouvert).` : 'Aucune position ouverte au coût.' },
    ];
  }

  function csvUnavailableFindings() {
    return data.audit.unavailable.map((item) => ({ title: item.label, body: item.reason, tone: 'warning' }));
  }

  function csvActivityFindings() {
    return [
      { title: 'Mois actifs', body: `${int(data.summary.activeTradingMonths)} mois avec au moins un achat ou une vente.` },
      { title: 'Évènements non cash', body: `${int(data.summary.deliveryEventCount)} livraisons et ${int(data.summary.corporateActionCount)} corporate actions parsées pour les quantités.` },
      { title: 'FX présent', body: `${int(data.summary.fxRowCount)} lignes contiennent original_amount / original_currency / fx_rate.` },
    ];
  }

  function csvPerformanceFindings() {
    const realized = data.trading.assets.filter((asset) => asset.realizedCostBasis > 0).sort((a, b) => b.realizedPnl - a.realizedPnl);
    const best = realized[0];
    const worst = realized.at(-1);
    return [
      { title: 'Méthode', body: 'P/L réalisé = produit net des ventes moins coût FIFO des lots vendus, frais et taxes inclus quand fournis.' },
      { title: 'Meilleur réalisé', body: best ? `${best.name}: ${eur(best.realizedPnl)} (${formatNumber.format(best.realizedReturnPct)} %).` : 'Aucune vente matchée.' },
      { title: 'Pire réalisé', body: worst ? `${worst.name}: ${eur(worst.realizedPnl)} (${formatNumber.format(worst.realizedReturnPct)} %).` : 'Aucune vente matchée.' },
    ];
  }

  function csvFeeFindings() {
    const fees = [...data.trading.assets].sort((a, b) => (b.tradingFees + b.tradingTaxes) - (a.tradingFees + a.tradingTaxes))[0];
    return [
      { title: 'Total explicite', body: `${eur(data.summary.tradingFees)} de frais et ${eur(data.summary.tradingTaxes)} de taxes sur BUY/SELL.` },
      { title: 'Instrument le plus coûteux', body: fees ? `${fees.name}: ${eur(fees.tradingFees + fees.tradingTaxes)} de frais/taxes.` : 'Aucun frais explicite.' },
      { title: 'Lecture prudente', body: 'Les frais implicites de spread ne sont pas dans le CSV; ils ne sont donc pas inventés.' },
    ];
  }

  function csvCoverageFindings() {
    const full = data.trading.fieldCoverage.length === data.summary.csvColumnCount;
    const sparse = data.trading.fieldCoverage.filter((field) => field.nonEmpty === 0).map((field) => field.field);
    return [
      { title: full ? '23/23 colonnes reconnues' : 'Colonnes partielles', body: `${int(data.trading.fieldCoverage.length)} colonnes auditées. Champs vides partout: ${sparse.length ? sparse.join(', ') : 'aucun'}.`, tone: full ? 'positive' : 'warning' },
      { title: 'Colonnes numériques', body: 'shares, price, amount, fee, tax, original_amount et fx_rate sont typés en nombres quand présents.' },
      { title: 'Colonnes d’identité', body: 'transaction_id sert à la couverture/déduplication; counterparty_* est parsé mais non affiché brut.' },
    ];
  }

  function csvPrivacyFindings() {
    return [
      { title: 'On-device', body: 'CSV lu dans le navigateur: aucun upload serveur, aucune API externe.' },
      { title: 'Champs sensibles', body: `${int(data.cash.counterpartyRows)} lignes contiennent contrepartie/IBAN: elles sont comptées, pas exposées dans les tableaux trading.` },
      { title: 'Transactions affichées', body: 'Le journal CSV affiché est centré sur les ordres BUY/SELL et exclut les champs IBAN/contrepartie bruts.' },
    ];
  }

  function directFindings() {
    return [
      { title: 'Période', body: data.summary.periodLabel || 'Période non trouvée dans le PDF.' },
      { title: 'Totaux du PDF', body: `Solde initial ${eur(data.summary.openingBalance)}, entrées ${eur(data.summary.expectedInflows)}, sorties ${eur(data.summary.expectedOutflows)}, solde final ${eur(data.summary.expectedFinalBalance)}.` },
      { title: 'Texte extrait', body: `${int(data.coverage.extractedLineCount)} fragments texte lus sur ${int(data.coverage.pageCount)} pages.` },
    ];
  }

  function calculatedFindings(metrics) {
    return [
      { title: 'Montants transactionnels', body: `${data.summary.transactionCount} flux calculés par différence entre deux soldes consécutifs.` },
      { title: 'Rapprochement', body: `Écarts: entrées ${eur(data.diagnostics.inflowDiff)}, sorties ${eur(data.diagnostics.outflowDiff)}, solde ${eur(data.diagnostics.finalBalanceDiff)}.`, tone: data.coverage.reconciled ? 'positive' : 'warning' },
      { title: 'Coût net ISIN', body: `${eur(metrics.netInvested)} = achats portefeuille ${eur(data.summary.totalBuys)} - ventes portefeuille ${eur(data.summary.totalSells)}.` },
    ];
  }

  function instrumentFindings(metrics) {
    return [
      { title: 'Identifiants trouvés', body: `${data.coverage.assetCount} ISIN distincts et ${data.coverage.transactionsWithIsin} transactions rattachées à un ISIN.` },
      { title: 'Quantités disponibles', body: `${data.coverage.transactionsWithQuantity} transactions contiennent une quantité explicite dans le libellé.` },
      { title: 'Plus gros coût net', body: metrics.topAsset ? `${metrics.topAsset.name}: ${eur(metrics.topAsset.netInvested)} (${formatNumber.format(metrics.topAsset.weight)} % du coût net positif).` : 'Aucun ISIN avec coût net positif.' },
    ];
  }

  function unavailableFindings() {
    return data.audit.unavailable.map((item) => ({ title: item.label, body: item.reason, tone: 'warning' }));
  }

  function flowFindings(metrics) {
    return [
      { title: 'Mois avec le plus d’achats', body: metrics.peakBuy ? `${metrics.peakBuy.month}: ${eur(metrics.peakBuy.buys)} d’achats portefeuille.` : 'Aucun achat portefeuille détecté.' },
      { title: 'Apports et retraits', body: `Apports ${eur(data.summary.totalDeposits)}, retraits ${eur(data.summary.totalWithdrawals)}.` },
      { title: 'Carte', body: `Dépenses carte ${eur(data.summary.cardSpend)}, remboursements carte ${eur(data.summary.cardRefunds)}.` },
    ];
  }

  function incomeFindings(metrics) {
    return [
      { title: 'Dividendes', body: `${eur(data.summary.dividends)} sur ${metrics.dividendRows} lignes classées dividendes.` },
      { title: 'Intérêts', body: `${eur(data.summary.interest)} sur ${metrics.interestRows} lignes classées intérêts.` },
      { title: 'Bonus', body: `${eur(data.summary.bonus)} sur ${metrics.bonusRows} lignes classées bonus/saveback.` },
    ];
  }

  function feeFindings(metrics) {
    return [
      { title: 'Frais comptabilisés', body: `${eur(data.summary.accountFees)} sur ${metrics.feeRows} lignes classées frais.` },
      { title: 'Frais déclarés dans libellés', body: `${eur(data.summary.declaredFees)} extraits des mentions “fee:” présentes dans certains libellés.` },
      { title: 'Taxes', body: `${eur(data.summary.taxes)} sur ${metrics.taxRows} lignes classées impôts/taxes.` },
    ];
  }

  function coverageFindings() {
    return [
      { title: 'Transactions', body: `${int(data.summary.transactionCount)} transactions reconstruites depuis les lignes du PDF.` },
      { title: 'ISIN', body: `${int(data.coverage.transactionsWithIsin)} transactions contiennent un ISIN; ${int(data.coverage.assetCount)} ISIN distincts.` },
      { title: 'Quantités', body: `${int(data.coverage.transactionsWithQuantity)} transactions contiennent une quantité explicite.` },
      { title: 'Non classé', body: `${int(data.coverage.unknownTransactionCount)} transactions restent dans “Autres entrées/sorties”.`, tone: data.coverage.unknownTransactionCount ? 'warning' : 'positive' },
    ];
  }

  function auditTablePanel(title, items) {
    const body = items.map((item) => `
      <tr>
        <td>${esc(item.label)}</td>
        <td>${formatAuditValue(item)}</td>
        <td>${esc(item.source)}</td>
      </tr>`).join('');
    return `<article class="data-panel"><div class="panel-head"><h2>${esc(title)}</h2><p>Champs lus sans calcul métier.</p></div>${table(['Champ', 'Valeur', 'Source'], body)}</article>`;
  }

  function auditFormulaPanel(title, items) {
    const body = items.map((item) => `
      <tr>
        <td>${esc(item.label)}</td>
        <td>${esc(item.formula)}</td>
        <td class="num">${item.count === null ? '—' : int(item.count)}</td>
      </tr>`).join('');
    return `<article class="data-panel"><div class="panel-head"><h2>${esc(title)}</h2><p>Formules transparentes appliquées aux données extraites.</p></div>${table(['Calcul', 'Formule', 'Nombre'], body)}</article>`;
  }

  function reconciliationTable() {
    const rows = [
      ['Entrées', data.summary.expectedInflows, data.summary.totalInflows, data.diagnostics.inflowDiff],
      ['Sorties', data.summary.expectedOutflows, data.summary.totalOutflows, data.diagnostics.outflowDiff],
      ['Solde final', data.summary.expectedFinalBalance, data.summary.finalBalance, data.diagnostics.finalBalanceDiff],
    ].map(([label, pdf, calc, diff]) => `
      <tr>
        <td>${esc(label)}</td>
        <td class="num">${eur(pdf)}</td>
        <td class="num">${eur(calc)}</td>
        <td class="num ${Math.abs(diff || 0) <= 0.01 ? 'pos' : 'neg'}">${eur(diff)}</td>
      </tr>`).join('');
    return table(['Contrôle', 'PDF', 'Calcul', 'Écart'], rows);
  }

  function assetTable() {
    const rows = data.assets.map((asset) => `
      <tr>
        <td><strong>${esc(asset.name)}</strong><span>${esc(asset.isin)}</span></td>
        <td class="num">${eur(asset.buyAmount)}</td>
        <td class="num">${eur(asset.sellAmount)}</td>
        <td class="num">${eur(asset.dividendAmount)}</td>
        <td class="num">${eur(asset.netInvested)}</td>
        <td class="num">${formatNumber.format(asset.weight)} %</td>
        <td class="num">${asset.quantityRows ? formatQuantity(asset.quantityDelta) : '—'}</td>
        <td class="num">${int(asset.transactionCount)}</td>
      </tr>`).join('');
    return table(['Actif', 'Achats', 'Ventes', 'Dividendes', 'Coût net', 'Poids', 'Qté calculée', 'Lignes'], rows);
  }

  function csvAssetTable() {
    const rows = data.trading.assets.map((asset) => `
      <tr>
        <td><strong>${esc(asset.name)}</strong><span>${esc(asset.symbol)} · ${esc(asset.assetClass)}</span></td>
        <td class="num">${formatQuantity(asset.netQuantity)}</td>
        <td class="num">${eur(asset.openCostBasis)}</td>
        <td class="num">${formatNumber.format(asset.openCostWeight)} %</td>
        <td class="num">${asset.avgBuyPrice === null ? '—' : eur(asset.avgBuyPrice)}</td>
        <td class="num">${eur(asset.buyCash)}</td>
        <td class="num">${eur(asset.sellCash)}</td>
        <td class="num ${asset.realizedPnl >= 0 ? 'pos' : 'neg'}">${eur(asset.realizedPnl)}</td>
        <td class="num">${eur(asset.tradingFees + asset.tradingTaxes)}</td>
        <td class="num">${int(asset.tradeCount)}</td>
      </tr>`).join('');
    return table(['Instrument', 'Qté nette', 'Coût ouvert', 'Poids', 'Prix moyen buy', 'Cash buy', 'Cash sell', 'P/L FIFO', 'Frais+taxes', 'Ordres'], rows);
  }

  function csvMonthlyTable() {
    const rows = data.trading.monthly.map((month) => `
      <tr>
        <td>${esc(month.month)}</td>
        <td class="num">${eur(month.buyAmount)}</td>
        <td class="num">${eur(month.sellAmount)}</td>
        <td class="num">${eur(month.tradingFees + month.tradingTaxes)}</td>
        <td class="num">${int(month.buyCount)}</td>
        <td class="num">${int(month.sellCount)}</td>
        <td class="num">${eur(month.dividendIncome)}</td>
        <td class="num">${eur(month.cashContribution)}</td>
        <td class="num">${int(month.investmentEventCount)}</td>
      </tr>`).join('');
    return table(['Mois', 'Achats', 'Ventes', 'Frais+taxes', 'BUY', 'SELL', 'Revenus', 'Apports cash', 'Events'], rows);
  }

  function csvFieldCoverageTable() {
    const rows = data.trading.fieldCoverage.map((field) => `
      <tr>
        <td><strong>${esc(field.field)}</strong><span>${esc(field.usedFor)}</span></td>
        <td class="num">${int(field.nonEmpty)}</td>
        <td class="num">${int(field.empty)}</td>
        <td class="num">${formatNumber.format(field.coveragePct)} %</td>
      </tr>`).join('');
    return table(['Colonne', 'Non vide', 'Vide', 'Couverture'], rows);
  }

  function monthlyTable() {
    const rows = data.monthly.map((month) => `
      <tr>
        <td>${esc(month.month)}</td>
        <td class="num">${eur(month.deposits)}</td>
        <td class="num">${eur(month.buys)}</td>
        <td class="num">${eur(month.sells)}</td>
        <td class="num">${eur(month.cardSpend)}</td>
        <td class="num">${eur(month.dividends + month.interest + month.bonus)}</td>
        <td class="num">${eur(month.endBalance)}</td>
      </tr>`).join('');
    return table(['Mois', 'Apports', 'Achats', 'Ventes', 'Carte', 'Revenus', 'Cash fin'], rows);
  }

  function transactionTable(rows) {
    if (isCsvReport()) return csvTradingTable(rows);
    const body = rows.map((tx) => `
      <tr>
        <td>${esc(tx.date)}</td>
        <td><span class="tag">${esc(tx.category)}</span></td>
        <td>${esc(tx.description)}</td>
        <td class="num ${tx.signedAmount >= 0 ? 'pos' : 'neg'}">${eur(tx.signedAmount)}</td>
        <td class="num">${eur(tx.balance)}</td>
      </tr>`).join('');
    return table(['Date', 'Catégorie', 'Libellé', 'Flux', 'Solde'], body);
  }

  function csvTradingTable(rows) {
    const body = rows.map((tx) => `
      <tr>
        <td>${esc(tx.date)}</td>
        <td><span class="tag">${esc(tx.type)}</span></td>
        <td><strong>${esc(tx.name)}</strong><span>${esc(tx.symbol)} · ${esc(tx.assetClass)}</span></td>
        <td class="num">${formatQuantity(tx.shares)}</td>
        <td class="num">${tx.price === null ? '—' : eur(tx.price)}</td>
        <td class="num ${tx.amount >= 0 ? 'pos' : 'neg'}">${eur(tx.amount)}</td>
        <td class="num">${tx.fee === null ? '—' : eur(tx.fee)}</td>
        <td class="num">${tx.tax === null ? '—' : eur(tx.tax)}</td>
        <td class="num">${eur(tx.cashImpact)}</td>
      </tr>`).join('');
    return table(['Date', 'Type', 'Instrument', 'Shares', 'Price', 'Amount', 'Fee', 'Tax', 'Cash impact'], body);
  }

  function table(headers, body) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderCharts() {
    if (isCsvReport()) {
      renderCsvCharts();
      return;
    }
    const metrics = derivedMetrics();
    mount('monthly-flow', flowChart());
    mount('cash-line', ChartKit.lineChart(data.monthly, { key: 'endBalance', color: '#19d0e8', label: (m) => shortMonth(m.month) }));
    mount('category-donut', categoryDonut(metrics));
    mountLegend('legend-category', metrics.operationBreakdown);
    mount('top-assets', ChartKit.horizontalBars(topAssetItems(metrics).slice(0, 12), { format: eur }));
    mount('top-assets-wide', ChartKit.horizontalBars(topAssetItems(metrics).slice(0, 18), { format: eur }));
    mount('concentration-bars', ChartKit.horizontalBars(concentrationItems().slice(0, 15), { format: (v) => `${formatNumber.format(v)} %` }));
    mount('buy-heatmap', ChartKit.heatmap(data.monthly));
    mount('deployment-bars', deploymentChart());
    mount('monthly-cash-bars', ChartKit.barChart(data.monthly, { series: [{ key: 'endBalance', color: '#19d0e8' }], label: (m) => shortMonth(m.month) }));
    mount('income-bars', incomeChart());
    mount('merchant-bars', ChartKit.horizontalBars(data.merchants.map((m) => ({ label: m.merchant, value: m.amount })), { format: eur }));
  }

  function renderCsvCharts() {
    mount('csv-monthly-trades', csvMonthlyTradeChart());
    mount('csv-monthly-trades-wide', csvMonthlyTradeChart());
    mount('csv-asset-class-donut', csvAssetClassDonut());
    mountLegend('legend-csv-asset-class', data.trading.assetClasses.map((item) => ({ label: item.assetClass, weight: item.weight })));
    mount('csv-top-open-cost', ChartKit.horizontalBars(csvTopOpenCostItems().slice(0, 12), { format: eur }));
    mount('csv-top-open-cost-wide', ChartKit.horizontalBars(csvTopOpenCostItems().slice(0, 18), { format: eur }));
    mount('csv-fee-drag', ChartKit.horizontalBars(csvFeeItems().slice(0, 12), { format: eur }));
    mount('csv-asset-class-bars', ChartKit.horizontalBars(data.trading.assetClasses.map((item) => ({ label: item.assetClass, value: item.openCostBasis })), { format: eur }));
    mount('csv-type-bars', ChartKit.horizontalBars(data.trading.types.slice(0, 14).map((item) => ({ label: item.label, value: item.count })), { format: int }));
    mount('csv-cash-context', ChartKit.horizontalBars(csvCashItems(), { format: eur }));
    mount('csv-realized-winners', ChartKit.horizontalBars(csvRealizedWinnerItems().slice(0, 10), { format: eur }));
    mount('csv-income-assets', ChartKit.horizontalBars(csvIncomeAssetItems().slice(0, 10), { format: eur }));
  }

  function csvMonthlyTradeChart() {
    return ChartKit.barChart(data.trading.monthly, {
      series: [
        { key: 'buyAmount', color: '#19d0e8' },
        { key: 'sellAmount', color: '#44ccff' },
        { key: 'tradingFees', color: '#ffffff' },
      ],
      label: (m) => shortMonth(m.month),
    });
  }

  function csvAssetClassDonut() {
    return ChartKit.donutChart(data.trading.assetClasses.map((item) => ({ value: item.openCostBasis })), {
      centerTop: eur(data.summary.openCostBasis),
      centerBottom: 'coût ouvert',
    });
  }

  function csvTopOpenCostItems() {
    return data.trading.assets.filter((asset) => asset.openCostBasis > 0).map((asset) => ({ label: asset.name, value: asset.openCostBasis }));
  }

  function csvFeeItems() {
    return data.trading.assets
      .map((asset) => ({ label: asset.name, value: asset.tradingFees + asset.tradingTaxes }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  function csvRealizedWinnerItems() {
    return data.trading.assets
      .filter((asset) => asset.realizedPnl > 0)
      .map((asset) => ({ label: asset.name, value: asset.realizedPnl }))
      .sort((a, b) => b.value - a.value);
  }

  function csvIncomeAssetItems() {
    return data.trading.assets
      .filter((asset) => asset.income > 0)
      .map((asset) => ({ label: asset.name, value: asset.income }))
      .sort((a, b) => b.value - a.value);
  }

  function csvCashItems() {
    return [
      { label: 'Apports', value: data.cash.deposits },
      { label: 'Carte', value: data.cash.cardSpend },
      { label: 'Dividendes', value: data.cash.dividends },
      { label: 'Intérêts', value: data.cash.interest },
      { label: 'Bonus/perks', value: data.cash.bonus },
    ].filter((item) => item.value > 0);
  }

  function flowChart() {
    return ChartKit.barChart(data.monthly, {
      series: [
        { key: 'deposits', color: '#19d0e8' },
        { key: 'buys', color: '#44ccff' },
        { key: 'cardSpend', color: '#ffffff' },
      ],
      label: (m) => shortMonth(m.month),
    });
  }

  function incomeChart() {
    return ChartKit.barChart(data.monthly, {
      series: [
        { key: 'dividends', color: '#19d0e8' },
        { key: 'interest', color: '#ffffff' },
        { key: 'bonus', color: '#44ccff' },
      ],
      label: (m) => shortMonth(m.month),
    });
  }

  function deploymentChart() {
    return ChartKit.horizontalBars([
      { label: 'Apports', value: data.summary.totalDeposits },
      { label: 'Achats portefeuille', value: data.summary.totalBuys },
      { label: 'Dépenses carte', value: data.summary.cardSpend },
      { label: 'Ventes portefeuille', value: data.summary.totalSells },
      { label: 'Revenus + bonus', value: data.summary.passiveIncome + data.summary.bonus },
    ], { format: eur });
  }

  function categoryDonut(metrics) {
    return ChartKit.donutChart(metrics.operationBreakdown.map((item) => ({ value: item.value })), {
      centerTop: eur(metrics.totalOperationAmount),
      centerBottom: 'flux classés',
    });
  }

  function topAssetItems(metrics) {
    return metrics.positiveAssets.map((asset) => ({ label: asset.name, value: asset.netInvested }));
  }

  function mount(id, chart) {
    const target = document.getElementById(id);
    if (!target || !chart) return;
    target.replaceChildren(chart);
  }

  function mountLegend(id, items) {
    const target = document.getElementById(id);
    if (!target) return;
    target.innerHTML = items.map((item, index) => `<span><i style="background:${ChartKit.COLORS[index % ChartKit.COLORS.length]}"></i>${esc(item.label)} · ${formatNumber.format(item.weight)} %</span>`).join('');
  }

  function bindUploadControls() {
    document.querySelectorAll('[data-file-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) void processInputFile(file);
      });
    });

    document.querySelectorAll('[data-pdf-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) void processInputFile(file);
      });
    });

    document.querySelectorAll('[data-drop-zone]').forEach((zone) => {
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('is-dragging');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('is-dragging');
        const file = [...(event.dataTransfer?.files || [])].find((candidate) => supportedInputFile(candidate));
        if (file) void processInputFile(file);
      });
    });
  }

  async function processInputFile(file) {
    if (isCsvFile(file)) {
      await processCsvFile(file);
      return;
    }
    if (isPdfFile(file)) {
      await processPdfFile(file);
      return;
    }
    uploadState.status = 'error';
    uploadState.message = 'Format non supporté: importe un PDF de relevé ou un CSV Transaction export Trade Republic.';
    render();
  }

  async function processCsvFile(file) {
    uploadState.status = 'processing';
    uploadState.fileName = file.name;
    uploadState.fileSize = file.size;
    uploadState.message = `Lecture du CSV ${file.name} (${formatBytes(file.size)}).`;
    data = null;
    render();

    try {
      const text = await file.text();
      const analysis = buildTradeCsvAnalysis(text, { fileName: file.name });
      validateCsvAnalysis(analysis);
      data = analysis;
      state.tab = 'overview';
      state.category = 'all';
      state.search = '';
      uploadState.status = 'done';
      uploadState.message = `${analysis.summary.tradingRows} ordres trading et ${analysis.summary.transactionCount} lignes CSV parsés depuis ${file.name}.`;
      render();
    } catch (error) {
      uploadState.status = 'error';
      uploadState.message = error instanceof Error ? error.message : String(error);
      data = null;
      render();
    }
  }

  async function processPdfFile(file) {
    uploadState.status = 'processing';
    uploadState.fileName = file.name;
    uploadState.fileSize = file.size;
    uploadState.message = `Lecture de ${file.name} (${formatBytes(file.size)}).`;
    data = null;
    render();

    try {
      const pdfData = new Uint8Array(await file.arrayBuffer());
      const lines = await extractLinesFromPdfData(pdfData, pdfjs, {
        disableWorker: false,
        onProgress: (page, total) => {
          uploadState.message = `Extraction du texte PDF: page ${page}/${total}.`;
          updateUploadStatus();
        },
      });
      const meta = extractStatementMeta(lines);
      if (meta.openingBalance === null) throw new Error('Solde initial introuvable dans le bloc Compte courant du PDF.');
      const transactions = extractTransactionsFromLines(lines, { openingBalance: meta.openingBalance });
      const analysis = buildAnalysis(transactions, meta);

      validateAnalysis(analysis);
      data = analysis;
      state.tab = 'overview';
      state.category = 'all';
      state.search = '';
      uploadState.status = 'done';
      uploadState.message = `${transactions.length} transactions reconstruites depuis ${file.name}.`;
      render();
    } catch (error) {
      uploadState.status = 'error';
      uploadState.message = error instanceof Error ? error.message : String(error);
      data = null;
      render();
    }
  }

  function updateUploadStatus() {
    const status = document.querySelector('.upload-status span');
    if (status) status.textContent = uploadState.message;
  }

  function validateAnalysis(analysis) {
    const diagnostics = analysis.diagnostics;
    const diffs = [diagnostics.inflowDiff, diagnostics.outflowDiff, diagnostics.finalBalanceDiff].filter((value) => value !== null);
    const drift = diffs.some((value) => Math.abs(value) > 0.01);
    if (analysis.summary.transactionCount === 0) throw new Error('Aucune transaction reconnue dans ce PDF.');
    if (drift) {
      throw new Error(`Rapprochement impossible: écart entrées ${eur(diagnostics.inflowDiff)}, sorties ${eur(diagnostics.outflowDiff)}, solde ${eur(diagnostics.finalBalanceDiff)}.`);
    }
  }

  function validateCsvAnalysis(analysis) {
    if (analysis.sourceType !== 'csv') throw new Error('Analyse CSV invalide.');
    if (analysis.meta.columnCount < analysis.summary.csvColumnCount) throw new Error('CSV incomplet: toutes les colonnes attendues ne sont pas présentes.');
    if (analysis.summary.transactionCount === 0) throw new Error('Aucune ligne reconnue dans ce CSV.');
    if (analysis.summary.tradingRows === 0) throw new Error('Aucun ordre BUY/SELL trouvé dans ce CSV.');
  }

  function bindTabs() {
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.tab = button.dataset.tab;
        render();
      });
    });
  }

  function bindTransactionControls() {
    const category = document.getElementById('category-filter');
    const search = document.getElementById('search-filter');
    if (category) category.addEventListener('change', () => { state.category = category.value; updateTransactionTable(); });
    if (search) search.addEventListener('input', () => { state.search = search.value; updateTransactionTable(); });
  }

  function updateTransactionTable() {
    const rows = filteredTransactions();
    const count = document.getElementById('transaction-count');
    const slot = document.getElementById('transaction-table-slot');
    if (count) count.textContent = `${rows.length} ${isCsvReport() ? 'ordres' : 'transactions'} filtrés, affichage limité aux 300 plus récents.`;
    if (slot) slot.innerHTML = transactionTable(rows.slice(0, 300));
  }

  function filteredTransactions() {
    const query = state.search.trim().toLowerCase();
    const source = isCsvReport() ? data.trading.transactions : data.transactions;
    return [...source].reverse().filter((tx) => {
      const categoryOk = state.category === 'all' || (isCsvReport() ? tx.type === state.category : tx.category === state.category);
      const haystack = isCsvReport()
        ? `${tx.type} ${tx.name} ${tx.symbol} ${tx.assetClass} ${tx.description}`
        : `${tx.description} ${tx.category} ${tx.asset?.name || ''} ${tx.asset?.isin || ''}`;
      const queryOk = !query || haystack.toLowerCase().includes(query);
      return categoryOk && queryOk;
    });
  }

  function derivedMetrics() {
    const netInvested = data.summary.netInvested;
    const positiveAssets = data.assets.filter((asset) => asset.netInvested > 0);
    const operationBreakdown = operationItems();
    return {
      netInvested,
      positiveAssets,
      operationBreakdown,
      totalOperationAmount: operationBreakdown.reduce((total, item) => total + item.value, 0),
      topAsset: positiveAssets[0] || null,
      topFiveWeight: positiveAssets.slice(0, 5).reduce((total, asset) => total + asset.weight, 0),
      activeMonths: data.monthly.filter((month) => month.buys > 0).length,
      avgMonthlyBuy: data.summary.totalBuys / Math.max(data.monthly.length, 1),
      peakBuy: [...data.monthly].sort((a, b) => b.buys - a.buys)[0],
      dividendRows: countKind('dividend'),
      interestRows: countKind('interest'),
      bonusRows: countKind('bonus'),
      feeRows: countKind('fee'),
      taxRows: countKind('tax'),
    };
  }

  function operationItems() {
    const items = [
      { label: 'Achats portefeuille', value: data.summary.totalBuys },
      { label: 'Ventes portefeuille', value: data.summary.totalSells },
      { label: 'Apports', value: data.summary.totalDeposits },
      { label: 'Retraits', value: data.summary.totalWithdrawals },
      { label: 'Dépenses carte', value: data.summary.cardSpend },
      { label: 'Revenus + bonus', value: data.summary.passiveIncome + data.summary.bonus },
      { label: 'Frais + taxes', value: data.summary.accountFees + data.summary.taxes },
    ].filter((item) => item.value > 0);
    const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
    return items.map((item) => ({ ...item, weight: (item.value / total) * 100 }));
  }

  function countKind(kind) {
    return data.transactions.filter((transaction) => transaction.kind === kind).length;
  }

  function concentrationItems() {
    let cumulative = 0;
    return data.assets.filter((asset) => asset.netInvested > 0).map((asset) => {
      cumulative += asset.weight;
      return { label: asset.name, value: cumulative };
    });
  }

  function pct(value, base) {
    return `${formatNumber.format(base ? (value / base) * 100 : 0)} %`;
  }

  function eur(value) {
    return Number.isFinite(value) ? formatEuro.format(value) : 'Non trouvé';
  }

  function int(value) {
    return Number.isFinite(value) ? new Intl.NumberFormat('fr-FR').format(value) : 'n/a';
  }

  function formatQuantity(value) {
    return Number.isFinite(value) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 }).format(value) : '—';
  }

  function formatAuditValue(item) {
    if (typeof item.value === 'string') return esc(item.value);
    if (isCsvReport() && ['rows', 'tradingRows'].includes(item.key)) return int(item.value);
    if (item.key === 'pages') return int(item.value);
    return esc(eur(item.value));
  }

  function shortMonth(month) {
    return month.slice(2).replace('-', '/');
  }

  function formatBytes(bytes) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + ' Mo';
  }

  function isCsvReport() {
    return data?.sourceType === 'csv';
  }

  function supportedInputFile(file) {
    return isPdfFile(file) || isCsvFile(file);
  }

  function isPdfFile(file) {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  }

  function isCsvFile(file) {
    return file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  render();
}

portfolioDashboard();
