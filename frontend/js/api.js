/**
 * API Client — Erosion Intelligence Platform
 * All calls route through the FastAPI backend at localhost:8000.
 * Falls back to mock data (data.js) when the backend is unreachable.
 */

const API_BASE = 'http://localhost:8000/api';
let _backendOnline = null;   // null = unchecked, true = live, false = offline

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _backendOnline = true;
    return await resp.json();
  } catch {
    _backendOnline = false;
    return null;
  }
}

async function isBackendOnline() {
  if (_backendOnline !== null) return _backendOnline;
  await apiFetch('/health');
  return _backendOnline;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function fetchDashboard() {
  const data = await apiFetch('/dashboard');
  return data || buildMockDashboard();
}

function buildMockDashboard() {
  return {
    overall_risk_score: 74,
    weather: {
      total_precipitation_mm: 42.5,
      max_hourly_precipitation_mm: 18.0,
      avg_temperature_c: 14.2,
      next_rain_date: '2026-04-28',
      next_rain_mm: 14.0,
      rainfall_alerts: [],
    },
    ndvi:       { ndvi_mean: 0.29, ndvi_min: 0.08, ndvi_max: 0.61, source: 'mock' },
    soil:       { clay: 23, silt: 63, sand: 14, soc: 22.8, bdod: 134, phh2o: 7.1 },
    soil_health:{ soil_health_score: 72 },
    latest_pin_analysis: null,
    alerts:     [{ type: 'ndvi', severity: 'high', message: 'NDVI 0.29 below threshold 0.30 — Zone 3 vegetation loss' }],
    alert_count: 1,
  };
}

// ── Zones ─────────────────────────────────────────────────────────────────────

async function fetchZones(siteId = 'tsenovo') {
  const data = await apiFetch(`/zones?site_id=${siteId}`);
  return data || ZONES;
}

async function fetchZone(zoneId) {
  const data = await apiFetch(`/zones/${zoneId}`);
  return data || ZONES.find(z => z.id === zoneId) || null;
}

// ── Weather ───────────────────────────────────────────────────────────────────

async function fetchWeather(lat = 43.5556, lon = 25.5918) {
  const data = await apiFetch(`/weather?lat=${lat}&lon=${lon}&days_back=58`);
  return data || buildMockWeather();
}

async function fetchWeatherAlerts() {
  const data = await apiFetch('/weather/alerts');
  return data || { alerts: [], count: 0 };
}

function buildMockWeather() {
  return {
    summary: {
      total_precipitation_mm: 42.5,
      max_hourly_precipitation_mm: 18.0,
      avg_temperature_c: 14.2,
      next_rain_date: '2026-04-28',
      next_rain_mm: 14.0,
      forecast_days: [],
      rainfall_alerts: [],
    },
    historical: { time: [], precipitation: [], temperature: [], windspeed: [] },
    forecast: {},
  };
}

// ── NDVI / Satellite ──────────────────────────────────────────────────────────

async function fetchNDVI(zoneId = 3) {
  const data = await apiFetch(`/ndvi?zone_id=${zoneId}`);
  return data || { ndvi_mean: 0.29, ndvi_min: 0.08, ndvi_max: 0.61, source: 'mock', history: [] };
}

async function fetchNDVIAllZones() {
  const data = await apiFetch('/ndvi/all-zones');
  if (data) return data;
  const result = {};
  ZONES.forEach(z => { result[z.id] = { ndvi_mean: z.ndvi, source: 'mock' }; });
  return result;
}

// ── Soil ──────────────────────────────────────────────────────────────────────

async function fetchSoil(lat = 43.5556, lon = 25.5918, zoneId = 3) {
  const data = await apiFetch(`/soil?lat=${lat}&lon=${lon}&zone_id=${zoneId}`);
  return data || {
    properties: { clay: 23, silt: 63, sand: 14, soc: 22.8, bdod: 134, phh2o: 7.1 },
    health: { soil_health_score: 72 },
  };
}

// ── Biodiversity ──────────────────────────────────────────────────────────────

async function fetchBiodiversity(lat = 43.5556, lon = 25.5918) {
  const data = await apiFetch(`/biodiversity?lat=${lat}&lon=${lon}`);
  return data || {
    shannon_h: 3.82,
    species_richness: 41,
    total_occurrences: 215,
    group_counts: { birds: 28, insects: 42, plants: 48, mammals: 10, amphibians: 4 },
    source: 'mock',
  };
}

// ── Smart Pin ─────────────────────────────────────────────────────────────────

async function fetchLatestPinAnalysis(pinId = null) {
  const url = pinId ? `/smart-pin/latest-analysis?pin_id=${pinId}` : '/smart-pin/latest-analysis';
  return await apiFetch(url);
}

async function fetchPinHistory(pinId = null, limit = 20) {
  const url = `/smart-pin/history?limit=${limit}${pinId ? `&pin_id=${pinId}` : ''}`;
  return (await apiFetch(url)) || [];
}

async function fetchPinStatus() {
  return (await apiFetch('/smart-pin/status')) || { watcher: { running: false }, pins: [] };
}

async function triggerPinAnalysis() {
  return (await apiFetch('/smart-pin/analyze-now', { method: 'POST' })) || { message: 'Backend unavailable' };
}

// ── Carbon Calculator ─────────────────────────────────────────────────────────

async function calculateCarbonAPI(som, bd, depth, area = 1.0, zone = 3) {
  const data = await apiFetch('/carbon/calculate', {
    method: 'POST',
    body: JSON.stringify({ som_pct: som, bulk_density_g_cm3: bd, depth_cm: depth, area_ha: area, zone }),
  });
  if (data) return data;
  // Local fallback calculation
  const oc    = som * 0.58;
  const stock = oc * bd * depth * 100 / 1000;
  return {
    result: {
      carbon_stock_t_per_ha:  stock.toFixed(2),
      co2_equivalent_t_per_ha: (stock * 3.67).toFixed(2),
    },
    warnings: [],
  };
}

async function fetchCarbonHistory(zone = null) {
  const url  = zone ? `/carbon/history?zone=${zone}` : '/carbon/history';
  return (await apiFetch(url)) || { records: CARBON_TABLE_DATA, trajectory: [] };
}

// ── AI Endpoints ──────────────────────────────────────────────────────────────

async function computeRiskScore(params) {
  return (await apiFetch('/ai/risk-score', { method: 'POST', body: JSON.stringify(params) }))
    || { risk_score: 74, risk_level: 'high', contributing_factors: [], recommended_actions: [] };
}

async function generateESGReport() {
  return (await apiFetch('/ai/report', { method: 'POST' }))
    || { report: { executive_summary: 'Backend unavailable — connect to generate AI report.' } };
}

// ── File Upload ────────────────────────────────────────────────────────────────

async function uploadMonitoringPhoto(file, zone, pinId = 'manual', notes = '') {
  const form = new FormData();
  form.append('file', file);
  form.append('zone', zone);
  form.append('pin_id', pinId);
  form.append('notes', notes);
  try {
    const resp = await fetch(`${API_BASE}/upload/photo`, { method: 'POST', body: form });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    return { message: 'Upload failed — ' + err.message };
  }
}

async function uploadSoilAnalysis(data) {
  return (await apiFetch('/upload/soil', { method: 'POST', body: JSON.stringify(data) }))
    || { message: 'Backend unavailable' };
}

async function uploadSoilCSV(file, zone) {
  const form = new FormData();
  form.append('file', file);
  form.append('zone', zone);
  try {
    const resp = await fetch(`${API_BASE}/upload/soil-csv`, { method: 'POST', body: form });
    return await resp.json();
  } catch (err) {
    return { message: 'CSV upload failed: ' + err.message };
  }
}

async function uploadBirdData(records) {
  return await apiFetch('/upload/birds', { method: 'POST', body: JSON.stringify(records) });
}

async function uploadPollenData(records) {
  return await apiFetch('/upload/pollen', { method: 'POST', body: JSON.stringify(records) });
}

// ── Backend status indicator ───────────────────────────────────────────────────

async function updateBackendStatusUI() {
  const online = await isBackendOnline();
  const el = document.getElementById('backend-status');
  if (el) {
    el.textContent = online ? '🟢 Live' : '🟡 Mock';
    el.title = online ? 'Connected to backend API' : 'Backend offline — showing mock data';
  }
}
