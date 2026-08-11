const STORAGE_KEYS = {
  unit: 'yw-unit-system',
  theme: 'yw-theme',
  order: 'yw-chart-order',
};

const DEFAULT_ORDER = ['temperature', 'uv', 'wind', 'precipitation', 'humidity', 'dust'];

const cToF = (c) => (c * 9) / 5 + 32;
const kmhToMph = (kmh) => kmh * 0.621371;
const mmToIn = (mm) => mm * 0.0393700787;

const METRICS = {
  temperature: {
    id: 'temperature',
    label: 'Temperature',
    source: 'weather',
    decimals: 1,
    unit: { metric: '°C', imperial: '°F' },
    series: [
      { key: 'high_c', label: 'High', accentVar: '--accent-temp-high', convert: cToF },
      { key: 'low_c', label: 'Low', accentVar: '--accent-temp-low', convert: cToF },
    ],
    showSlider: true,
  },
  uv: {
    id: 'uv',
    label: 'UV Index',
    source: 'weather',
    decimals: 1,
    unit: null,
    series: [{ key: 'uv_index_max', label: 'UV Index', accentVar: '--accent-uv', convert: null }],
  },
  wind: {
    id: 'wind',
    label: 'Wind',
    source: 'weather',
    decimals: 1,
    unit: { metric: 'km/h', imperial: 'mph' },
    series: [{ key: 'wind_speed_max_kmh', label: 'Max Wind Speed', accentVar: '--accent-wind', convert: kmhToMph }],
  },
  precipitation: {
    id: 'precipitation',
    label: 'Precipitation',
    source: 'weather',
    decimals: 2,
    unit: { metric: 'mm', imperial: 'in' },
    series: [{ key: 'precipitation_mm', label: 'Rainfall', accentVar: '--accent-precip', convert: mmToIn }],
  },
  humidity: {
    id: 'humidity',
    label: 'Humidity',
    source: 'weather',
    decimals: 0,
    unit: '%',
    series: [{ key: 'humidity_mean_pct', label: 'Humidity', accentVar: '--accent-humidity', convert: null }],
  },
  dust: {
    id: 'dust',
    label: 'Dust (PM10)',
    source: 'aqi',
    decimals: 1,
    unit: 'µg/m³',
    series: [{ key: 'pm10', label: 'PM10', accentVar: '--accent-dust', convert: null }],
  },
};

const HEAT_THRESHOLD_C = 37.78; // 100°F

const state = {
  weather: [],
  aqi: [],
  order: loadOrder(),
  unitSystem: localStorage.getItem(STORAGE_KEYS.unit) || 'imperial',
  theme: localStorage.getItem(STORAGE_KEYS.theme) || null,
  currentRange: null,
  activeMobileMetric: null,
  isDesktop: window.matchMedia('(min-width: 768px)').matches,
};

const chartInstances = new Map();
let isSyncingZoom = false;

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.order));
    if (Array.isArray(saved) && saved.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every((id) => saved.includes(id))) {
      return saved;
    }
  } catch {
    // fall through to default
  }
  return [...DEFAULT_ORDER];
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function dateToMs(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getTime();
}

function nextCalendarDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatValue(metric, rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  const convert = metric.series[0].convert;
  const value = convert && state.unitSystem === 'imperial' ? convert(rawValue) : rawValue;
  return Math.round(value * 10 ** metric.decimals) / 10 ** metric.decimals;
}

function unitSuffix(metric) {
  if (!metric.unit) return '';
  if (typeof metric.unit === 'string') return metric.unit;
  return state.unitSystem === 'imperial' ? metric.unit.imperial : metric.unit.metric;
}

// ---------- Data loading ----------

async function loadJsonData(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadData() {
  const [weather, aqi] = await Promise.all([
    loadJsonData('data/cities/el-paso.json'),
    loadJsonData('data/cities/el-paso-aqi.json'),
  ]);
  state.weather = weather;
  state.aqi = aqi;
}

function seriesDataFor(metric, seriesConfig) {
  const records = metric.source === 'weather' ? state.weather : state.aqi;
  const convert = seriesConfig.convert;
  return records
    .filter((r) => r[seriesConfig.key] !== null && r[seriesConfig.key] !== undefined)
    .map((r) => {
      const raw = r[seriesConfig.key];
      const value = convert && state.unitSystem === 'imperial' ? convert(raw) : raw;
      return [dateToMs(r.date), Math.round(value * 10 ** metric.decimals) / 10 ** metric.decimals];
    });
}

// ---------- Streak calculation (full dataset, not clipped to zoom) ----------

function computeHeatStreaks(records) {
  const streaks = [];
  let start = null;
  let prevDate = null;
  let len = 0;

  for (const r of records) {
    const qualifies = typeof r.high_c === 'number' && r.high_c >= HEAT_THRESHOLD_C;
    const contiguous = prevDate && nextCalendarDay(prevDate) === r.date;
    if (qualifies && len > 0 && contiguous) {
      len += 1;
    } else if (qualifies) {
      if (len > 0) streaks.push({ start, end: prevDate, length: len });
      start = r.date;
      len = 1;
    } else if (len > 0) {
      streaks.push({ start, end: prevDate, length: len });
      len = 0;
      start = null;
    }
    prevDate = r.date;
  }
  if (len > 0) streaks.push({ start, end: prevDate, length: len });
  return streaks;
}

function longestOverlappingStreak(streaks, startMs, endMs) {
  let longest = 0;
  for (const s of streaks) {
    const sStart = dateToMs(s.start);
    const sEnd = dateToMs(s.end);
    if (sEnd >= startMs && sStart <= endMs) {
      longest = Math.max(longest, s.length);
    }
  }
  return longest;
}

let cachedStreaks = null;
function getHeatStreaks() {
  if (!cachedStreaks) cachedStreaks = computeHeatStreaks(state.weather);
  return cachedStreaks;
}

// ---------- Summary row & per-chart captions ----------

function recordsInRange(records, startMs, endMs) {
  return records.filter((r) => {
    const t = dateToMs(r.date);
    return t >= startMs && t <= endMs;
  });
}

function updateSummary() {
  if (!state.currentRange) return;
  const { startValue, endValue } = state.currentRange;
  const inRange = recordsInRange(state.weather, startValue, endValue);

  const highs = inRange.map((r) => r.high_c).filter((v) => typeof v === 'number');
  const lows = inRange.map((r) => r.low_c).filter((v) => typeof v === 'number');

  const tempMetric = METRICS.temperature;
  const highest = highs.length ? formatValue(tempMetric, Math.max(...highs)) : null;
  const lowest = lows.length ? formatValue(tempMetric, Math.min(...lows)) : null;
  const daysOver100 = highs.filter((v) => v >= HEAT_THRESHOLD_C).length;
  const streak = longestOverlappingStreak(getHeatStreaks(), startValue, endValue);
  const unit = unitSuffix(tempMetric);

  document.getElementById('stat-highest').textContent = highest === null ? '—' : `${highest}${unit}`;
  document.getElementById('stat-lowest').textContent = lowest === null ? '—' : `${lowest}${unit}`;
  document.getElementById('stat-days-over-100').textContent = String(daysOver100);
  document.getElementById('stat-streak').textContent = streak ? `${streak} days` : '0 days';
}

function updateCaptions() {
  if (!state.currentRange) return;
  const { startValue, endValue } = state.currentRange;

  for (const id of DEFAULT_ORDER) {
    const el = document.getElementById(`caption-${id}`);
    if (!el) continue;
    const metric = METRICS[id];
    const records = metric.source === 'weather' ? state.weather : state.aqi;
    const inRange = recordsInRange(records, startValue, endValue);
    const key = metric.series[0].key;
    const values = inRange.map((r) => r[key]).filter((v) => typeof v === 'number');

    if (id === 'temperature') {
      el.textContent = `${formatDateShort(startValue)} – ${formatDateShort(endValue)}`;
      continue;
    }
    if (!values.length) {
      el.textContent = 'No data in this range yet';
      continue;
    }
    const unit = unitSuffix(metric);
    if (id === 'uv') {
      el.textContent = `Max UV this period: ${formatValue(metric, Math.max(...values))}`;
    } else if (id === 'wind') {
      el.textContent = `Max wind this period: ${formatValue(metric, Math.max(...values))} ${unit}`;
    } else if (id === 'precipitation') {
      const sum = values.reduce((a, b) => a + b, 0);
      el.textContent = `Total rainfall this period: ${formatValue(metric, sum)} ${unit}`;
    } else if (id === 'humidity') {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      el.textContent = `Avg humidity this period: ${formatValue(metric, avg)}${unit}`;
    } else if (id === 'dust') {
      el.textContent = `Peak dust (PM10) this period: ${formatValue(metric, Math.max(...values))} ${unit}`;
    }
  }
}

function formatDateShort(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- Chart rendering ----------

function buildOption(metric) {
  const lineColor = cssVar('--line');
  const inkSoft = cssVar('--ink-soft');
  const monoFont = "'JetBrains Mono', monospace";

  const series = metric.series.map((s) => {
    const color = cssVar(s.accentVar);
    return {
      name: s.label,
      type: 'line',
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.6, color },
      itemStyle: { color },
      data: seriesDataFor(metric, s),
      connectNulls: false,
      animationDuration: 700,
    };
  });

  const unit = unitSuffix(metric);
  const range = state.currentRange || fullRangeFor(metric);

  const dataZoom = [
    {
      type: 'inside',
      xAxisIndex: 0,
      startValue: range.startValue,
      endValue: range.endValue,
    },
  ];
  if (metric.showSlider) {
    dataZoom.push({
      type: 'slider',
      xAxisIndex: 0,
      startValue: range.startValue,
      endValue: range.endValue,
      height: 20,
      bottom: 6,
      borderColor: lineColor,
      fillerColor: 'transparent',
      handleStyle: { color: lineColor },
      textStyle: { color: inkSoft, fontFamily: monoFont, fontSize: 10 },
      dataBackground: {
        lineStyle: { color: lineColor },
        areaStyle: { color: lineColor, opacity: 0.15 },
      },
    });
  }

  return {
    animation: true,
    aria: { show: true },
    grid: { left: 46, right: 16, top: 20, bottom: metric.showSlider ? 54 : 30 },
    textStyle: { fontFamily: monoFont },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: lineColor } },
      axisLabel: { color: inkSoft, fontFamily: monoFont, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      // Unit lives in the section heading, not the axis ticks: canvas text
      // rendering doesn't get the same font-fallback as DOM text, and glyphs
      // like µ/³ (missing from our subsetted webfont) render as tofu here.
      axisLabel: { color: inkSoft, fontFamily: monoFont, fontSize: 10 },
      splitLine: { lineStyle: { color: lineColor, opacity: 0.35 } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: cssVar('--bg'),
      borderColor: lineColor,
      textStyle: { color: cssVar('--ink'), fontFamily: monoFont, fontSize: 11 },
      valueFormatter: (v) => `${v}${unit}`,
    },
    dataZoom,
    series,
  };
}

function fullRangeFor(metric) {
  const records = metric.source === 'weather' ? state.weather : state.aqi;
  return {
    startValue: dateToMs(records[0].date),
    endValue: dateToMs(records[records.length - 1].date),
  };
}

function ensureChartInitialized(metricId) {
  if (chartInstances.has(metricId)) return chartInstances.get(metricId);
  const container = document.getElementById(`canvas-${metricId}`);
  if (!container) return null;
  const chart = echarts.init(container);
  chart.group = 'yw-synced';
  chart.setOption(buildOption(METRICS[metricId]));
  chart.on('dataZoom', () => {
    if (isSyncingZoom) return;
    const opt = chart.getOption();
    const dz = opt.dataZoom[0];
    syncZoom(dz.startValue, dz.endValue);
  });
  chartInstances.set(metricId, chart);
  echarts.connect('yw-synced');
  return chart;
}

let derivedUpdateTimer = null;

function syncZoom(startValue, endValue) {
  isSyncingZoom = true;
  state.currentRange = { startValue, endValue };
  for (const chart of chartInstances.values()) {
    chart.dispatchAction({ type: 'dataZoom', startValue, endValue });
  }
  isSyncingZoom = false;

  // 'dataZoom' fires repeatedly while dragging a slider/pinching (many times
  // a second). updateHiddenTables() in particular can rebuild thousands of
  // DOM nodes across 6 tables — running that on every single event froze the
  // tab during a drag. Debounce so it only runs once the range settles.
  if (derivedUpdateTimer) clearTimeout(derivedUpdateTimer);
  derivedUpdateTimer = setTimeout(runDerivedUpdates, 150);
}

function runDerivedUpdates() {
  updateSummary();
  updateCaptions();
  updateHiddenTables();
}

function rebuildAllCharts() {
  for (const [id, chart] of chartInstances) {
    chart.setOption(buildOption(METRICS[id]), true);
  }
}

// ---------- Accessible data tables ----------

// Rendering a row per day is only reasonable for the accessible table (and
// for the browser) up to a point — beyond this many days, a screen-reader
// table would be unusably long anyway, so a short note replaces it instead
// of quietly building thousands of DOM nodes.
const HIDDEN_TABLE_MAX_ROWS = 400;

function updateHiddenTables() {
  if (!state.currentRange) return;
  const { startValue, endValue } = state.currentRange;
  for (const id of DEFAULT_ORDER) {
    const tbody = document.getElementById(`table-body-${id}`);
    if (!tbody) continue;
    const metric = METRICS[id];
    const records = metric.source === 'weather' ? state.weather : state.aqi;
    const inRange = recordsInRange(records, startValue, endValue);
    const unit = unitSuffix(metric);

    if (inRange.length > HIDDEN_TABLE_MAX_ROWS) {
      tbody.innerHTML = `<tr><td colspan="${metric.series.length + 1}">Zoom to a range under ${HIDDEN_TABLE_MAX_ROWS} days to see a day-by-day data table (currently showing ${inRange.length} days — use the summary stats and chart caption above instead).</td></tr>`;
      continue;
    }

    const rows = inRange
      .map((r) => {
        const cells = metric.series
          .map((s) => {
            const v = formatValue(metric, r[s.key]);
            return `<td>${v === null ? '—' : `${v}${unit}`}</td>`;
          })
          .join('');
        return `<tr><th scope="row">${r.date}</th>${cells}</tr>`;
      })
      .join('');
    tbody.innerHTML = rows;
  }
}

// ---------- DOM construction ----------

function buildChartSections() {
  const container = document.getElementById('charts');
  container.innerHTML = '';

  for (const id of state.order) {
    const metric = METRICS[id];
    const section = document.createElement('section');
    section.className = 'chart-section';
    section.id = `section-${id}`;
    section.setAttribute('aria-labelledby', `heading-${id}`);

    const head = document.createElement('div');
    head.className = 'chart-section-head';
    head.innerHTML = `
      <h2 id="heading-${id}" class="eyebrow">${metric.label}</h2>
      <span class="chart-caption" id="caption-${id}"></span>
    `;
    section.appendChild(head);

    const canvas = document.createElement('div');
    canvas.className = 'chart-canvas';
    canvas.id = `canvas-${id}`;
    section.appendChild(canvas);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'sr-only';
    tableWrap.innerHTML = `
      <table>
        <caption>${metric.label} data for the currently visible date range</caption>
        <thead>
          <tr><th scope="col">Date</th>${metric.series.map((s) => `<th scope="col">${s.label}</th>`).join('')}</tr>
        </thead>
        <tbody id="table-body-${id}"></tbody>
      </table>
    `;
    section.appendChild(tableWrap);

    container.appendChild(section);
  }
  applyOrderToDom();
  updateSectionHeadings();
}

function updateSectionHeadings() {
  // Units intentionally stay out of the (uppercase, small-caps-styled)
  // heading — CSS text-transform mangles the µ in "µg/m³" — and are instead
  // only shown in the per-chart caption and tooltip, both plain-case DOM text.
  for (const id of DEFAULT_ORDER) {
    const heading = document.getElementById(`heading-${id}`);
    if (heading) heading.textContent = METRICS[id].label;
  }
}

function applyOrderToDom() {
  state.order.forEach((id, index) => {
    const section = document.getElementById(`section-${id}`);
    if (section) section.style.order = String(index);
  });
}

function buildMetricSwitcher() {
  const switcher = document.getElementById('metric-switcher');
  switcher.innerHTML = '';
  switcher.setAttribute('role', 'tablist');

  for (const id of state.order) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = METRICS[id].label;
    btn.dataset.metric = id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(id === state.activeMobileMetric));
    btn.addEventListener('click', () => showMobileMetric(id));
    switcher.appendChild(btn);
  }
}

function showMobileMetric(id) {
  state.activeMobileMetric = id;
  for (const metricId of state.order) {
    const section = document.getElementById(`section-${metricId}`);
    if (section) section.classList.toggle('is-active', metricId === id);
  }
  for (const btn of document.querySelectorAll('#metric-switcher button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.metric === id));
  }
  const chart = ensureChartInitialized(id);
  if (chart) chart.resize();
}

function buildCustomizePanel() {
  const list = document.getElementById('customize-list');
  list.innerHTML = '';
  state.order.forEach((id, index) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = METRICS[id].label;

    const btnWrap = document.createElement('span');
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑ Up';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveMetric(index, -1));

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓ Down';
    down.disabled = index === state.order.length - 1;
    down.addEventListener('click', () => moveMetric(index, 1));

    btnWrap.appendChild(up);
    btnWrap.appendChild(document.createTextNode(' '));
    btnWrap.appendChild(down);

    li.appendChild(label);
    li.appendChild(btnWrap);
    list.appendChild(li);
  });
}

function moveMetric(index, delta) {
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= state.order.length) return;
  const order = [...state.order];
  [order[index], order[newIndex]] = [order[newIndex], order[index]];
  state.order = order;
  localStorage.setItem(STORAGE_KEYS.order, JSON.stringify(order));
  applyOrderToDom();
  buildCustomizePanel();
  buildMetricSwitcher();
}

// ---------- Presets ----------

function applyPreset(preset) {
  const latest = state.weather[state.weather.length - 1].date;
  const earliest = state.weather[0].date;
  const endValue = dateToMs(latest);
  let startValue;

  if (preset === '30d') {
    const d = new Date(`${latest}T00:00:00`);
    d.setDate(d.getDate() - 30);
    startValue = d.getTime();
  } else if (preset === '1y') {
    const d = new Date(`${latest}T00:00:00`);
    startValue = new Date(d.getFullYear(), 0, 1).getTime();
  } else {
    startValue = dateToMs(earliest);
  }

  for (const btn of document.querySelectorAll('.preset-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.preset === preset));
  }

  syncZoom(startValue, endValue);
}

// ---------- Controls ----------

function applyUnitLabel() {
  const btn = document.getElementById('unit-toggle');
  btn.textContent = state.unitSystem === 'imperial' ? '°F · mph · in' : '°C · km/h · mm';
  btn.setAttribute('aria-pressed', String(state.unitSystem === 'imperial'));
}

function toggleUnitSystem() {
  state.unitSystem = state.unitSystem === 'imperial' ? 'metric' : 'imperial';
  localStorage.setItem(STORAGE_KEYS.unit, state.unitSystem);
  applyUnitLabel();
  updateSectionHeadings();
  rebuildAllCharts();
  updateSummary();
  updateCaptions();
  updateHiddenTables();
}

function applyTheme(theme) {
  if (theme) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  const resolvedDark = theme
    ? theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const btn = document.getElementById('theme-toggle');
  btn.textContent = resolvedDark ? 'Light' : 'Dark';
  btn.setAttribute('aria-pressed', String(resolvedDark));
}

function toggleTheme() {
  const currentlyDark = document.getElementById('theme-toggle').getAttribute('aria-pressed') === 'true';
  const next = currentlyDark ? 'light' : 'dark';
  state.theme = next;
  localStorage.setItem(STORAGE_KEYS.theme, next);
  applyTheme(next);
  rebuildAllCharts();
}

function setupBreakpointHandling() {
  const mql = window.matchMedia('(min-width: 768px)');
  mql.addEventListener('change', (e) => {
    state.isDesktop = e.matches;
    if (state.isDesktop) {
      for (const id of state.order) ensureChartInitialized(id);
      requestAnimationFrame(() => {
        for (const chart of chartInstances.values()) chart.resize();
      });
    } else {
      showMobileMetric(state.activeMobileMetric || state.order[0]);
    }
  });
}

// ---------- Init ----------

async function init() {
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme));
  applyUnitLabel();

  try {
    await loadData();
  } catch (err) {
    console.error(err);
    document.getElementById('loading-message').hidden = true;
    document.getElementById('error-message').hidden = false;
    return;
  }

  document.getElementById('loading-message').hidden = true;
  document.getElementById('charts').hidden = false;

  const lastDate = state.weather[state.weather.length - 1].date;
  document.getElementById('last-updated').textContent = `Data last updated: ${lastDate}`;

  buildChartSections();
  buildMetricSwitcher();
  buildCustomizePanel();

  state.activeMobileMetric = state.order[0];
  state.currentRange = fullRangeFor(METRICS.temperature);

  if (state.isDesktop) {
    for (const id of state.order) ensureChartInitialized(id);
  } else {
    showMobileMetric(state.activeMobileMetric);
  }

  updateSummary();
  updateCaptions();
  updateHiddenTables();
  setupBreakpointHandling();

  document.getElementById('unit-toggle').addEventListener('click', toggleUnitSystem);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  const customizeToggle = document.getElementById('customize-toggle');
  const customizePanel = document.getElementById('customize-panel');
  customizeToggle.addEventListener('click', () => {
    const expanded = customizeToggle.getAttribute('aria-expanded') === 'true';
    customizeToggle.setAttribute('aria-expanded', String(!expanded));
    customizePanel.hidden = expanded;
  });

  for (const btn of document.querySelectorAll('.preset-btn')) {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const chart of chartInstances.values()) chart.resize();
    }, 100);
  });
}

init();
