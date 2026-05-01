import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import { extractLinesFromPdfData } from './scripts/pdfjs-extractor.mjs';
import {
  buildAnalysis,
  extractStatementMeta,
  extractTransactionsFromLines,
} from './scripts/statement-parser.mjs';

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
          <p>Un parseur local lit le PDF dans ton navigateur, reconstruit les flux, rapproche les soldes, puis affiche uniquement les données trouvées ou calculées.</p>
          <div class="upload-status ${uploadState.status}">
            <strong>${esc(statusTitle())}</strong>
            <span>${esc(uploadState.message)}</span>
            ${busy ? '<progress max="100"></progress>' : ''}
          </div>
        </div>
        <label class="drop-zone terminal-window" for="pdf-file" data-drop-zone>
          <div class="terminal-toolbar"><i></i><i></i><i></i><span>local-parser</span></div>
          <input id="pdf-file" data-pdf-input type="file" accept="application/pdf,.pdf" ${busy ? 'disabled' : ''} />
          <span class="terminal-prompt">run statement.pdf</span>
          <strong>Choisir ou déposer le PDF</strong>
          <small>Tout reste dans ton navigateur. Aucune API, aucun upload serveur.</small>
        </label>
      </section>
      <section class="panel-grid three upload-notes">
        ${uploadNote('Static build', 'Compatible GitHub Pages: HTML, CSS, JS, PDF.js vendored.')}
        ${uploadNote('Même format', 'Optimisé pour les relevés Trade Republic avec la même syntaxe PDF.')}
        ${uploadNote('Audit local', 'Entrées, sorties et solde final sont rapprochés automatiquement.')}
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

  function renderTabs() {
    const tabs = [
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
    if (state.tab === 'instruments') return renderInstruments();
    if (state.tab === 'flows') return renderFlows();
    if (state.tab === 'income') return renderIncome();
    if (state.tab === 'controls') return renderControls();
    if (state.tab === 'transactions') return renderTransactions();
    return renderOverview();
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
    const categories = ['all', ...data.categories.map((item) => item.category)];
    const rows = filteredTransactions();
    return `
      <section class="data-panel">
        <div class="panel-head with-controls">
          <div><h2>Journal reconstruit</h2><p id="transaction-count">${rows.length} transactions filtrées, affichage limité aux 300 plus récentes.</p></div>
          <div class="controls">
            <select id="category-filter">${categories.map((cat) => `<option value="${esc(cat)}" ${state.category === cat ? 'selected' : ''}>${cat === 'all' ? 'Toutes catégories' : esc(cat)}</option>`).join('')}</select>
            <input id="search-filter" type="search" value="${esc(state.search)}" placeholder="Chercher un actif, marchand, type..." />
          </div>
        </div>
        <div id="transaction-table-slot">${transactionTable(rows.slice(0, 300))}</div>
      </section>`;
  }

  function renderKpis(metrics) {
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

  function kpi(label, value, note, type = 'currency') {
    const formatted = type === 'integer' ? int(value) : eur(value);
    return `<article class="kpi"><span>${esc(label)}</span><strong>${esc(formatted)}</strong><small>${esc(note)}</small></article>`;
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

  function table(headers, body) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderCharts() {
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
    document.querySelectorAll('[data-pdf-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) void processPdfFile(file);
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
        const file = [...(event.dataTransfer?.files || [])].find((candidate) => candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf'));
        if (file) void processPdfFile(file);
      });
    });
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
    if (count) count.textContent = `${rows.length} transactions filtrées, affichage limité aux 300 plus récentes.`;
    if (slot) slot.innerHTML = transactionTable(rows.slice(0, 300));
  }

  function filteredTransactions() {
    const query = state.search.trim().toLowerCase();
    return [...data.transactions].reverse().filter((tx) => {
      const categoryOk = state.category === 'all' || tx.category === state.category;
      const queryOk = !query || `${tx.description} ${tx.category} ${tx.asset?.name || ''} ${tx.asset?.isin || ''}`.toLowerCase().includes(query);
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
    if (item.key === 'pages') return int(item.value);
    return esc(eur(item.value));
  }

  function shortMonth(month) {
    return month.slice(2).replace('-', '/');
  }

  function formatBytes(bytes) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + ' Mo';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  render();
}

portfolioDashboard();
