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
          <div class="meta-line">Analyse locale · PDF jamais envoyé · GitHub Pages ready</div>
          <h1>Importe ton relevé, le navigateur calcule tout</h1>
          <p>Le site extrait le texte du PDF côté client, reconstruit les transactions Trade Republic, rapproche les totaux, puis génère les graphiques et l’analyse.</p>
          <div class="upload-status ${uploadState.status}">
            <strong>${esc(statusTitle())}</strong>
            <span>${esc(uploadState.message)}</span>
            ${busy ? '<progress max="100"></progress>' : ''}
          </div>
        </div>
        <label class="drop-zone" for="pdf-file" data-drop-zone>
          <input id="pdf-file" data-pdf-input type="file" accept="application/pdf,.pdf" ${busy ? 'disabled' : ''} />
          <span>PDF Trade Republic</span>
          <strong>Choisir ou déposer le relevé</strong>
          <small>Tout reste dans ton navigateur. Aucune API, aucun upload serveur.</small>
        </label>
      </section>
      <section class="panel-grid three upload-notes">
        ${uploadNote('100 % statique', 'Compatible GitHub Pages: HTML, CSS, JS, PDF.js vendored.')}
        ${uploadNote('Même syntaxe PDF', 'Optimisé pour les relevés Trade Republic du même format.')}
        ${uploadNote('Audit intégré', 'Les entrées, sorties et solde final sont rapprochés automatiquement.')}
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
          <div class="meta-line">Trade Republic · ${esc(data.summary.periodLabel)} · ${data.summary.transactionCount} transactions</div>
          <h1>Analyse profonde du portefeuille</h1>
          <p>Lecture cash-flow, coût net investi, concentration, rythme d’achat, revenus, friction carte et limites de valorisation.</p>
        </div>
        <div class="header-actions">
          <div class="audit-pill ${ok ? 'is-ok' : 'is-warning'}">
            <span>Rapprochement relevé</span>
            <strong>${ok ? '0,00 € d’écart' : 'écart détecté'}</strong>
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
      ['allocation', 'Allocation'],
      ['flows', 'Flux'],
      ['income', 'Revenus & frais'],
      ['transactions', 'Transactions'],
    ];
    return `<nav class="tabs">${tabs.map(([id, label]) => `<button class="${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>`;
  }

  function renderActiveTab() {
    if (state.tab === 'allocation') return renderAllocation();
    if (state.tab === 'flows') return renderFlows();
    if (state.tab === 'income') return renderIncome();
    if (state.tab === 'transactions') return renderTransactions();
    return renderOverview();
  }

  function renderOverview() {
    const metrics = derivedMetrics();
    return `
      <section class="kpi-grid">${renderKpis(metrics)}</section>
      <section class="panel-grid two">
        ${analysisPanel('Lecture exécutive', executiveFindings(metrics))}
        ${analysisPanel('Points de contrôle expert', controlFindings(metrics))}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Flux mensuels', 'Apports, achats et dépenses carte mois par mois.', 'monthly-flow')}
        ${chartPanel('Solde cash', 'Solde de fin de mois reconstruit depuis chaque transaction.', 'cash-line')}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Coût net par classe', 'Allocation estimée au coût net, pas à la valeur de marché.', 'class-donut', 'legend-class')}
        ${chartPanel('Top lignes au coût', 'Les 12 premières lignes expliquent l’essentiel du risque de concentration.', 'top-assets')}
      </section>`;
  }

  function renderAllocation() {
    const metrics = derivedMetrics();
    return `
      <section class="panel-grid two">
        ${analysisPanel('Diagnostic allocation', allocationFindings(metrics))}
        ${analysisPanel('Ce que le relevé ne peut pas prouver', limitationFindings())}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Exposition par thème', 'Regroupement par thème inféré depuis les noms d’instruments.', 'theme-bars')}
        ${chartPanel('Concentration cumulée', 'Lecture du poids cumulé ligne par ligne.', 'concentration-bars')}
      </section>
      <section class="data-panel">
        <div class="panel-head"><h2>Lignes de portefeuille</h2><p>Triées par coût net investi.</p></div>
        ${assetTable()}
      </section>`;
  }

  function renderFlows() {
    const metrics = derivedMetrics();
    return `
      <section class="panel-grid two">
        ${analysisPanel('Cadence d’investissement', flowFindings(metrics))}
        ${chartPanel('Carte de chaleur DCA', 'Chaque case représente un mois; plus c’est foncé, plus le montant acheté est élevé.', 'buy-heatmap')}
      </section>
      <section class="panel-grid two">
        ${chartPanel('Apports vs déploiement', 'Comparaison des entrées de cash et de leur usage.', 'deployment-bars')}
        ${chartPanel('Fin de mois cash', 'Niveau de cash conservé sur le compte.', 'monthly-cash-bars')}
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
        ${analysisPanel('Qualité des revenus', incomeFindings(metrics))}
        ${analysisPanel('Frais, taxes et bruit opérationnel', feeFindings(metrics))}
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
      kpi('Apports', data.summary.totalDeposits, 'Cash ajouté au compte'),
      kpi('Achats portefeuille', data.summary.totalBuys, `${metrics.activeMonths}/${data.monthly.length} mois actifs`),
      kpi('Coût net investi', metrics.netInvested, `${pct(metrics.netInvested, data.summary.totalDeposits)} des apports`),
      kpi('Dépenses carte', data.summary.cardSpend, `${pct(data.summary.cardSpend, data.summary.totalDeposits)} des apports`),
      kpi('Revenus passifs', data.summary.passiveIncome, 'Dividendes + intérêts'),
      kpi('Bonus / saveback', data.summary.bonus, 'Récompenses et parrainage'),
      kpi('Solde cash final', data.summary.finalBalance, 'Citibank au 30 avr. 2026'),
      kpi('Frais + impôts', data.summary.accountFees + data.summary.taxes, `Frais déclarés: ${eur(data.summary.declaredFees)}`),
    ].join('');
  }

  function renderIncomeKpis(metrics) {
    return [
      kpi('Dividendes', data.summary.dividends, `${pct(data.summary.dividends, metrics.netInvested)} du coût net`),
      kpi('Intérêts cash', data.summary.interest, 'Rémunération du cash'),
      kpi('Bonus / saveback', data.summary.bonus, 'Récompenses réinvestissables'),
      kpi('Frais + taxes', data.summary.accountFees + data.summary.taxes, 'Bruit opérationnel identifié'),
    ].join('');
  }

  function kpi(label, value, note) {
    return `<article class="kpi"><span>${esc(label)}</span><strong>${eur(value)}</strong><small>${esc(note)}</small></article>`;
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

  function executiveFindings(metrics) {
    return [
      {
        title: 'Compte hybride, pas pur courtage',
        body: `${eur(data.summary.totalDeposits)} d’apports, ${eur(data.summary.totalBuys)} d’achats et ${eur(data.summary.cardSpend)} de dépenses carte. L’analyse doit donc isoler la carte avant de juger le portefeuille.`,
        tone: 'warning',
      },
      {
        title: 'Déploiement régulier',
        body: `${metrics.activeMonths} mois avec achats sur ${data.monthly.length}; achat moyen mensuel ${eur(metrics.avgMonthlyBuy)}. Le comportement ressemble à du DCA actif plutôt qu’à quelques gros allers-retours.`,
        tone: 'positive',
      },
      {
        title: 'Concentration mesurable',
        body: `Top 5 au coût net: ${formatNumber.format(metrics.topFiveWeight)} %. Première ligne: ${metrics.topAsset.name} à ${formatNumber.format(metrics.topAsset.weight)} %.`,
        tone: metrics.topFiveWeight > 65 ? 'warning' : 'neutral',
      },
    ];
  }

  function controlFindings(metrics) {
    return [
      { title: 'Rapprochement comptable', body: 'Entrées, sorties et solde final correspondent au relevé au centime.', tone: 'positive' },
      { title: 'Ventes limitées', body: `${eur(data.summary.totalSells)} de ventes contre ${eur(data.summary.totalBuys)} d’achats. Le turnover apparent reste faible.`, tone: 'positive' },
      { title: 'Revenus encore accessoires', body: `${eur(data.summary.passiveIncome)} de dividendes + intérêts, soit ${pct(data.summary.passiveIncome, metrics.netInvested)} du coût net.`, tone: 'neutral' },
    ];
  }

  function allocationFindings(metrics) {
    const semis = metrics.themeBreakdown.find((item) => item.label === 'Semi-conducteurs / IA');
    return [
      { title: 'Biais croissance / technologie', body: `Nasdaq, semi-conducteurs, IA et grandes actions US forment le cœur du coût investi. Semi-conducteurs / IA: ${formatNumber.format(semis?.weight || 0)} %.`, tone: 'warning' },
      { title: 'Socle diversifié présent', body: `Les ETF et ETP représentent ${formatNumber.format(metrics.classBreakdown.find((item) => item.label === 'ETF / ETP')?.weight || 0)} % du coût net positif.`, tone: 'positive' },
      { title: 'Crypto contenue mais visible', body: `Crypto au coût net: ${formatNumber.format(metrics.classBreakdown.find((item) => item.label === 'Crypto')?.weight || 0)} %.`, tone: 'neutral' },
    ];
  }

  function limitationFindings() {
    return [
      { title: 'Pas de performance réelle', body: 'Le PDF donne les flux cash, pas les cours actuels ni la valeur de marché des positions titres.' },
      { title: 'Coût net, pas allocation actuelle', body: 'Les graphiques d’allocation sont une approximation par achats moins ventes, utile pour lire les paris pris.' },
      { title: 'Quantités partielles', body: 'Les quantités sont présentes surtout sur les libellés récents; les anciennes exécutions n’en donnent pas toujours.' },
    ];
  }

  function flowFindings(metrics) {
    return [
      { title: 'Mois le plus chargé', body: `${metrics.peakBuy.month}: ${eur(metrics.peakBuy.buys)} d’achats portefeuille.`, tone: 'neutral' },
      { title: 'Cash peu dormant en fin de période', body: `Solde final ${eur(data.summary.finalBalance)} face à ${eur(metrics.netInvested)} de coût net investi.`, tone: 'positive' },
      { title: 'Carte à retraiter', body: `Les dépenses carte nettes représentent ${pct(data.summary.cardSpend - data.summary.cardRefunds, data.summary.totalDeposits)} des apports.`, tone: 'warning' },
    ];
  }

  function incomeFindings(metrics) {
    return [
      { title: 'Rendement cash faible mais croissant', body: `${eur(data.summary.dividends)} de dividendes et ${eur(data.summary.interest)} d’intérêts; le flux reste mineur par rapport aux achats.`, tone: 'neutral' },
      { title: 'Saveback utile', body: `${eur(data.summary.bonus)} de bonus/saveback. C’est plus élevé que les dividendes purs sur la période.`, tone: 'positive' },
      { title: 'Lecture fiscale incomplète', body: 'Les écritures fiscales visibles ne suffisent pas à produire une déclaration ou un calcul de plus-value.', tone: 'warning' },
    ];
  }

  function feeFindings(metrics) {
    return [
      { title: 'Frais explicites faibles', body: `${eur(data.summary.accountFees)} de frais comptabilisés et ${eur(data.summary.declaredFees)} de frais mentionnés dans certains libellés.`, tone: 'positive' },
      { title: 'Impôts détectés', body: `${eur(data.summary.taxes)} d’écritures d’impôt/tax optimisation dans le cash ledger.`, tone: 'neutral' },
      { title: 'Bruit opérationnel', body: 'Les achats carte, remboursements et cadeaux brouillent les apports si on ne les sépare pas du portefeuille.', tone: 'warning' },
    ];
  }

  function assetTable() {
    const rows = data.assets.map((asset) => `
      <tr>
        <td><strong>${esc(asset.name)}</strong><span>${esc(asset.isin)}</span></td>
        <td>${esc(asset.class)}</td>
        <td>${esc(asset.theme)}</td>
        <td class="num">${eur(asset.buyAmount)}</td>
        <td class="num">${eur(asset.sellAmount)}</td>
        <td class="num">${eur(asset.netInvested)}</td>
        <td class="num">${formatNumber.format(asset.weight)} %</td>
      </tr>`).join('');
    return table(['Actif', 'Classe', 'Thème', 'Achats', 'Ventes', 'Coût net', 'Poids'], rows);
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
    mount('cash-line', ChartKit.lineChart(data.monthly, { key: 'endBalance', color: '#65faca', label: (m) => shortMonth(m.month) }));
    mount('class-donut', classDonut(metrics));
    mountLegend('legend-class', metrics.classBreakdown);
    mount('top-assets', ChartKit.horizontalBars(data.assets.slice(0, 12).map((a) => ({ label: a.name, value: a.netInvested })), { format: eur }));
    mount('theme-bars', ChartKit.horizontalBars(metrics.themeBreakdown.map((t) => ({ label: t.label, value: t.value })), { format: eur }));
    mount('concentration-bars', ChartKit.horizontalBars(concentrationItems().slice(0, 15), { format: (v) => `${formatNumber.format(v)} %` }));
    mount('buy-heatmap', ChartKit.heatmap(data.monthly));
    mount('deployment-bars', deploymentChart());
    mount('monthly-cash-bars', ChartKit.barChart(data.monthly, { series: [{ key: 'endBalance', color: '#65faca' }], label: (m) => shortMonth(m.month) }));
    mount('income-bars', incomeChart());
    mount('merchant-bars', ChartKit.horizontalBars(data.merchants.map((m) => ({ label: m.merchant, value: m.amount })), { format: eur }));
  }

  function flowChart() {
    return ChartKit.barChart(data.monthly, {
      series: [
        { key: 'deposits', color: '#65faca' },
        { key: 'buys', color: '#bb9136' },
        { key: 'cardSpend', color: '#cc490c' },
      ],
      label: (m) => shortMonth(m.month),
    });
  }

  function incomeChart() {
    return ChartKit.barChart(data.monthly, {
      series: [
        { key: 'dividends', color: '#65faca' },
        { key: 'interest', color: '#ffffff' },
        { key: 'bonus', color: '#cc490c' },
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

  function classDonut(metrics) {
    return ChartKit.donutChart(metrics.classBreakdown.map((item) => ({ value: item.value })), {
      centerTop: eur(metrics.netInvested),
      centerBottom: 'coût net',
    });
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
    const netInvested = data.summary.totalBuys - data.summary.totalSells;
    const positiveAssets = data.assets.filter((asset) => asset.netInvested > 0);
    const classBreakdown = breakdown(positiveAssets, 'class');
    const themeBreakdown = breakdown(positiveAssets, 'theme');
    return {
      netInvested,
      classBreakdown,
      themeBreakdown,
      topAsset: positiveAssets[0] || { name: 'n/a', weight: 0 },
      topFiveWeight: positiveAssets.slice(0, 5).reduce((total, asset) => total + asset.weight, 0),
      activeMonths: data.monthly.filter((month) => month.buys > 0).length,
      avgMonthlyBuy: data.summary.totalBuys / Math.max(data.monthly.length, 1),
      peakBuy: [...data.monthly].sort((a, b) => b.buys - a.buys)[0],
    };
  }

  function breakdown(items, key) {
    const grouped = new Map();
    items.forEach((item) => grouped.set(item[key], (grouped.get(item[key]) || 0) + item.netInvested));
    const total = [...grouped.values()].reduce((sum, value) => sum + value, 0) || 1;
    return [...grouped.entries()]
      .map(([label, value]) => ({ label, value, weight: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
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
    return formatEuro.format(value || 0);
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
