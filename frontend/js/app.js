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
        break;
      case 'alerts':
        initAlertsCharts();
        renderAlertsGrid();
        break;
      case 'carbon':
        initCarbonCharts();
        renderCarbonTable();
        break;
      case 'biodiversity':
        initBioCharts();
        renderBirdList();
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
      const records = data.records.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      records.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const carbonStock = parseFloat(row.carbon_stock_t_per_ha) || 0;
        const co2e = carbonStock * 3.67;
        const som  = parseFloat(row.som_percent)   || 0;
        const bd   = parseFloat(row.bulk_density)  || 0;
        const depth = row.depth_cm || 15;
        const date  = row.created_at ? row.created_at.slice(0, 10) : '—';
        const field = row.field_id || row.zone_id ? `Zone ${row.zone_id || 3}` : 'Tsenovo Z3';

        // Change vs. previous record
        let changeHtml = '<span style="color:#64748b">Ref</span>';
        const nextRec = records[idx + 1];
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
  } catch (e) {
    console.warn('[renderCarbonTable] API fetch failed, using static fallback:', e);
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

/* ─── RENDER BIRD LIST ─── */
function renderBirdList() {
  const container = document.getElementById('bird-list');
  if (!container || container.children.length > 0) return;

  BIRD_DATA.forEach(bird => {
    const trendColor = bird.trend === '↑' ? '#22c55e' : bird.trend === '↓' ? '#ef4444' : '#94a3b8';
    const row = document.createElement('div');
    row.className = 'bird-row';
    row.innerHTML = `
      <span style="font-size:16px">🐦</span>
      <div class="bird-name">
        <div style="font-size:11px;font-weight:600;color:#f0f4f8">${bird.name}</div>
        <div style="font-size:9px;font-style:italic;color:#64748b">${bird.species}</div>
      </div>
      <span class="bird-count">${bird.count}</span>
      <span class="bird-trend" style="color:${trendColor}">${bird.trend}</span>
    `;
    container.appendChild(row);
  });
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

/* ─── CARBON CALCULATOR ─── */
function calculateCarbon() {
  const som = parseFloat(document.getElementById('inp-som').value) || 3.5;
  const bd = parseFloat(document.getElementById('inp-bd').value) || 1.34;
  const depth = parseFloat(document.getElementById('inp-depth').value) || 15;

  const oc = som * 0.58;
  const carbonStock = oc * bd * depth * 100 / 1000; // tC/ha
  const co2e = carbonStock * 3.67;

  document.getElementById('carbon-result').innerHTML = `
    OC: ${oc.toFixed(2)}% → <strong>${carbonStock.toFixed(2)} tC/ha</strong> → ${co2e.toFixed(1)} tCO₂/ha
  `;
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

  // Start on dashboard
  initSectionContent('dashboard');
});
