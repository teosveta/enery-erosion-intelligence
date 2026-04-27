/* ═══════════════════════════════════════════════════════
   LEAFLET MAP — Tsenovo Solar Park
═══════════════════════════════════════════════════════ */

let mainMap = null;
let zonesMap = null;
let layersMap = null;
let satelliteMode = false;

const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

let mainTileLayer = null;

function getRiskColor(risk) {
  if (risk === 'high') return '#ef4444';
  if (risk === 'moderate') return '#f59e0b';
  return '#22c55e';
}

function zoneStyle(zone, selected = false) {
  const color = getRiskColor(zone.risk);
  return {
    color: color,
    weight: selected ? 2.5 : 1.5,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: selected ? 0.45 : 0.28
  };
}

function popupHTML(zone) {
  const riskLabel = zone.risk.charAt(0).toUpperCase() + zone.risk.slice(1);
  const riskColor = getRiskColor(zone.risk);
  return `
    <div class="popup-zone-title" style="color:${riskColor}">${zone.name}</div>
    <div class="popup-row"><span class="popup-key">Cluster</span><span class="popup-val">${zone.cluster}</span></div>
    <div class="popup-row"><span class="popup-key">Area</span><span class="popup-val">${zone.area} ha</span></div>
    <div class="popup-row"><span class="popup-key">Risk</span><span class="popup-val" style="color:${riskColor}">${riskLabel} (${zone.riskScore}/100)</span></div>
    <div class="popup-row"><span class="popup-key">NDVI</span><span class="popup-val">${zone.ndvi}</span></div>
    <div class="popup-row"><span class="popup-key">Vegetation</span><span class="popup-val">${zone.vegetation}%</span></div>
    <div class="popup-row"><span class="popup-key">Elevation</span><span class="popup-val">${zone.elevation}</span></div>
    <div style="margin-top:8px;font-size:10px;color:#94a3b8;line-height:1.5">${zone.description}</div>
  `;
}

/* ─── MAIN DASHBOARD MAP ─── */
function initMainMap() {
  const container = document.getElementById('map');
  if (!container || mainMap) return;

  mainMap = L.map('map', {
    center: [43.555, 25.590],
    zoom: 13,
    zoomControl: false,
    attributionControl: false
  });

  mainTileLayer = L.tileLayer(TILE_SATELLITE, { maxZoom: 19 }).addTo(mainMap);

  // Draw all zone polygons
  ZONES.forEach(zone => {
    const poly = L.polygon(zone.polygon, zoneStyle(zone));

    // Zone label
    const center = zone.center;
    const riskEmoji = zone.risk === 'high' ? '🔴' : zone.risk === 'moderate' ? '🟡' : '🟢';
    const label = L.divIcon({
      className: '',
      html: `<div style="
        color:#fff;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;
        text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.8);
        white-space:nowrap;
        pointer-events:none;
      ">Z${zone.id} ${riskEmoji}</div>`,
      iconAnchor: [16, 8]
    });
    L.marker(center, { icon: label }).addTo(mainMap);

    poly.bindPopup(popupHTML(zone), {
      maxWidth: 240,
      className: 'dark-popup'
    });

    poly.on('mouseover', () => {
      poly.setStyle({ fillOpacity: 0.55, weight: 2.5 });
    });
    poly.on('mouseout', () => {
      poly.setStyle(zoneStyle(zone));
    });
    poly.on('click', () => {
      showZoneInfoPanel(zone);
    });

    poly.addTo(mainMap);

    // Smart Pin markers for Zone 3
    if (zone.id === 3) {
      addSmartPinMarkers(mainMap, zone);
    }
  });

  // Map controls
  document.getElementById('map-locate')?.addEventListener('click', () => {
    mainMap.setView([43.555, 25.590], 13);
  });

  document.getElementById('map-satellite')?.addEventListener('click', (e) => {
    satelliteMode = !satelliteMode;
    mainTileLayer.setUrl(satelliteMode ? TILE_OSM : TILE_SATELLITE);
    e.currentTarget.classList.toggle('active', satelliteMode);
  });

  document.getElementById('zone-info-close')?.addEventListener('click', () => {
    document.getElementById('zone-info').style.display = 'none';
  });

  // Zone filter
  document.getElementById('zone-filter')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'all') {
      mainMap.setView([43.555, 25.590], 13);
    } else {
      const zone = ZONES.find(z => z.id === parseInt(val));
      if (zone) mainMap.setView(zone.center, 15);
    }
  });
}

function addSmartPinMarkers(map, zone) {
  const pinLocations = [
    { lat: 43.5559, lng: 25.5906, id: 'P04', status: 'danger' },
    { lat: 43.5551, lng: 25.5896, id: 'P08', status: 'success' },
    { lat: 43.5574, lng: 25.5911, id: 'P15', status: 'warning' },
    { lat: 43.5568, lng: 25.5949, id: 'P11', status: 'danger' }
  ];

  pinLocations.forEach(pin => {
    const colors = { danger: '#ef4444', success: '#22c55e', warning: '#f59e0b' };
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        background:${colors[pin.status]};
        width:20px;height:20px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid rgba(255,255,255,0.8);
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        display:flex;align-items:center;justify-content:center;
      "><span style="transform:rotate(45deg);font-size:9px">📷</span></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 20]
    });

    L.marker([pin.lat, pin.lng], { icon })
      .bindPopup(`<div style="font-family:'IBM Plex Sans',sans-serif;font-size:11px;color:#f0f4f8">
        <strong style="color:${colors[pin.status]}">${pin.id}</strong><br>
        Smart Erosion Pin — Zone 3<br>
        <span style="color:#94a3b8">Last update: Apr 27, 2026 09:35</span>
      </div>`, { className: 'dark-popup', maxWidth: 180 })
      .addTo(map);
  });
}

function showZoneInfoPanel(zone) {
  const panel = document.getElementById('zone-info');
  const title = document.getElementById('zone-info-title');
  const body = document.getElementById('zone-info-body');

  const riskColor = getRiskColor(zone.risk);
  title.style.color = riskColor;
  title.textContent = zone.name;

  body.innerHTML = `
    <div class="zone-info-row"><span class="zone-info-key">Cluster</span><span class="zone-info-val">${zone.cluster}</span></div>
    <div class="zone-info-row"><span class="zone-info-key">Area</span><span class="zone-info-val">${zone.area} ha</span></div>
    <div class="zone-info-row"><span class="zone-info-key">Risk Score</span><span class="zone-info-val" style="color:${riskColor}">${zone.riskScore}/100</span></div>
    <div class="zone-info-row"><span class="zone-info-key">NDVI</span><span class="zone-info-val">${zone.ndvi}</span></div>
    <div class="zone-info-row"><span class="zone-info-key">Vegetation</span><span class="zone-info-val">${zone.vegetation}%</span></div>
    <div class="zone-info-row"><span class="zone-info-key">Elevation</span><span class="zone-info-val">${zone.elevation}</span></div>
    <div style="margin-top:8px;font-size:10px;color:#64748b;line-height:1.5">${zone.description}</div>
  `;

  panel.style.display = 'block';
  mainMap.setView(zone.center, 15);
}

/* ─── ZONES PAGE MAP ─── */
function initZonesMap() {
  const container = document.getElementById('zones-map');
  if (!container || zonesMap) return;

  zonesMap = L.map('zones-map', {
    center: [43.548, 25.590],
    zoom: 12,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer(TILE_SATELLITE, { maxZoom: 19 }).addTo(zonesMap);

  ZONES.forEach(zone => {
    const poly = L.polygon(zone.polygon, zoneStyle(zone))
      .bindPopup(popupHTML(zone), { maxWidth: 240, className: 'dark-popup' })
      .addTo(zonesMap);

    const label = L.divIcon({
      className: '',
      html: `<div style="color:#fff;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,0.9)">Z${zone.id}</div>`,
      iconAnchor: [8, 6]
    });
    L.marker(zone.center, { icon: label }).addTo(zonesMap);

    poly.on('click', () => {
      const items = document.querySelectorAll('.zone-item');
      items.forEach(el => el.classList.remove('active'));
      const target = document.querySelector(`[data-zone-id="${zone.id}"]`);
      if (target) { target.classList.add('active'); target.scrollIntoView({ block: 'nearest' }); }
      zonesMap.setView(zone.center, 15);
    });
  });
}

/* ─── DATA LAYERS MAP ─── */
function initLayersMap() {
  const container = document.getElementById('layers-map');
  if (!container || layersMap) return;

  layersMap = L.map('layers-map', {
    center: [43.555, 25.590],
    zoom: 13,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer(TILE_SATELLITE, { maxZoom: 19 }).addTo(layersMap);

  // Draw NDVI heat-style overlay (simulated)
  ZONES.forEach(zone => {
    const ndviColor = zone.ndvi > 0.6 ? '#22c55e' : zone.ndvi > 0.4 ? '#f59e0b' : '#ef4444';
    L.polygon(zone.polygon, {
      color: ndviColor,
      weight: 1,
      fillColor: ndviColor,
      fillOpacity: 0.5
    }).addTo(layersMap);
  });
}
