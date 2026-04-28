/* ═══════════════════════════════════════════════════════
   APP.JS — Navigation, initialization, dynamic content
═══════════════════════════════════════════════════════ */

/* ─── NAVIGATION ─── */
function activateSection(sectionId) {
  // Hide all sections
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));

  // Show target
  const section = document.getElementById(`section-${sectionId}`);
  if (section) section.classList.add('active');

  // Activate matching tabs (header nav + sidebar)
  document.querySelectorAll(`[data-section="${sectionId}"]`).forEach(t => t.classList.add('active'));

  // Init section-specific content
  initSectionContent(sectionId);
}

function initSectionContent(id) {
  requestAnimationFrame(() => {
    switch (id) {
      case 'dashboard':
        initMainMap();
        initDashboardCharts();
        break;
      case 'zones':
        initZonesMap();
        renderZoneList();
        break;
      case 'analytics':
        initAnalyticsCharts();
        initAnalyticsSection();
        break;
      case 'alerts':
        initAlertsCharts();
        renderAlertsGrid();
        break;
      case 'carbon':
        initCarbonCharts();
        renderCarbonTable();
        initCarbonCalculator();
        initCarbonSection();
        break;
      case 'biodiversity':
        initBioCharts();
        initBioSection();
        break;
      case 'data-layers':
        initLayersMap();
        break;
      case 'settings':
        renderPinsStatus();
        break;
    }
  });
}

/* ─── RENDER ZONE LIST ─── */
function renderZoneList() {
  const container = document.getElementById('zone-items-list');
  if (!container || container.children.length > 0) return;

  ZONES.forEach(zone => {
    const item = document.createElement('div');
    item.className = 'zone-item';
    item.dataset.zoneId = zone.id;
    const riskColor = getRiskColor(zone.risk);
    const badgeClass = zone.risk === 'high' ? 'danger' : zone.risk === 'moderate' ? 'warning' : 'success';

    item.innerHTML = `
      <div class="zone-risk-dot" style="background:${riskColor}"></div>
      <div class="zone-item-info">
        <div class="zone-item-name">${zone.name}</div>
        <div class="zone-item-meta">${zone.area} ha · ${zone.cluster} · NDVI ${zone.ndvi}</div>
      </div>
      <div class="zone-item-badges">
        <span class="zone-badge ${badgeClass}">${zone.riskScore}/100</span>
        <span style="font-size:9px;color:#64748b">${zone.vegetation}% veg</span>
      </div>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('.zone-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      if (zonesMap) zonesMap.setView(zone.center, 15);
    });

    container.appendChild(item);
  });
}

/* ─── RENDER ALERTS GRID ─── */
function renderAlertsGrid() {
  const container = document.getElementById('alerts-grid');
  if (!container || container.children.length > 0) return;

  ALERTS_DATA.forEach(alert => {
    const card = document.createElement('div');
    card.className = `alert-card ${alert.severity}`;
    card.innerHTML = `
      <div class="alert-card-header">
        <span class="alert-card-badge ${alert.severity}">${alert.severity.toUpperCase()}</span>
        <span style="font-size:10px;color:#64748b;font-family:'IBM Plex Mono',monospace">${alert.date}</span>
      </div>
      <div class="alert-card-title">${alert.title}</div>
      <div class="alert-card-desc">${alert.description}</div>
      <div class="alert-card-meta">
        <span>📍 ${alert.zone}</span>
        <span>⚡ O&amp;M Required</span>
        <span class="alert-tag ${alert.severity === 'critical' ? 'danger' : 'warning'}" style="margin-left:auto">${alert.zone}</span>
      </div>
      <div class="alert-card-actions">
        ${alert.actions.map(a => `<button class="btn-secondary btn-sm">${a}</button>`).join('')}
      </div>
    `;
    container.appendChild(card);
  });
}

/* ─── RENDER CARBON TABLE — fetches /api/carbon/history, falls back to CARBON_TABLE_DATA ─── */
async function renderCarbonTable() {
  const tbody = document.getElementById('carbon-table-body');
  if (!tbody) return;

  // Loading state
  tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-3);text-align:center;padding:12px;font-size:11px">Loading carbon data…</td></tr>';

  try {
    const data = typeof apiFetch === 'function' ? await apiFetch('/carbon/history') : null;
    tbody.innerHTML = '';

    if (data && data.records && data.records.length > 0) {
      // Sort newest first
      // DB fields: timestamp, som_pct, bulk_density_g_cm3, carbon_stock_t_per_ha
      const records = data.records.slice().sort((a, b) =>
        (b.timestamp || b.created_at || '').localeCompare(a.timestamp || a.created_at || ''));
      records.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const carbonStock = parseFloat(row.carbon_stock_t_per_ha) || 0;
        const co2e = carbonStock * 3.67;
        const som  = parseFloat(row.som_pct  ?? row.som_percent)          || 0;
        const bd   = parseFloat(row.bulk_density_g_cm3 ?? row.bulk_density) || 0;
        const depth = row.depth_cm || 15;
        const date  = (row.timestamp || row.created_at || row.sampling_date || '—').slice(0, 10);
        const field = row.field_name || (row.zone != null ? `Tsenovo Z${row.zone}` : 'Tsenovo Z3');

        // Change vs. previous record
        let changeHtml = '<span style="color:#64748b">Ref</span>';
        const nextRec = records[idx + 1];  // records are newest-first, so nextRec is older
        if (nextRec) {
          const prevCarbon = parseFloat(nextRec.carbon_stock_t_per_ha) || carbonStock;
          const pct = prevCarbon > 0 ? ((carbonStock - prevCarbon) / prevCarbon * 100) : 0;
          const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : '#64748b';
          changeHtml = `<span style="color:${color}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
        }

        tr.innerHTML = `
          <td>${field}</td>
          <td>${date}</td>
          <td>${depth} cm</td>
          <td>${som.toFixed(2)}%</td>
          <td>${bd > 0 ? bd.toFixed(2) : '—'}</td>
          <td>${carbonStock.toFixed(2)}</td>
          <td>${co2e.toFixed(2)}</td>
          <td>${changeHtml}</td>
        `;
        tbody.appendChild(tr);
      });
      return;
    }
  } catch {
    // Fall through to static fallback below
  }

  // Static fallback
  tbody.innerHTML = '';
  (typeof CARBON_TABLE_DATA !== 'undefined' ? CARBON_TABLE_DATA : []).forEach(row => {
    const tr = document.createElement('tr');
    const changeColor = row.change === 'ref' ? '#64748b' : parseFloat(row.change) > 0 ? '#22c55e' : '#ef4444';
    tr.innerHTML = `
      <td>${row.field}</td>
      <td>${row.date}</td>
      <td>${row.depth} cm</td>
      <td>${row.som}</td>
      <td>${row.bd}</td>
      <td>${row.carbon}</td>
      <td>${row.co2}</td>
      <td style="color:${changeColor}">${row.change === 'ref' ? '—' : (parseFloat(row.change) > 0 ? '+' : '') + row.change + '%'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ─── RENDER BIRD LIST (enhanced) ─── */
let _birdFilter = 'all';

function renderBirdList() {
  const container = document.getElementById('bird-list');
  if (!container) return;
  container.innerHTML = '';

  const filtered = _birdFilter === 'all'
    ? BIRD_DATA
    : BIRD_DATA.filter(b => b.status === _birdFilter);

  filtered.forEach(bird => {
    const trendColor  = bird.trend === '↑' ? '#22c55e' : bird.trend === '↓' ? '#ef4444' : '#94a3b8';
    const statusClass = 'bsb-' + (bird.status || 'common');
    const statusLabel = (bird.status || 'common').replace(/-/g, '‑');
    const row = document.createElement('div');
    row.className = 'bird-row-v2';
    row.innerHTML = `
      <div class="bird-icon">🐦</div>
      <div class="bird-info">
        <div class="bird-name-v2">${bird.name}</div>
        <div class="bird-latin">${bird.species}</div>
        <div class="bird-meta">
          <span class="bird-status-badge ${statusClass}">${statusLabel}</span>
          ${bird.iucn  ? `<span style="font-size:8px;color:var(--text-3)">${bird.iucn}</span>` : ''}
          ${bird.zone  ? `<span style="font-size:8px;color:var(--text-3)">${bird.zone}</span>` : ''}
        </div>
      </div>
      <div class="bird-right">
        <span class="bird-count-v2">${bird.count}</span>
        <span class="bird-trend-v2" style="color:${trendColor}">${bird.trend}</span>
        ${bird.confidence ? `<span class="bird-conf">${(bird.confidence*100).toFixed(0)}% conf</span>` : ''}
      </div>
    `;
    container.appendChild(row);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:var(--text-3);font-size:11px;text-align:center">No species match this filter</div>';
  }
}

function filterBirdList(status, btn) {
  _birdFilter = status;
  document.querySelectorAll('.baf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderBirdList();
}

/* ─── RENDER PINS STATUS (static fallback — live.js replaces with real API data) ─── */
function renderPinsStatus() {
  const container = document.getElementById('pins-status-grid');
  if (!container) return;
  // live.js fetchAndUpdatePinStatus() will overwrite this — only render static if container empty
  if (container.children.length > 0) return;

  const pins = [
    { id: 'P04', online: false }, { id: 'P08', online: true },
    { id: 'P11', online: true },  { id: 'P15', online: true },
    { id: 'P18', online: false }, { id: 'P02', online: true },
    { id: 'P07', online: true },  { id: 'P12', online: true }
  ];

  pins.forEach(pin => {
    const card = document.createElement('div');
    card.className = 'pin-status-card';
    card.innerHTML = `
      <div class="pin-status-id">${pin.id}</div>
      <div class="pin-status-dot ${pin.online ? 'online' : 'offline'}"></div>
      <div class="pin-status-label">${pin.online ? 'Online' : 'Offline'}</div>
    `;
    container.appendChild(card);
  });
}

/* ─── CARBON CALCULATOR (slider-driven, live preview) ─── */

// Site average from Zone 3 latest reading (Apr 2026)
const CALC_SITE_REFERENCE_TC = 4.30;

function _calcCarbon(som, bd, depth) {
  const oc = som * 0.58;
  return { oc, carbonStock: oc * bd * depth * 100 / 1000 };
}

// Slider track fill definitions — must match the HTML min/max attributes
const _SLIDER_RANGES = {
  'inp-som':   { min: 0.5,  max: 8    },
  'inp-bd':    { min: 0.80, max: 1.80 },
  'inp-depth': { min: 5,    max: 60   },
};

function _updateSliderTrack(id) {
  const el = document.getElementById(id);
  const range = _SLIDER_RANGES[id];
  if (!el || !range) return;
  const pct = ((parseFloat(el.value) - range.min) / (range.max - range.min)) * 100;
  // Set the CSS custom property on the input element itself; the
  // ::webkit-slider-runnable-track pseudo-element inherits it.
  el.style.setProperty('--pct', pct.toFixed(1) + '%');
}

function onCalcSlider() {
  // Update track fill for every slider first (visual feedback is instant)
  _updateSliderTrack('inp-som');
  _updateSliderTrack('inp-bd');
  _updateSliderTrack('inp-depth');

  const som   = parseFloat(document.getElementById('inp-som')?.value)   || 3.5;
  const bd    = parseFloat(document.getElementById('inp-bd')?.value)    || 1.34;
  const depth = parseFloat(document.getElementById('inp-depth')?.value) || 15;

  // Update display labels
  const dispSom   = document.getElementById('disp-som');
  const dispBd    = document.getElementById('disp-bd');
  const dispDepth = document.getElementById('disp-depth');
  if (dispSom)   dispSom.textContent   = som.toFixed(1) + '%';
  if (dispBd)    dispBd.textContent    = bd.toFixed(2);
  if (dispDepth) dispDepth.textContent = depth + ' cm';

  const { carbonStock } = _calcCarbon(som, bd, depth);
  const co2e = carbonStock * 3.67;

  // Animate the result number
  const tcEl  = document.getElementById('calc-tc');
  const co2El = document.getElementById('calc-co2');
  if (tcEl)  tcEl.textContent  = carbonStock.toFixed(2);
  if (co2El) co2El.textContent = co2e.toFixed(2);

  // Color-code tC value
  if (tcEl) {
    tcEl.style.color = carbonStock >= 5.5 ? '#22c55e'
                     : carbonStock >= 3.5 ? '#f59e0b'
                     : '#ef4444';
  }

  // vs. site average chip
  const vsEl = document.getElementById('calc-vs-site');
  if (vsEl) {
    const diff = carbonStock - CALC_SITE_REFERENCE_TC;
    const pct  = CALC_SITE_REFERENCE_TC > 0 ? (diff / CALC_SITE_REFERENCE_TC * 100) : 0;
    const sign = diff >= 0 ? '+' : '';
    const col  = diff >= 0 ? '#22c55e' : '#ef4444';
    vsEl.innerHTML = `<span style="color:${col}">${sign}${pct.toFixed(0)}%</span> vs site avg (${CALC_SITE_REFERENCE_TC} tC/ha)`;
  }

  // ── Visual result bar (new) ──
  const barFill = document.getElementById('calc-result-bar-fill');
  if (barFill) {
    const pct = Math.min(100, (carbonStock / 10) * 100);
    barFill.style.width = pct.toFixed(1) + '%';
    // Shift background gradient position to highlight current zone on spectrum
    const pos = Math.max(0, Math.min(100, 100 - pct)) + '%';
    barFill.style.backgroundPosition = pos + ' 0';
  }

  // Sync the save button with last calc values
  const saveBtn = document.getElementById('calc-save-btn');
  if (saveBtn) {
    saveBtn.dataset.som   = som;
    saveBtn.dataset.bd    = bd;
    saveBtn.dataset.depth = depth;
    saveBtn.dataset.tc    = carbonStock.toFixed(4);
  }

  // Update carbon price conversion (if the price block is visible)
  if (typeof onCarbonPriceSlide === 'function') onCarbonPriceSlide();
}

async function saveCalcResult() {
  const btn = document.getElementById('calc-save-btn');
  if (!btn) return;

  const som   = parseFloat(btn.dataset.som)   || 3.5;
  const bd    = parseFloat(btn.dataset.bd)    || 1.34;
  const depth = parseFloat(btn.dataset.depth) || 15;
  const tc    = parseFloat(btn.dataset.tc)    || 0;

  btn.disabled = true;
  btn.textContent = '⏳ Saving…';

  try {
    // Use calculateCarbonAPI from api.js if available, else raw POST
    let result = null;
    if (typeof calculateCarbonAPI === 'function') {
      result = await calculateCarbonAPI(som, bd, depth, 1.0, 3);
      result = result?.result || null;
    } else if (typeof apiFetch === 'function') {
      result = await apiFetch('/carbon/calculate', {
        method: 'POST',
        body: JSON.stringify({ som_pct: som, bulk_density_g_cm3: bd, depth_cm: depth, area_ha: 1.0 })
      });
    }

    if (result) {
      const saved = parseFloat(result.carbon_stock_t_per_ha) || tc;
      showToast(`✅ Saved — ${saved.toFixed(2)} tC/ha recorded to soil lab`);
      // Refresh carbon table if visible
      if (typeof renderCarbonTable === 'function') {
        const tbody = document.getElementById('carbon-table-body');
        if (tbody) { tbody.innerHTML = ''; renderCarbonTable(); }
      }
    } else {
      showToast(`✅ Calculated — ${tc.toFixed(2)} tC/ha (offline mode)`);
    }
  } catch (e) {
    showToast(`⚠ Save failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save to Records';
  }
}

// Initialize sliders — seed track fills and optionally pre-set values from API
function initCarbonCalculator() {
  // Ensure the track gradient matches the initial slider values immediately
  _updateSliderTrack('inp-som');
  _updateSliderTrack('inp-bd');
  _updateSliderTrack('inp-depth');
  // Seed the sliders with the latest lab reading if available
  if (typeof _lastDash !== 'undefined' && _lastDash?.carbon?.latest) {
    const r = _lastDash.carbon.latest;
    const somEl   = document.getElementById('inp-som');
    const bdEl    = document.getElementById('inp-bd');
    if (somEl && r.som_pct)            somEl.value = r.som_pct;
    if (bdEl  && r.bulk_density_g_cm3) bdEl.value  = r.bulk_density_g_cm3;
  }
  onCalcSlider(); // trigger initial render
}


/* ═══════════════════════════════════════════════════════
   ANALYTICS — Interactive Section
═══════════════════════════════════════════════════════ */

let _analyticsActiveZones = new Set([1,2,3,4,5,6,7,8,9]);
let _analyticsCurrentRange = '6m';
let _analyticsInited = false;

function initAnalyticsSection() {
  if (_analyticsInited) return;  // only run once
  _analyticsInited = true;
  renderAnalyticsZoneChips();
  initAnalyticsKPIs();
  seedAnalyticsCharts('6m');
}

/* ─── Zone filter chips ─── */
function renderAnalyticsZoneChips() {
  const container = document.getElementById('analytics-zone-chips');
  if (!container || container.children.length > 0) return;
  ZONES.forEach(z => {
    const btn = document.createElement('button');
    btn.className = 'azf-chip active';
    btn.dataset.zoneId = z.id;
    btn.style.setProperty('--chip-color', z.color);
    btn.textContent = `Z${z.id}`;
    btn.addEventListener('click', () => toggleAnalyticsZone(z.id, btn));
    container.appendChild(btn);
  });
}

function toggleAnalyticsZone(zoneId, btn) {
  if (_analyticsActiveZones.has(zoneId)) {
    _analyticsActiveZones.delete(zoneId);
    btn.classList.remove('active');
  } else {
    _analyticsActiveZones.add(zoneId);
    btn.classList.add('active');
  }
  const chart = window._chartInst?.ndviAllZones;
  if (chart) {
    chart.data.datasets.forEach((ds, i) => {
      ds.hidden = !_analyticsActiveZones.has(i + 1);
    });
    chart.update();
  }
}

function selectAllAnalyticsZones() {
  ZONES.forEach(z => _analyticsActiveZones.add(z.id));
  document.querySelectorAll('.azf-chip').forEach(b => b.classList.add('active'));
  const chart = window._chartInst?.ndviAllZones;
  if (chart) { chart.data.datasets.forEach(ds => ds.hidden = false); chart.update(); }
}

function clearAllAnalyticsZones() {
  _analyticsActiveZones.clear();
  document.querySelectorAll('.azf-chip').forEach(b => b.classList.remove('active'));
  const chart = window._chartInst?.ndviAllZones;
  if (chart) { chart.data.datasets.forEach(ds => ds.hidden = true); chart.update(); }
}

/* ─── Time range selector ─── */
function setAnalyticsTimeRange(range) {
  _analyticsCurrentRange = range;
  document.querySelectorAll('.trp-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });
  seedAnalyticsCharts(range);
}

/* ─── Chart data seeding ─── */
function _analyticsLabels(range) {
  const now = new Date();
  const n = { '3m': 3, '6m': 6, '1y': 12, 'all': 24 }[range] || 6;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return d.toLocaleDateString('en', { month: 'short', year: '2-digit' });
  });
}

function _ndviTrendData(baseNdvi, n) {
  const start = baseNdvi * 0.78;
  return Array.from({ length: n }, (_, i) => {
    const t = i / Math.max(n - 1, 1);
    const trend = start + (baseNdvi - start) * t;
    const noise = (Math.random() - 0.48) * 0.025;
    return +Math.max(0.05, Math.min(0.92, trend + noise)).toFixed(3);
  });
}

function _carbonTrendData(n) {
  const base = 3.44, end = 4.30;
  return Array.from({ length: n }, (_, i) => {
    const t = i / Math.max(n - 1, 1);
    return +(base + (end - base) * t + (Math.random() - 0.5) * 0.08).toFixed(2);
  });
}

function seedAnalyticsCharts(range) {
  const labels = _analyticsLabels(range);
  const n = labels.length;

  // ── NDVI All Zones ──
  const ndviChart = window._chartInst?.ndviAllZones;
  if (ndviChart) {
    ndviChart.data.labels = labels;
    ndviChart.data.datasets.forEach((ds, i) => {
      const zone = ZONES[i];
      if (!zone) return;
      ds.data = _ndviTrendData(zone.ndvi, n);
      ds.hidden = !_analyticsActiveZones.has(zone.id);
    });
    ndviChart.options.animation = { duration: 600 };
    ndviChart.update('active');
  }

  // ── Carbon Trend ──
  const carbonChart = window._chartInst?.analyticsCarbon;
  if (carbonChart) {
    const stockData = _carbonTrendData(n);
    carbonChart.data.labels = labels;
    carbonChart.data.datasets[0].data = stockData;
    carbonChart.data.datasets[1].data = stockData.map(v => +(v * 3.67).toFixed(2));
    carbonChart.data.datasets[2].data = labels.map(() => 18); // target line
    carbonChart.options.animation = { duration: 600 };
    carbonChart.update('active');

    // Update trend badge
    const pill = document.getElementById('carbon-trend-pill');
    if (pill && stockData.length >= 2) {
      const first = stockData[0], last = stockData[stockData.length - 1];
      const pct = ((last - first) / first * 100).toFixed(1);
      pill.textContent = (pct >= 0 ? '+' : '') + pct + '%';
      pill.className = 'trend-badge-pill ' + (pct >= 0 ? 'positive' : 'negative');
      pill.style.display = '';
    }
  }

  // ── SOM Bubble scatter ──
  const somChart = window._chartInst?.somBulkDensity;
  if (somChart) {
    // Use real zone data with small variation per range
    somChart.data.datasets[0].data = ZONES.map(z => ({
      x: +(1.0 + (z.riskScore / 100) * 0.7 + (Math.random() - 0.5) * 0.08).toFixed(2),
      y: +(2.2 + ((100 - z.riskScore) / 100) * 4.5 + (Math.random() - 0.5) * 0.3).toFixed(1),
      r: Math.max(4, Math.min(18, z.area / 4)),
    }));
    somChart.data.datasets[0].backgroundColor = ZONES.map(z => z.color + 'aa');
    somChart.data.datasets[0].borderColor      = ZONES.map(z => z.color);
    somChart.data.datasets[0].label = 'Zones';
    somChart.options.animation = { duration: 600 };
    somChart.update('active');
  }

  // ── Biodiversity Radar ── (static but animate in)
  const bioChart = window._chartInst?.analyticsBio;
  if (bioChart) {
    bioChart.data.datasets[0].data = [65, 76, 56, 72, 60, 86];
    bioChart.options.animation = { duration: 800 };
    bioChart.update('active');
  }
}

/* ─── KPI Strip ─── */
function initAnalyticsKPIs() {
  const z3 = ZONES.find(z => z.id === 3) || {};
  const avgVeg = Math.round(ZONES.reduce((s, z) => s + z.vegetation, 0) / ZONES.length);

  // NDVI
  _setAkpi('akpi-ndvi', 'akpi-ndvi-delta', z3.ndvi || 0.29, 2, '', '', '+0.07 ↑ 6m', 'positive');
  // Risk
  _setAkpi('akpi-risk', 'akpi-risk-delta', z3.riskScore || 78, 0, '', '', '−4 ↓ improving', 'positive');
  // Carbon
  _setAkpi('akpi-carbon', 'akpi-carbon-delta', 4.30, 2, '', ' tC/ha', '+0.86 ↑ 6m', 'positive');
  // Species
  _setAkpi('akpi-species', 'akpi-species-delta', 41, 0, '', '', '+5 ↑ vs last yr', 'positive');
  // Vegetation
  _setAkpi('akpi-veg', 'akpi-veg-delta', avgVeg, 0, '', '%', '+11% ↑ 6m', 'positive');

  // Sparklines
  drawSparkline('spark-ndvi',    [0.20, 0.22, 0.24, 0.26, 0.27, 0.29], '#22c55e');
  drawSparkline('spark-risk',    [82,   80,   79,   79,   78,   78  ], '#ef4444', true);
  drawSparkline('spark-carbon',  [3.44, 3.62, 3.78, 3.99, 4.15, 4.30], '#f59e0b');
  drawSparkline('spark-species', [36,   37,   38,   39,   40,   41  ], '#14b8a6');
  drawSparkline('spark-veg',     [44,   47,   49,   52,   54,   56  ], '#3b82f6');
}

function _setAkpi(valueId, deltaId, to, decimals, prefix, suffix, deltaText, deltaClass) {
  const valEl = document.getElementById(valueId);
  if (valEl && typeof animateNumber === 'function') {
    animateNumber(valEl, to, decimals, prefix, suffix);
  }
  const dltEl = document.getElementById(deltaId);
  if (dltEl) {
    dltEl.textContent = deltaText;
    dltEl.className   = 'akpi-delta ' + (deltaClass || '');
  }
}

/* ─── Sparkline renderer (pure 2D Canvas, no Chart.js) ─── */
function drawSparkline(canvasId, data, color, inverted) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;

  ctx.clearRect(0, 0, w, h);

  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * (h - 5) - 2
  }));

  // Gradient fill under the line
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '44');
  grad.addColorStop(1, color + '00');

  // Draw filled area
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(cpx, pts[i-1].y, cpx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(cpx, pts[i-1].y, cpx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // End dot
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/* ─── Chart view toggle (Line / Area) ─── */
function setChartMode(chartName, mode, btn) {
  document.querySelectorAll(`.cvt[data-chart="${chartName}"]`).forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (chartName === 'ndvi') {
    const chart = window._chartInst?.ndviAllZones;
    if (!chart) return;
    chart.data.datasets.forEach(ds => {
      ds.fill = (mode === 'area');
      ds.backgroundColor = mode === 'area' ? ds.borderColor + '20' : 'transparent';
    });
    chart.update();
  }
}

/* ─── AI Analytics Insights ─── */
async function runAIAnalyticsInsights() {
  const btn  = document.getElementById('btn-ai-analytics');
  const body = document.getElementById('analytics-insights-body');
  if (!body) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing…'; }
  body.innerHTML = '<div class="insights-loading"><div class="spinner"></div><span>AI is analyzing erosion trends, vegetation recovery, carbon sequestration, and biodiversity data…</span></div>';

  try {
    // Gather live data from DOM / last dashboard fetch
    const dash       = window._lastDash || {};
    const ndvi       = dash.ndvi?.ndvi_mean ?? 0.29;
    const shannonEl  = document.getElementById('shannon-value');
    const speciesEl  = document.getElementById('species-total');
    const shannon_h  = parseFloat(shannonEl?.textContent) || 3.82;
    const species_richness = parseInt(speciesEl?.textContent) || 41;
    // Carbon stock — read last spark value or default
    const carbon_tc_ha = 4.30;
    // Risk score — read from the gauge SVG text element
    const gaugeNum = document.getElementById('gauge-number');
    const risk_score = gaugeNum ? (parseFloat(gaugeNum.textContent) || 74) : 74;

    // Try live AI endpoint first
    let parsed = null;
    if (typeof apiFetch === 'function') {
      const raw = await apiFetch('/ai/analytics-insights', {
        method: 'POST',
        body: JSON.stringify({ ndvi, risk_score, carbon_tc_ha, shannon_h, species_richness, avg_vegetation_pct: 56 })
      });
      if (raw?.insights) parsed = raw;
    }

    // Fallback mock insights
    const insights = parsed?.insights || [
      { icon: '🌿', label: 'Vegetation Recovery', text: 'Zone 3 NDVI rose 32% over 6 months (0.22 → 0.29), signalling early-stage vegetation recovery. At the current trajectory, the "moderate" threshold of 0.35 is approximately 3–4 months away. Continue targeted revegetation on upper slopes.' },
      { icon: '🌍', label: 'Carbon Sequestration', text: 'Soil carbon stock improved +25% (3.44 → 4.30 tC/ha), reducing erosion losses and increasing organic matter retention. This equals ~15.8 tCO₂e/ha — a material positive for ESG reporting and potential carbon credit issuance.' },
      { icon: '⚠', label: 'Erosion Risk', text: 'Risk score remains elevated at 78/100 despite marginal improvement. Zone 3\'s 70 m elevation gradient continues to drive active rill formation. April precipitation (42.5 mm) may reverse recovery gains if vegetative cover on upper slopes stays below 30%.' },
    ];
    const recs = parsed?.recommendations || [
      { icon: '💧', text: 'Deploy temporary erosion barriers (straw wattles or geotextile rolls) on upper-slope rills in Zone 3 before the summer convective season (June–August).' },
      { icon: '🌱', text: 'Expand native grass seeding to 8–10 ha of bare patches identified in Smart Pin P04 and P11 imagery. Target: >35% cover by end of Q3 2026.' },
    ];

    body.innerHTML = `
      <div class="insights-chips-row">
        ${insights.map(i => `
          <div class="insight-chip">
            <div class="ic-header">
              <span class="ic-icon">${i.icon}</span>
              <span class="ic-label">${i.label}</span>
            </div>
            <div class="ic-text">${i.text}</div>
          </div>
        `).join('')}
      </div>
      <div class="insights-recs">
        <div class="insights-recs-label">Recommendations</div>
        ${recs.map(r => `
          <div class="insights-rec-row">
            <span class="irr-icon">${r.icon}</span>
            <span class="irr-text">${r.text}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="insights-empty"><span class="insights-empty-icon">⚠</span><span>Failed to generate insights: ${e.message}</span></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Insights'; }
  }
}

function exportAnalyticsCSV() {
  showToast('📊 CSV export would download zone analytics for the selected time range.');
}

/* ═══════════════════════════════════════════════════════
   CARBON SECTION — Interactive Enhancements
═══════════════════════════════════════════════════════ */

let _carbonSectionInited = false;
let _carbonSortState = { col: 'date', dir: 'desc' };

function initCarbonSection() {
  // Draw KPI sparklines (seed with historical trend)
  if (typeof drawSparkline === 'function') {
    drawSparkline('spark-c-stock', [3.44, 3.62, 3.78, 3.99, 4.15, 4.30], '#22c55e');
    drawSparkline('spark-c-co2e', [12.6, 13.3, 13.9, 14.6, 15.2, 15.8], '#3b82f6');
    drawSparkline('spark-c-som',  [3.0,  3.1,  3.2,  3.4,  3.5,  3.5 ], '#f59e0b');
  }
  // Init price slider and trajectory slider
  onCarbonPriceSlide();
  onSeqRateChange();
}

/* ─── Carbon price slider ─── */
function onCarbonPriceSlide() {
  const priceEl = document.getElementById('inp-price');
  if (!priceEl) return;
  const price = parseFloat(priceEl.value) || 50;

  // Track fill
  const minP = 10, maxP = 150;
  priceEl.style.setProperty('--pct', ((price - minP) / (maxP - minP) * 100).toFixed(1) + '%');

  // Display labels
  const dispPrice = document.getElementById('disp-price');
  if (dispPrice) dispPrice.textContent = price;
  const kpiPriceLabel = document.getElementById('kpi-price-label');
  if (kpiPriceLabel) kpiPriceLabel.textContent = price;

  // Get current calc result
  const carbonStock = parseFloat(document.getElementById('calc-tc')?.textContent) || 0;
  const co2e        = parseFloat(document.getElementById('calc-co2')?.textContent) || 0;
  const seqRate     = parseFloat(document.getElementById('inp-seq-rate')?.value)   || 0.30;

  const annualCO2e = seqRate * 3.67;              // tCO₂e sequestered per ha per year
  const offsetVal  = annualCO2e * price;           // €/ha/yr
  const zoneArea   = 41.96;                        // Zone 3
  const zoneTotal  = offsetVal * zoneArea;         // €/yr for Zone 3
  const fmt = v => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Update price result block
  const offsetEl = document.getElementById('calc-offset-val');
  const zoneEl   = document.getElementById('calc-zone-total');
  if (offsetEl) offsetEl.textContent = '€' + fmt(offsetVal);
  if (zoneEl)   zoneEl.textContent   = '€' + fmt(zoneTotal);

  // Update credit KPI card
  const creditValEl = document.getElementById('kpi-credit-val');
  if (creditValEl) creditValEl.textContent = '€' + fmt(offsetVal);

  // Update metrics panel financial rows
  const creditRevEl = document.getElementById('metric-credit-revenue');
  const tenYrEl     = document.getElementById('metric-10yr-value');
  if (creditRevEl) creditRevEl.textContent = '€' + fmt(zoneTotal) + '/yr';
  if (tenYrEl)     tenYrEl.textContent     = '€' + fmt(zoneTotal * 10);
}

/* ─── Trajectory rate slider ─── */
function onSeqRateChange() {
  const el = document.getElementById('inp-seq-rate');
  if (!el) return;
  const rate = parseFloat(el.value) || 0.30;

  // Track fill
  const minR = 0.05, maxR = 1.0;
  el.style.setProperty('--pct', ((rate - minR) / (maxR - minR) * 100).toFixed(1) + '%');

  // Display label
  const dispEl = document.getElementById('disp-seq-rate');
  if (dispEl) dispEl.textContent = rate.toFixed(2);

  // Rebuild trajectory chart projections
  const tChart = window._chartInst?.carbonTrajectory;
  if (tChart) {
    const allYears = ['2020','2021','2022','2023','2024','2025','2026','2027','2028','2029','2030'];
    const lastKnownIdx = 6;  // 2026 index
    const baseStock    = 4.30;

    const bauData = allYears.map((_, i) =>
      i < lastKnownIdx
        ? tChart.data.datasets[0].data[i]  // keep actual data
        : +(baseStock + rate * (i - lastKnownIdx)).toFixed(2));

    const targetData = allYears.map((_, i) =>
      i < lastKnownIdx
        ? null
        : +(baseStock + rate * 1.6 * (i - lastKnownIdx)).toFixed(2));

    tChart.data.datasets[1].data = bauData;
    tChart.data.datasets[2].data = targetData;
    tChart.options.animation = { duration: 350 };
    tChart.update('active');
  }

  // Also refresh price output (annual seq rate feeds into credit calc)
  onCarbonPriceSlide();
}

/* ─── Sortable carbon table ─── */
function sortCarbonTable(col) {
  // Toggle direction if same column
  if (_carbonSortState.col === col) {
    _carbonSortState.dir = _carbonSortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _carbonSortState.col = col;
    _carbonSortState.dir = 'desc';
  }

  // Update header classes
  document.querySelectorAll('#carbon-data-table .sortable-col').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('onclick')?.includes(`'${col}'`)) {
      th.classList.add(_carbonSortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  // Sort table rows in place
  const tbody = document.getElementById('carbon-table-body');
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const cells = { asc: 1, desc: -1 }[_carbonSortState.dir];
    let av, bv;
    switch (col) {
      case 'field':  av = a.cells[0]?.textContent || ''; bv = b.cells[0]?.textContent || ''; return av.localeCompare(bv) * cells;
      case 'date':   av = a.cells[1]?.textContent || ''; bv = b.cells[1]?.textContent || ''; return av.localeCompare(bv) * cells;
      case 'som':    av = parseFloat(a.cells[3]?.textContent) || 0; bv = parseFloat(b.cells[3]?.textContent) || 0; return (av - bv) * cells;
      case 'carbon': av = parseFloat(a.cells[5]?.textContent) || 0; bv = parseFloat(b.cells[5]?.textContent) || 0; return (av - bv) * cells;
      default: return 0;
    }
  });

  rows.forEach(r => tbody.appendChild(r));
  showToast(`Sorted by ${col} (${_carbonSortState.dir})`);
}

/* ─── Carbon export stubs ─── */
function exportCarbonCSV() {
  showToast('📊 CSV export would download carbon soil lab records.');
}
function exportCarbonPDF() {
  showToast('📄 PDF export would generate a formatted carbon accounting report.');
}

/* ═══════════════════════════════════════════════════════
   BIODIVERSITY SECTION — Interactive Enhancements
═══════════════════════════════════════════════════════ */

let _bioInited = false;
let _bioActiveSeason = 'all';
let _speciesGroupFilter = 'all';
let _speciesStatusFilter = 'all';
let _speciesSortState = { col: 'name', dir: 'asc' };

const POLLEN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const POLLEN_BY_MONTH = {
  1:  { Poaceae:5,  Asteraceae:2, Quercus:1, Betula:3,  Pinus:4,  Other:5  },
  2:  { Poaceae:8,  Asteraceae:3, Quercus:3, Betula:12, Pinus:6,  Other:6  },
  3:  { Poaceae:22, Asteraceae:8, Quercus:15,Betula:28, Pinus:15, Other:10 },
  4:  { Poaceae:48, Asteraceae:22,Quercus:28,Betula:18, Pinus:28, Other:18 },
  5:  { Poaceae:62, Asteraceae:35,Quercus:42,Betula:8,  Pinus:35, Other:22 },
  6:  { Poaceae:58, Asteraceae:48,Quercus:32,Betula:3,  Pinus:22, Other:28 },
  7:  { Poaceae:45, Asteraceae:55,Quercus:18,Betula:2,  Pinus:12, Other:20 },
  8:  { Poaceae:38, Asteraceae:62,Quercus:8, Betula:2,  Pinus:8,  Other:15 },
  9:  { Poaceae:28, Asteraceae:42,Quercus:5, Betula:2,  Pinus:5,  Other:12 },
  10: { Poaceae:15, Asteraceae:22,Quercus:3, Betula:3,  Pinus:4,  Other:8  },
  11: { Poaceae:6,  Asteraceae:8, Quercus:1, Betula:4,  Pinus:3,  Other:5  },
  12: { Poaceae:3,  Asteraceae:3, Quercus:1, Betula:2,  Pinus:2,  Other:3  },
};

function initBioSection() {
  if (_bioInited) return;
  _bioInited = true;

  // KPI sparklines
  drawSparkline('spark-b-richness',  [36,37,38,39,40,41],             '#22c55e');
  drawSparkline('spark-b-shannon',   [3.52,3.60,3.65,3.70,3.76,3.82],'#3b82f6');
  drawSparkline('spark-b-protected', [7,7,8,8,9,9],                   '#a855f7');
  drawSparkline('spark-b-veg',       [44,47,49,52,54,56],             '#f59e0b');
  drawSparkline('spark-b-avian',     [24,25,27,28,30,31],             '#14b8a6');

  // Panels
  renderBirdList();
  renderSpeciesTable();
  renderBioTargets();
  seedBioDiversityChart('all');

  // Pollen slider track fill for initial value (April = 4)
  const pEl = document.getElementById('inp-pollen-month');
  if (pEl) pEl.style.setProperty('--pct', ((4 - 1) / (12 - 1) * 100).toFixed(1) + '%');
  seedPollenChart(4);
}

/* ── EU Biodiversity targets progress bars ── */
function renderBioTargets() {
  const container = document.getElementById('bio-targets-list');
  if (!container) return;

  const targets = [
    { label: 'Protected area coverage', current: 34, goal: 30, color: '#22c55e' },
    { label: 'Pollinator habitat',       current: 61, goal: 80, color: '#f59e0b' },
    { label: 'Species diversity (H′)',   current: 76, goal: 85, color: '#3b82f6' },
    { label: 'Native vegetation cover',  current: 56, goal: 70, color: '#22c55e' },
    { label: 'Invasive species control', current: 48, goal: 75, color: '#ef4444' },
  ];

  container.innerHTML = targets.map(t => {
    const pct  = Math.round((t.current / t.goal) * 100);
    const barW = Math.min(100, t.current);
    const note = pct >= 100 ? '✓ Target met' : `${pct}% of goal`;
    return `
      <div class="bio-target-item">
        <div class="bio-target-header">
          <span class="bio-target-label">${t.label}</span>
          <span class="bio-target-pct">${t.current}% <span style="color:var(--text-3)">/ ${t.goal}%</span></span>
        </div>
        <div class="bio-target-bar-track">
          <div class="bio-target-bar-fill" style="width:${barW}%;background:${t.color};opacity:${pct>=100?1:0.75}"></div>
        </div>
        <span class="bio-target-note" style="color:${pct>=100?'var(--green)':'var(--text-3)'}">${note}</span>
      </div>`;
  }).join('');
}

/* ── Season pill toggle → updates diversity chart ── */
function setBioSeason(season, btn) {
  _bioActiveSeason = season;
  document.querySelectorAll('.bsp-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  seedBioDiversityChart(season);
}

/* ── Diversity chart view toggle (group filter inside chart) ── */
function setBioDiversityView(view, btn) {
  document.querySelectorAll('.bgf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  seedBioDiversityChart(view);
}

function seedBioDiversityChart(season) {
  const chart = window._chartInst?.bioDiversity;
  if (!chart) return;

  const SEASON_DATA = {
    spring: { plants:38, birds:12, insects:28, mammals:3, amphibians:4 },
    summer: { plants:45, birds:18, insects:24, mammals:4, amphibians:3 },
    autumn: { plants:32, birds:11, insects:18, mammals:4, amphibians:2 },
    winter: { plants:14, birds:8,  insects:4,  mammals:5, amphibians:0 },
    all:    { plants:42, birds:15, insects:22, mammals:4, amphibians:3 },
  };
  const groups = ['Plants','Birds','Insects','Mammals','Amphibians'];

  if (season === 'all') {
    chart.data.labels = groups;
    chart.data.datasets = [
      { label: 'Spring', data: [38,12,28,3,4], backgroundColor: 'rgba(34,197,94,0.7)',  borderRadius: 3 },
      { label: 'Summer', data: [45,18,24,4,3], backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 3 },
      { label: 'Autumn', data: [32,11,18,4,2], backgroundColor: 'rgba(245,158,11,0.7)', borderRadius: 3 },
    ];
  } else {
    const COLORS = { spring:'#22c55e', summer:'#3b82f6', autumn:'#f59e0b', winter:'#a855f7' };
    const d = SEASON_DATA[season] || SEASON_DATA.all;
    chart.data.labels = groups;
    chart.data.datasets = [{
      label: season.charAt(0).toUpperCase() + season.slice(1),
      data: [d.plants, d.birds, d.insects, d.mammals, d.amphibians],
      backgroundColor: (COLORS[season] || '#22c55e') + 'bb',
      borderColor: COLORS[season] || '#22c55e',
      borderWidth: 1,
      borderRadius: 3,
    }];
  }
  chart.options.animation = { duration: 400 };
  chart.update('active');
}

/* ── Pollen chart seeding ── */
function seedPollenChart(month) {
  const chart = window._chartInst?.pollen;
  if (!chart) return;
  const d = POLLEN_BY_MONTH[month] || POLLEN_BY_MONTH[4];
  chart.data.labels = Object.keys(d);
  chart.data.datasets[0].data = Object.values(d);
  chart.options.animation = { duration: 350 };
  chart.update('active');
}

function onPollenMonthChange(el) {
  const month = parseInt(el.value);
  el.style.setProperty('--pct', ((month - 1) / 11 * 100).toFixed(1) + '%');
  const dispEl = document.getElementById('disp-pollen-month');
  if (dispEl) dispEl.textContent = POLLEN_MONTHS[month - 1];
  seedPollenChart(month);
}

/* ── Species Explorer ── */
function renderSpeciesTable() {
  const tbody = document.getElementById('species-table-body');
  if (!tbody || typeof SPECIES_DATA === 'undefined') return;

  let data = [...SPECIES_DATA];

  if (_speciesGroupFilter  !== 'all') data = data.filter(s => s.group  === _speciesGroupFilter);
  if (_speciesStatusFilter !== 'all') data = data.filter(s => s.status === _speciesStatusFilter);

  const dir = _speciesSortState.dir === 'asc' ? 1 : -1;
  data.sort((a, b) =>
    _speciesSortState.col === 'count'
      ? (a.count - b.count) * dir
      : (a.name || '').localeCompare(b.name || '') * dir
  );

  const GROUP_EMOJI = { birds:'🐦', plants:'🌿', insects:'🐝', mammals:'🦔', amphibians:'🐸' };

  tbody.innerHTML = data.map(s => {
    const trendColor  = s.trend === '↑' ? 'var(--green)' : s.trend === '↓' ? 'var(--red)' : 'var(--text-3)';
    const statusClass = 'ssb-' + (s.status || 'common');
    const iucnClass   = s.iucn === 'NT' ? 'iucn-nt' : s.iucn === 'LC' ? 'iucn-lc' : '';
    return `<tr>
      <td style="font-weight:600;font-size:11px">${s.name}</td>
      <td style="font-style:italic;font-size:9px;color:var(--text-3)">${s.latin}</td>
      <td>${GROUP_EMOJI[s.group] || ''} <span style="font-size:9px;color:var(--text-3)">${s.group}</span></td>
      <td><span class="species-status-badge ${statusClass}">${(s.status||'').replace(/-/g,'‑')}</span></td>
      <td class="${iucnClass}">${s.iucn || '—'}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-weight:700">${s.count}</td>
      <td style="color:${trendColor};font-weight:700;font-size:13px">${s.trend}</td>
      <td style="font-size:10px;color:var(--text-3)">${s.zone || '—'}</td>
    </tr>`;
  }).join('');
}

function filterSpeciesTable(group, btn, status) {
  if (group !== null && group !== undefined) {
    _speciesGroupFilter = group;
    document.querySelectorAll('.sgt-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
  if (status !== undefined) _speciesStatusFilter = status || 'all';
  renderSpeciesTable();
}

function sortSpeciesTable(col) {
  if (_speciesSortState.col === col) {
    _speciesSortState.dir = _speciesSortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _speciesSortState.col = col;
    _speciesSortState.dir = 'asc';
  }
  document.querySelectorAll('#species-table .sortable-col').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.getAttribute('onclick')?.includes(`'${col}'`)) {
      th.classList.add(_speciesSortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
  renderSpeciesTable();
  showToast(`Sorted by ${col} (${_speciesSortState.dir})`);
}

/* ── AI Biodiversity Insights (inline panel, app.js side) ── */
async function runAIBioInsights() {
  const btn  = document.getElementById('btn-ai-bio-panel');
  const body = document.getElementById('bio-insights-body');
  if (!body) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing…'; }
  body.innerHTML = '<div class="insights-loading"><div class="spinner"></div><span>Analyzing species richness, pollen phenology, and avian monitoring data…</span></div>';

  try {
    let parsed = null;
    if (typeof apiFetch === 'function') {
      const raw = await apiFetch('/ai/biodiversity', { method: 'POST' });
      if (raw && (raw.ecological_assessment || raw.shannon_h != null)) parsed = raw;
    }

    // Build live insights from the biodiversity API response
    let insights, recs;
    if (parsed) {
      const h       = parsed.shannon_h != null ? parsed.shannon_h.toFixed(2) : '3.82';
      const rich    = parsed.species_richness ?? 41;
      const eco     = parsed.ecological_assessment || '';
      const dom     = parsed.dominant_species || [];
      const notes   = parsed.conservation_notes || '';

      insights = [
        {
          icon: '🌿',
          label: 'Ecological Assessment',
          text: eco || `Shannon H′ diversity index: ${h} — ${parseFloat(h) >= 3.5 ? 'high biodiversity' : parseFloat(h) >= 2.5 ? 'moderate biodiversity' : 'low biodiversity'} recorded across ${rich} species. Habitat quality at Tsenovo supports diverse pollinator communities and protected raptor corridors.`
        },
        {
          icon: '🐦',
          label: 'Species Composition',
          text: dom.length
            ? `Dominant species: ${dom.slice(0, 5).join(', ')}. Total richness: ${rich} species recorded via GBIF in Tsenovo municipality. Shannon H′ = ${h} is ${parseFloat(h) > 3.41 ? 'above' : 'below'} the European solar park median of 3.41.`
            : `${rich} species recorded in this monitoring period. European Bee-eater population trending upward in Zone 4; Black Kite sightings require additional monitoring. Poaceae pollen peak coincides with optimal pollinator foraging window.`
        },
        {
          icon: '🐝',
          label: 'Pollinator & Vegetation Health',
          text: 'Native plant cover supports 3 protected pollinator species. Wild Thyme (Thymus serpyllum) colonising Zone 5 bare patches is a positive succession indicator. Honey bee activity indices correlate with Asteraceae bloom timing tracked in pollen data.'
        },
      ];

      recs = notes
        ? notes.split(/\.\s+/).filter(s => s.trim().length > 20).slice(0, 2).map((t, i) => ({
            icon: i === 0 ? '🌱' : '🚫',
            text: t.trim().replace(/\.$/, '') + '.'
          }))
        : [
          { icon: '🌱', text: 'Establish 2–3 ha of wildflower corridors between Zone 3 and Zone 4 to link Bee-eater foraging range with the primary nesting zone along the ridge.' },
          { icon: '🚫', text: 'Introduce targeted mechanical removal of Field Bindweed in Zone 7 before May flowering to prevent seed dispersal across the 8.2 ha western slope.' },
        ];

      // Also update Shannon display in bio KPI strip
      const bkpiShannon = document.getElementById('bkpi-shannon');
      if (bkpiShannon && parsed.shannon_h != null) bkpiShannon.textContent = h;
    } else {
      insights = [
        { icon: '🐦', label: 'Avian Recovery',
          text: 'European Bee-eater population grew 71% over 6 months (7→12 individuals), driven by improved insect biomass in Zone 4. Black Kite sightings declined 60% — likely due to ongoing upper-slope disturbance in Zone 2. Recommend limiting Zone 2 access April–August during nesting season.' },
        { icon: '🌿', label: 'Vegetation Phenology',
          text: 'Native plant cover reached 56% site-wide, up from 44% in October 2025. Wild Thyme (Thymus serpyllum) colonising Zone 5 bare patches is a positive indicator — it supports 3 protected pollinator species. Field Bindweed pressure in Zone 7 remains the primary invasion front.' },
        { icon: '🐝', label: 'Pollinator Health',
          text: 'Honey bee activity indices are at a 2-year high. Pollen data shows Poaceae peak in April–June with an allergen window; however, this coincides with peak pollinator foraging. Shannon H′ = 3.82 is above the European solar park median of 3.41.' },
      ];
      recs = [
        { icon: '🌱', text: 'Establish 2–3 ha of wildflower corridors between Zone 3 and Zone 4 to link the Bee-eater foraging range with the primary nesting zone along the ridge.' },
        { icon: '🚫', text: 'Introduce targeted mechanical removal of Field Bindweed in Zone 7 before May flowering to prevent seed dispersal across the 8.2 ha western slope.' },
      ];
    }

    body.innerHTML = `
      <div class="insights-chips-row">
        ${insights.map(i => `
          <div class="insight-chip">
            <div class="ic-header"><span class="ic-icon">${i.icon}</span><span class="ic-label">${i.label}</span></div>
            <div class="ic-text">${i.text}</div>
          </div>`).join('')}
      </div>
      <div class="insights-recs">
        <div class="insights-recs-label">Conservation Actions</div>
        ${recs.map(r => `
          <div class="insights-rec-row">
            <span class="irr-icon">${r.icon}</span>
            <span class="irr-text">${r.text}</span>
          </div>`).join('')}
      </div>`;
  } catch(e) {
    body.innerHTML = `<div class="insights-empty"><span class="insights-empty-icon">⚠</span><span>Analysis failed: ${e.message}</span></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Insights'; }
  }
}

/* ─── SETTINGS SAVE ─── */
function saveCoords() {
  const lat = document.getElementById('site-lat').value;
  const lon = document.getElementById('site-lon').value;
  showToast(`Coordinates saved: ${lat}°N, ${lon}°E`);
}

/* ─── REPORTS ─── */
function generateReport() {
  showToast('AI Report generation initiated... (demo mode)');
}
function exportReport() {
  showToast('PDF export would download here in production.');
}

/* ─── TOAST ─── */
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:#1a2130;border:1px solid rgba(34,197,94,0.3);
    color:#f0f4f8;font-family:'IBM Plex Sans',sans-serif;font-size:12px;
    padding:10px 16px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);
    animation:fadeIn 0.2s ease-out;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ─── SETTINGS TABS ─── */
function initSettingsTabs() {
  const panels = {
    site:     'settings-site',
    api:      'settings-api',
    hardware: 'settings-hardware',
    upload:   'settings-upload',
    history:  'settings-history',
  };

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show matching panel, hide others
      const target = tab.dataset.tab;
      Object.entries(panels).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = key === target ? '' : 'none';
      });

      // Trigger data load for new tabs
      if (target === 'history' && typeof fetchAndRenderUploadHistory === 'function') {
        fetchAndRenderUploadHistory();
      }
      if (target === 'upload' && typeof loadPhotoHistory === 'function') {
        loadPhotoHistory();
      }
    });
  });
}

/* ─── THEME BUTTONS ─── */
function initThemeButtons() {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

/* ─── FILTER BUTTONS ─── */
function initFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

/* ─── BOOTSTRAP ─── */
document.addEventListener('DOMContentLoaded', () => {
  // Wire nav tabs (header)
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      activateSection(tab.dataset.section);
    });
  });

  // Wire sidebar tabs
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      activateSection(tab.dataset.section);
    });
  });

  initSettingsTabs();
  initThemeButtons();
  initFilterButtons();

  // Init calculator (appears on Carbon section)
  onCalcSlider();

  // Start on dashboard
  initSectionContent('dashboard');
});
