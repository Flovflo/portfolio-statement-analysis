(function chartKit(global) {
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#65faca', '#cc490c', '#bb9136', '#84dc92', '#ffffff', '#9ac171', '#c38428', '#666970'];

  function svg(width, height, className = 'chart') {
    const node = document.createElementNS(NS, 'svg');
    node.setAttribute('viewBox', `0 0 ${width} ${height}`);
    node.setAttribute('role', 'img');
    className.split(/\s+/).filter(Boolean).forEach((token) => node.classList.add(token));
    return node;
  }

  function el(name, attributes = {}) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  function text(value, x, y, className, anchor = 'start') {
    const node = el('text', { x, y, 'text-anchor': anchor, class: className });
    node.textContent = value;
    return node;
  }

  function barChart(items, options) {
    const chart = svg(760, 320);
    const margin = { top: 18, right: 20, bottom: 48, left: 72 };
    const plot = { width: 760 - margin.left - margin.right, height: 320 - margin.top - margin.bottom };
    const max = Math.max(...items.flatMap((item) => options.series.map((serie) => item[serie.key])), 1);
    const groupWidth = plot.width / Math.max(items.length, 1);
    const barWidth = Math.max(3, (groupWidth - 8) / options.series.length);

    const chartOptions = { ...options, count: items.length };
    addGrid(chart, margin, plot, max);
    items.forEach((item, index) => addBarGroup(chart, item, index, chartOptions, margin, plot, max, groupWidth, barWidth));
    chart.append(text('0', 52, margin.top + plot.height + 4, 'axis-label', 'end'));
    return chart;
  }

  function addBarGroup(chart, item, index, options, margin, plot, max, groupWidth, barWidth) {
    options.series.forEach((serie, serieIndex) => {
      const value = item[serie.key] || 0;
      const height = (value / max) * plot.height;
      const x = margin.left + index * groupWidth + serieIndex * barWidth + 4;
      const y = margin.top + plot.height - height;
      chart.append(el('rect', { x, y, width: barWidth - 1, height, rx: 2, fill: serie.color }));
    });

    if (index % Math.ceil(itemsPerLabel(options.count)) === 0) {
      chart.append(text(options.label(item), margin.left + index * groupWidth + 6, 300, 'axis-label', 'middle'));
    }
  }

  function lineChart(items, options) {
    const chart = svg(760, 300);
    const margin = { top: 20, right: 24, bottom: 44, left: 72 };
    const plot = { width: 760 - margin.left - margin.right, height: 300 - margin.top - margin.bottom };
    const values = items.map((item) => item[options.key] || 0);
    const min = Math.min(0, ...values);
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => point(index, value, items.length, min, max, margin, plot));

    addGrid(chart, margin, plot, max, min);
    chart.append(el('polyline', { points: points.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: options.color, 'stroke-width': 3 }));
    points.forEach((p) => chart.append(el('circle', { cx: p.x, cy: p.y, r: 2.8, fill: options.color })));
    items.forEach((item, index) => {
      if (index % Math.ceil(itemsPerLabel(items.length)) === 0) chart.append(text(options.label(item), points[index].x, 282, 'axis-label', 'middle'));
    });
    return chart;
  }

  function donutChart(items, options) {
    const chart = svg(360, 260, 'donut');
    const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
    let start = -90;

    items.forEach((item, index) => {
      const angle = (Math.max(0, item.value) / total) * 360;
      chart.append(el('path', { d: arcPath(130, 130, 82, 46, start, start + angle), fill: COLORS[index % COLORS.length] }));
      start += angle;
    });

    chart.append(text(options.centerTop, 130, 122, 'donut-main', 'middle'));
    chart.append(text(options.centerBottom, 130, 146, 'donut-sub', 'middle'));
    return chart;
  }

  function horizontalBars(items, options = {}) {
    const chart = svg(760, Math.max(180, items.length * 34 + 34), 'chart compact-chart');
    const max = Math.max(...items.map((item) => item.value), 1);
    items.forEach((item, index) => {
      const y = 26 + index * 34;
      const width = (item.value / max) * 430;
      chart.append(text(clipLabel(item.label, 31), 16, y + 11, 'bar-label'));
      chart.append(el('rect', { x: 250, y, width: 430, height: 12, rx: 2, fill: '#242424' }));
      chart.append(el('rect', { x: 250, y, width, height: 12, rx: 2, fill: COLORS[index % COLORS.length] }));
      chart.append(text(options.format ? options.format(item.value) : item.value, 698, y + 11, 'axis-label'));
    });
    return chart;
  }

  function heatmap(months) {
    const chart = svg(760, 190, 'chart heatmap-chart');
    const max = Math.max(...months.map((month) => month.buys), 1);
    months.forEach((month, index) => {
      const col = index % 12;
      const row = Math.floor(index / 12);
      const intensity = month.buys / max;
      const color = heatColor(intensity);
      chart.append(el('rect', { x: 74 + col * 52, y: 28 + row * 32, width: 38, height: 20, rx: 3, fill: color }));
      if (row === 0) chart.append(text(month.month.slice(5), 93 + col * 52, 18, 'axis-label', 'middle'));
      if (col === 0) chart.append(text(month.month.slice(0, 4), 16, 43 + row * 32, 'axis-label'));
    });
    return chart;
  }

  function addGrid(chart, margin, plot, max, min = 0) {
    for (let step = 0; step <= 4; step += 1) {
      const y = margin.top + plot.height - (step / 4) * plot.height;
      const value = min + ((max - min) * step) / 4;
      chart.append(el('line', { x1: margin.left, x2: margin.left + plot.width, y1: y, y2: y, stroke: '#242424', 'stroke-width': 1 }));
      chart.append(text(formatShort(value), 58, y + 4, 'axis-label', 'end'));
    }
  }

  function point(index, value, count, min, max, margin, plot) {
    const x = margin.left + (index / Math.max(count - 1, 1)) * plot.width;
    const y = margin.top + plot.height - ((value - min) / Math.max(max - min, 1)) * plot.height;
    return { x, y };
  }

  function arcPath(cx, cy, outer, inner, startAngle, endAngle) {
    const startOuter = polar(cx, cy, outer, endAngle);
    const endOuter = polar(cx, cy, outer, startAngle);
    const startInner = polar(cx, cy, inner, startAngle);
    const endInner = polar(cx, cy, inner, endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${startOuter.x} ${startOuter.y} A ${outer} ${outer} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y} L ${startInner.x} ${startInner.y} A ${inner} ${inner} 0 ${largeArc} 1 ${endInner.x} ${endInner.y} Z`;
  }

  function polar(cx, cy, radius, angle) {
    const radians = ((angle - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  }

  function heatColor(value) {
    if (value > 0.72) return '#65faca';
    if (value > 0.45) return '#9ac171';
    if (value > 0.22) return '#bb9136';
    if (value > 0.03) return '#cc490c';
    return '#1a1a1a';
  }

  function itemsPerLabel(count) {
    return Math.max(1, Math.ceil(count / 10));
  }

  function formatShort(value) {
    return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function clipLabel(value, maxLength) {
    const label = String(value ?? '');
    return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
  }

  global.ChartKit = { barChart, lineChart, donutChart, horizontalBars, heatmap, COLORS };
})(window);
