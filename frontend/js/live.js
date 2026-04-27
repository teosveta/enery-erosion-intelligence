/* ═══════════════════════════════════════════════════════════════════════════
   LIVE.JS — Real-time data engine for Erosion Intelligence Platform
   Fetches from FastAPI backend → updates every DOM element on the dashboard
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let _lastDash    = null;   // last dashboard API response
let _lastWeather = null;   // last weather API response
let _refreshTimer = null;
let _countdownTimer = null;
let _refreshInterval = 60; // seconds

// ── Gauge math (correct geometry) ─────────────────────────────────────────────
// Center at (100,121) in SVG viewBox 0 0 200 118, radius=72
// Arc sweeps 270° clockwise from lower-left to lower-right through top

function _gaugeArcData(score) {
  const cx = 100, cy = 121, r = 72;
  const clampedScore = Math.max(0, Math.min(100, score));
  const startAngle   = 225 * Math.PI / 180;
  const sweepAngle   = (clampedScore / 100) * 270 * Math.PI / 180;
  const endAngle     = startAngle - sweepAngle;

  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy - r * Math.sin(startAngle);
  // For score 0 keep dot at start; for >0 calculate end position
  const x2 = clampedScore <= 0 ? x1 : cx + r * Math.cos(endAngle);
  const y2 = clampedScore <= 0 ? y1 : cy - r * Math.sin(endAngle);
  const largeArc = sweepAngle > Math.PI ? 1 : 0;

  // Always return a valid path — use a hair-thin arc at score 0 so we can
  // immediately clear the hardcoded HTML path before the animation begins.
  const path = clampedScore <= 0
    ? `M ${x1.toFixed(1)},${y1.toFixed(1)} A ${r},${r} 0 0 1 ${(x1 + 0.01).toFixed(2)},${y1.toFixed(1)}`
    : `M ${x1.toFixed(1)},${y1.toFixed(1)} A ${r},${r} 0 ${largeArc} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;

  return { path, dotX: x2, dotY: y2, score: clampedScore };
}

function updateGauge(targetScore) {
  const fillEl   = document.getElementById('gauge-fill');
  const dotEl    = document.getElementById('gauge-dot');
  const dotInner = document.getElementById('gauge-dot-inner');
  const numEl    = document.getElementById('gauge-number');
  const labelEl  = document.getElementById('gauge-risk-label');
  if (!fillEl) return;

  const color = targetScore >= 70 ? '#ef4444' : targetScore >= 40 ? '#f59e0b' : '#22c55e';
  const level = targetScore >= 70 ? 'High' : targetScore >= 40 ? 'Moderate' : 'Low';

  // Detect first render (HTML placeholder "—" not yet replaced with a number)
  const rawText       = numEl?.textContent;
  const isFirstRender = !rawText || rawText === '—';

  // On first render, immediately snap the fill + dots to the zero position so
  // the hardcoded HTML arc (which sits at ~75%) is cleared before animating.
  if (isFirstRender) {
    const zero = _gaugeArcData(0);
    fillEl.setAttribute('d', zero.path);
    fillEl.setAttribute('stroke', color);
    if (dotEl)    { dotEl.setAttribute('cx', zero.dotX.toFixed(1));    dotEl.setAttribute('cy', zero.dotY.toFixed(1));    dotEl.setAttribute('fill', color); }
    if (dotInner) { dotInner.setAttribute('cx', zero.dotX.toFixed(1)); dotInner.setAttribute('cy', zero.dotY.toFixed(1)); }
    if (numEl) numEl.textContent = '0';
  }

  const startVal  = isFirstRender ? 0 : (parseInt(rawText) || 0);
  const startTime = performance.now();
  const dur       = 1200; // ms

  function step(now) {
    const t    = Math.min((now - startTime) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
    const val  = Math.round(startVal + (targetScore - startVal) * ease);
    const data = _gaugeArcData(val);

    // path is always a valid string now — no null check needed
    fillEl.setAttribute('d', data.path);
    fillEl.setAttribute('stroke', color);
    if (dotEl)    { dotEl.setAttribute('cx', data.dotX.toFixed(1));    dotEl.setAttribute('cy', data.dotY.toFixed(1));    dotEl.setAttribute('fill', color); }
    if (dotInner) { dotInner.setAttribute('cx', data.dotX.toFixed(1)); dotInner.setAttribute('cy', data.dotY.toFixed(1)); }
    if (numEl)    numEl.textContent = val;
    if (labelEl) {
      labelEl.textContent = level;
      labelEl.className   = 'gauge-risk-label risk-' + (targetScore >= 70 ? 'high' : targetScore >= 40 ? 'moderate' : 'low');
    }

    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Shannon H′ arc animation ───────────────────────────────────────────────────
// Semi-circle: left=15,80 → right, sweeping through top. H' max = 5.
function _shannonArcPath(fraction) {
  const cx = 70, cy = 80, r = 55;
  if (fraction <= 0.001) return 'M 15,80 A 55,55 0 0 1 15.01,80';
  const endAngle = Math.PI - fraction * Math.PI; // 180° → 0° as fraction 0→1
  const ex = cx + r * Math.cos(endAngle);
  const ey = cy - r * Math.sin(endAngle);
  return `M 15,80 A 55,55 0 ${fraction > 0.5 ? 1 : 0} 1 ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

function _animateShannonArc(arcEl, targetFraction, valueEl) {
  // Snap to zero first so we don't see a leftover stale arc during reveal
  arcEl.setAttribute('d', _shannonArcPath(0));

  const dur   = 1000; // ms
  const start = performance.now();

  (function step(now) {
    const t    = Math.min((now - start) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    arcEl.setAttribute('d', _shannonArcPath(ease * targetFraction));
    // Sync the text value alongside the arc
    if (valueEl) valueEl.textContent = (ease * targetFraction * 5).toFixed(2);
    if (t < 1) requestAnimationFrame(step);
  })(performance.now());
}

// ── Animated number counter ───────────────────────────────────────────────────
function animateNumber(el, to, decimals = 0, prefix = '', suffix = '') {
  if (!el) return;
  const from     = parseFloat(el.dataset.val || '0') || 0;
  el.dataset.val = to;
  const dur      = 900;
  const start    = performance.now();

  (function step(now) {
    const t   = Math.min((now - start) / dur, 1);
    const val = from + (to - from) * (1 - Math.pow(1 - t, 3));
    el.textContent = prefix + val.toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(step);
  })(performance.now());
}

// ── Flash a card to indicate new data ────────────────────────────────────────
function flashCard(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.add('data-flash');
  setTimeout(() => el.classList.remove('data-flash'), 800);
}

function flashAll() {
  document.querySelectorAll('.card').forEach(el => {
    el.classList.add('data-flash');
    setTimeout(() => el.classList.remove('data-flash'), 800);
  });
}

// ── Weather card update ───────────────────────────────────────────────────────
function updateWeatherCard(summary) {
  // ── Always stamp today's real date (never stale) ──────────────────────────
  const now   = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayLabel = now.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const todayBadge = document.getElementById('weather-today-date');
  if (todayBadge) todayBadge.textContent = todayLabel;

  if (!summary) {
    // No API data yet — at least the date badge is correct
    return;
  }

  const forecastDays = summary.forecast_days || [];
  const nextRainDate = summary.next_rain_date;
  const nextRainMm   = summary.next_rain_mm;
  const totalMm      = summary.total_precipitation_mm;
  const avgTemp      = summary.avg_temperature_c;

  // ── Today's conditions: pull from forecast_days[0] if it matches today ────
  let todayPrecip = null;
  let todayTemp   = null;
  if (forecastDays.length > 0) {
    const [d0, p0] = forecastDays[0];
    if (d0) {
      const fd0 = new Date(d0); fd0.setHours(0, 0, 0, 0);
      if (fd0.getTime() === today.getTime()) {
        todayPrecip = p0 ?? 0;
      }
    }
  }
  // Fallback temp from historical avg
  todayTemp = avgTemp;

  // Conditions icon + label
  const precipVal = todayPrecip ?? 0;
  let condIcon  = '☀️';
  let condLabel = 'Dry / Clear';
  if      (precipVal > 15) { condIcon = '⛈️';  condLabel = 'Heavy rain expected'; }
  else if (precipVal > 5)  { condIcon = '🌧️';  condLabel = 'Rain expected'; }
  else if (precipVal > 1)  { condIcon = '🌦️';  condLabel = 'Light showers'; }
  else if (precipVal > 0)  { condIcon = '🌥️';  condLabel = 'Overcast'; }

  const iconEl  = document.getElementById('weather-cond-icon');
  const tempEl  = document.getElementById('weather-temp');
  const condLbl = document.getElementById('weather-cond-label');
  const precipEl = document.getElementById('weather-precip-today');
  if (iconEl)   iconEl.textContent   = condIcon;
  if (tempEl)   tempEl.textContent   = todayTemp != null ? todayTemp.toFixed(1) : '—';
  if (condLbl)  condLbl.textContent  = condLabel;
  if (precipEl) precipEl.textContent = todayPrecip != null ? todayPrecip.toFixed(1) + ' mm' : '— mm';

  // ── Next rain row — guard against past/stale dates ────────────────────────
  const nrDateEl = document.getElementById('weather-next-rain-date');
  const nrMmEl   = document.getElementById('weather-next-rain-mm');
  if (nrDateEl) {
    if (nextRainDate) {
      const d = new Date(nextRainDate); d.setHours(0, 0, 0, 0);
      if (d.getTime() === today.getTime()) {
        nrDateEl.textContent = 'Today';
        nrDateEl.style.color = '#ef4444';
      } else if (d > today) {
        nrDateEl.textContent = d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
        nrDateEl.style.color = '#60a5fa';
      } else {
        // Stale — date is in the past
        nrDateEl.textContent = 'No rain in 4-day forecast';
        nrDateEl.style.color = 'var(--text-3)';
      }
    } else {
      nrDateEl.textContent = 'No rain in 4-day forecast';
      nrDateEl.style.color = 'var(--text-3)';
    }
  }
  if (nrMmEl) {
    const d = nextRainDate ? new Date(nextRainDate) : null;
    const valid = d && d >= today;
    nrMmEl.textContent = (valid && nextRainMm) ? nextRainMm.toFixed(1) + ' mm' : '';
  }

  // ── Forecast strip ────────────────────────────────────────────────────────
  updateForecastDots(forecastDays);
  flashCard('.weather-card');
}

function updateForecastDots(forecastDays) {
  const container = document.getElementById('weather-forecast-strip') || document.querySelector('.weather-dots');
  if (!container || forecastDays.length === 0) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  container.innerHTML = forecastDays.slice(0, 4).map(([dateStr, mm]) => {
    const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
    const isToday = d.getTime() === today.getTime();
    const label = isToday ? 'Today' : d.toLocaleDateString('en', { weekday: 'short' });
    const precipMm = mm ?? 0;
    const icon = precipMm > 15 ? '⛈️' : precipMm > 5 ? '🌧️' : precipMm > 1 ? '🌦️' : precipMm > 0 ? '🌥️' : '☀️';
    const cls  = precipMm > 10 ? 'fc-heavy' : precipMm > 3 ? 'fc-mod' : 'fc-dry';
    const todayCls = isToday ? ' fc-today' : '';
    return `<div class="fc-day ${cls}${todayCls}">
      <span class="fc-icon">${icon}</span>
      <span class="fc-label">${label}</span>
      <span class="fc-mm">${precipMm.toFixed(0)}mm</span>
    </div>`;
  }).join('');
}

// ── Update alert pills ────────────────────────────────────────────────────────
function updateAlertPills(alerts) {
  const criticalCount = alerts.filter(a => a.severity === 'high' || a.severity === 'critical').length;
  const moderateCount = alerts.filter(a => a.severity === 'moderate' || a.severity === 'warning').length;

  document.querySelectorAll('.alert-pill').forEach(el => el.remove());

  const row = document.querySelector('.active-alerts-row');
  if (!row) return;

  const pillContainer = row.querySelector('.alert-pills') || (() => {
    const d = document.createElement('div');
    d.className = 'alert-pills';
    row.appendChild(d);
    return d;
  })();

  pillContainer.innerHTML = `
    <div class="alert-pill danger">
      <span class="pill-num">${criticalCount}</span>
      <span class="pill-txt">High Risk</span>
    </div>
    <div class="alert-pill warning">
      <span class="pill-num">${moderateCount}</span>
      <span class="pill-txt">Moderate</span>
    </div>
  `;

  // Header badge
  const badge = document.querySelector('.notif-badge');
  if (badge) {
    const total = alerts.length;
    badge.textContent = total || '';
    badge.style.display = total > 0 ? '' : 'none';
  }
}

// ── Update soil info card ─────────────────────────────────────────────────────
function updateSoilCard(soil, health) {
  let soilInfo = document.getElementById('live-soil-info');
  if (!soilInfo) {
    const carbonCard = document.querySelector('.carbon-card');
    if (!carbonCard) return;
    soilInfo = document.createElement('div');
    soilInfo.id = 'live-soil-info';
    soilInfo.className = 'live-soil-info';
    carbonCard.appendChild(soilInfo);
  }

  const score = health?.soil_health_score ?? '—';
  const clay  = soil?.clay != null ? (soil.clay / 10).toFixed(0) : '—';   // tenths of % → %
  const silt  = soil?.silt != null ? (soil.silt / 10).toFixed(0) : '—';
  const sand  = soil?.sand != null ? (soil.sand / 10).toFixed(0) : '—';
  const ph    = soil?.phh2o != null ? (soil.phh2o / 10).toFixed(1) : '—';
  const soc   = soil?.soc  != null ? (soil.soc / 10).toFixed(1) : '—';

  soilInfo.innerHTML = `
    <div class="soil-score-row">
      <span class="soil-score-label">Soil Health</span>
      <span class="soil-score-val ${score >= 70 ? 'success-text' : score >= 40 ? 'warning-text' : 'danger-text'}">${score}/100</span>
    </div>
    <div class="soil-mini-grid">
      <div class="soil-mini"><span>Clay</span><span>${clay}%</span></div>
      <div class="soil-mini"><span>Silt</span><span>${silt}%</span></div>
      <div class="soil-mini"><span>Sand</span><span>${sand}%</span></div>
      <div class="soil-mini"><span>SOC</span><span>${soc}‰</span></div>
      <div class="soil-mini"><span>pH</span><span>${ph}</span></div>
    </div>
  `;
}

// ── Update NDVI live badge ─────────────────────────────────────────────────────
function updateNdviBadge(ndvi) {
  let badge = document.getElementById('ndvi-live-badge');
  if (!badge) {
    const card = document.querySelector('.ndvi-card');
    if (!card) return;
    badge = document.createElement('div');
    badge.id = 'ndvi-live-badge';
    badge.className = 'ndvi-live-badge';
    card.querySelector('.card-header-row')?.appendChild(badge);
  }
  const val = ndvi?.ndvi_mean;
  const src = ndvi?.source || '';
  const isLive = src !== 'mock' && src !== 'unavailable' && val != null;

  badge.innerHTML = isLive
    ? `<span class="live-dot"></span> NDVI Z3: <strong>${val.toFixed(3)}</strong>`
    : `<span class="mock-dot"></span> NDVI: <span style="color:var(--text-3)">${val != null ? val.toFixed(3) : '—'}</span>`;
}

// ── Update Smart Pin cards ────────────────────────────────────────────────────
function updatePinCards(latestAnalysis, pins) {
  if (!latestAnalysis) return;

  const pinId   = latestAnalysis.pin_id || 'P04';
  const veg     = latestAnalysis.vegetation_cover_percent;
  const sev     = latestAnalysis.erosion_severity;
  const conf    = latestAnalysis.confidence;
  const capAt   = latestAnalysis.captured_at;

  // Inject a "latest analysis" chip on the matching pin card
  document.querySelectorAll('.pin-thumb').forEach(el => {
    const label = el.querySelector('.pin-label');
    if (label && label.textContent.startsWith(pinId)) {
      const existing = el.querySelector('.pin-live-chip');
      if (!existing) {
        const chip = document.createElement('div');
        chip.className = 'pin-live-chip';
        el.appendChild(chip);
      }
      const chip = el.querySelector('.pin-live-chip');
      const sevColor = sev === 'severe' || sev === 'high' ? '#ef4444' : sev === 'moderate' ? '#f59e0b' : '#22c55e';
      chip.innerHTML = `
        <span style="color:${sevColor}">${sev || '—'}</span> ·
        veg ${veg != null ? veg + '%' : '—'} ·
        conf ${conf != null ? (conf * 100).toFixed(0) + '%' : '—'}
      `;
    }
  });
}

// ── Update live ticker bar ────────────────────────────────────────────────────
function updateTicker(dash, weather) {
  const ticker = document.getElementById('live-ticker-content');
  if (!ticker) return;

  const now     = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const wsum    = dash?.weather || {};
  const ndvi    = dash?.ndvi || {};
  const soil    = dash?.soil || {};
  const risk    = dash?.overall_risk_score;
  const timelapse = '';

  const items = [
    `⏱ LAST UPDATE: ${now}`,
    risk != null ? `⚠ EROSION RISK: ${risk}/100` : null,
    wsum.total_precipitation_mm != null ? `🌧 PRECIP 58d: ${wsum.total_precipitation_mm.toFixed(0)}mm` : null,
    wsum.avg_temperature_c != null ? `🌡 AVG TEMP: ${wsum.avg_temperature_c.toFixed(1)}°C` : null,
    wsum.next_rain_date ? `🌂 NEXT RAIN: ${wsum.next_rain_date} (${wsum.next_rain_mm?.toFixed(1) || '?'}mm)` : null,
    ndvi.ndvi_mean != null ? `🛰 NDVI Z3: ${ndvi.ndvi_mean.toFixed(3)}` : null,
    soil.phh2o != null ? `🌱 SOIL pH: ${(soil.phh2o/10).toFixed(1)}` : null,
    soil.soc != null ? `⚗ SOC: ${(soil.soc/10).toFixed(1)}‰` : null,
    `📍 SITE: Tsenovo Solar Park · 147.19 ha · 63.01 MWp`,
    `📡 SMART PINS: 7 ACTIVE · 1 OFFLINE`,
    `🔄 AUTO-REFRESH: ${_refreshInterval}s`,
  ].filter(Boolean);

  // Repeat for seamless scroll
  const text = items.join('   ·   ') + '   ·   ' + items.join('   ·   ');
  ticker.textContent = text;
}

// ── Update alerts in the dashboard alerts bar ─────────────────────────────────
function updateAlertsBar(alerts, weather) {
  const list = document.getElementById('dashboard-alerts-list') || document.querySelector('.alerts-list');
  if (!list) return;

  const rows = [];
  const today = new Date();

  // Weather alerts from API
  (weather?.summary?.rainfall_alerts || []).forEach(a => {
    const d = a.date ? new Date(a.date) : today;
    rows.push({
      date: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      icon: '💧',
      text: `High Rainfall Event (${a.hourly_precipitation_mm?.toFixed(0) || '?'}mm/hr) — Zone 3 erosion risk elevated`,
      tag: 'Z3',
      cls: 'danger'
    });
  });

  // NDVI / system alerts from dashboard API
  (alerts || []).forEach(a => {
    const icon = a.type === 'ndvi' ? '🌿' : a.type === 'rainfall' ? '💧' : '⚠️';
    rows.push({
      date: today.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      icon,
      text: a.message,
      tag: a.zone || 'Z3',
      cls: a.severity === 'high' ? 'danger' : 'warning'
    });
  });

  // If no live alerts from API, fall back to ALERTS_DATA (curated static alerts)
  if (rows.length === 0 && typeof ALERTS_DATA !== 'undefined') {
    ALERTS_DATA.slice(0, 4).forEach(a => {
      rows.push({
        date: a.date || today.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        icon: a.severity === 'critical' ? '⚠️' : a.title.toLowerCase().includes('rain') ? '💧' : '🌿',
        text: a.title + ' — ' + a.description.slice(0, 80) + (a.description.length > 80 ? '…' : ''),
        tag: a.zone,
        cls: a.severity === 'critical' ? 'danger' : 'warning'
      });
    });
  }

  // Always replace content (never leave "Loading…" or old static rows)
  if (rows.length === 0) {
    list.innerHTML = '<div class="alert-row-empty" style="color:var(--text-3);font-size:11px;padding:10px 14px">No active alerts</div>';
    return;
  }

  list.innerHTML = rows.slice(0, 4).map(r => `
    <div class="alert-row ${r.cls}-border">
      <span class="alert-date">${r.date}</span>
      <span class="alert-icon">${r.icon}</span>
      <span class="alert-text">${r.text}</span>
      <span class="alert-tag ${r.cls}">${r.tag}</span>
    </div>
  `).join('');
}

// ── Update map timestamp ──────────────────────────────────────────────────────
function updateMapTimestamp() {
  const el = document.getElementById('map-timestamp-label') || document.querySelector('.map-timestamp');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' · ' + now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  }
}

// ── Update status indicator ───────────────────────────────────────────────────
function setStatus(online) {
  const el = document.getElementById('backend-status');
  if (!el) return;
  if (online) {
    el.innerHTML = `<span class="live-dot"></span> LIVE`;
    el.style.color = '#22c55e';
  } else {
    el.innerHTML = `<span class="mock-dot"></span> MOCK DATA`;
    el.style.color = '#f59e0b';
  }
}

// ── Countdown to next refresh ─────────────────────────────────────────────────
function startCountdown(seconds) {
  clearInterval(_countdownTimer);
  let remaining = seconds;

  const el = document.getElementById('refresh-countdown');
  if (el) el.textContent = remaining + 's';

  _countdownTimer = setInterval(() => {
    remaining--;
    if (el) el.textContent = remaining + 's';
    if (remaining <= 0) clearInterval(_countdownTimer);
  }, 1000);
}

// ── Main fetch & render ───────────────────────────────────────────────────────
async function fetchAndRender() {
  try {
    // Check health first
    const health = await apiFetch('/health');
    const online = health !== null;
    setStatus(online);

    // Parallel fetch
    const [dash, weather] = await Promise.all([
      fetchDashboard(),
      fetchWeather()
    ]);

    _lastDash    = dash;
    _lastWeather = weather;

    // ── Apply to dashboard ──────────────────────────────────────────────
    if (dash) {
      // Risk gauge
      if (dash.overall_risk_score != null) {
        updateGauge(dash.overall_risk_score);
        flashCard('.risk-card');
      }

      // Overall status text
      const statusEl = document.querySelector('.status-value');
      if (statusEl && dash.overall_risk_score != null) {
        const s = dash.overall_risk_score;
        statusEl.textContent = s >= 70 ? 'Critical Attention' : s >= 40 ? 'Needs Attention' : 'Stable';
        statusEl.className = 'status-value ' + (s >= 70 ? 'danger' : s >= 40 ? 'warning' : 'success');
      }

      // Weather
      if (dash.weather) updateWeatherCard(dash.weather);

      // NDVI badge
      if (dash.ndvi) updateNdviBadge(dash.ndvi);

      // Soil
      if (dash.soil || dash.soil_health) updateSoilCard(dash.soil, dash.soil_health);

      // Alerts
      updateAlertPills(dash.alerts || []);
      updateAlertsBar(dash.alerts || [], weather);
      updateAlertsTotalBadge(dash.alerts);

      // Pin analysis
      if (dash.latest_pin_analysis) {
        updatePinCards(dash.latest_pin_analysis, []);
      }

      // Vegetation — populate charts and avg from static ZONES data immediately,
      // then any live overrides from the API will come later.
      updateVegCoverFromZones(ZONES);

      // Report table
      updateReportTable();
    }

    // Weather data (may come with richer data)
    if (weather?.summary) updateWeatherCard(weather.summary);

    // Update timestamp
    updateMapTimestamp();
    updateTicker(dash, weather);

    // Flash live indicator
    const liveEl = document.getElementById('last-updated');
    if (liveEl) {
      const now = new Date();
      liveEl.textContent = 'Updated ' + now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

  } catch (err) {
    console.error('[live] fetch error:', err);
    setStatus(false);
  }

  startCountdown(_refreshInterval);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE VALUE UPDATERS — populate index.html placeholders from real API data
// ═══════════════════════════════════════════════════════════════════════════════

// ── Carbon KPIs, trajectory chart, soil carbon sparkline ─────────────────────
async function fetchAndUpdateCarbonKPIs() {
  try {
    const data = await apiFetch('/carbon/history');
    if (!data || !data.records || data.records.length === 0) return;

    // DB stores records with field: timestamp / som_pct / bulk_density_g_cm3
    const records = data.records.slice().sort((a, b) =>
      (a.timestamp || a.created_at || '').localeCompare(b.timestamp || b.created_at || ''));
    const latest = records[records.length - 1];
    if (!latest) return;

    const carbonStock = parseFloat(latest.carbon_stock_t_per_ha) || 0;
    const co2e = carbonStock * 3.67;
    const som  = parseFloat(latest.som_pct ?? latest.som_percent) || 0;

    // KPI value spans
    const stockEl = document.getElementById('kpi-carbon-stock');
    const co2eEl  = document.getElementById('kpi-co2e');
    const somEl   = document.getElementById('kpi-som');
    if (stockEl) animateNumber(stockEl, carbonStock, 2);
    if (co2eEl)  animateNumber(co2eEl, co2e, 2);
    if (somEl)   somEl.textContent = som.toFixed(1) + '%';

    // YoY delta
    if (records.length >= 2) {
      const oldest   = records[0];
      const oldStock = parseFloat(oldest.carbon_stock_t_per_ha) || carbonStock;
      const pct      = oldStock > 0 ? ((carbonStock - oldStock) / oldStock * 100) : 0;
      ['kpi-carbon-stock-delta', 'kpi-co2e-delta'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% since first record';
        el.className   = 'kpi-delta ' + (pct >= 0 ? 'up' : 'down');
      });
      const somRange  = document.getElementById('kpi-som-range');
      const soms      = records.map(r => parseFloat(r.som_pct ?? r.som_percent)).filter(Boolean);
      if (somRange && soms.length >= 2) {
        somRange.textContent = Math.min(...soms).toFixed(1) + '% – ' + Math.max(...soms).toFixed(1) + '%';
      }
    }

    // Key Metrics panel
    // sequestration_rate is an object: { annual_sequestration_t_per_ha, total_change_t_per_ha, ... }
    const seqRateObj = data.sequestration_rate;
    const seqRate    = seqRateObj?.annual_sequestration_t_per_ha ?? null;
    const soilScore = _lastDash?.soil_health?.soil_health_score;
    _setInner('metric-org-carbon',  carbonStock.toFixed(2) + ' tC/ha');
    _setInner('metric-co2-stored',  co2e.toFixed(2) + ' tCO₂/ha');
    if (seqRate != null) _setInner('metric-annual-seq', seqRate.toFixed(2) + ' tC/ha/yr');
    if (soilScore != null) {
      const msEl = document.getElementById('metric-soil-health');
      if (msEl) {
        msEl.textContent = soilScore + '/100';
        msEl.className   = 'metric-val ' + (soilScore >= 70 ? 'success-text' : soilScore >= 40 ? 'warning-text' : 'danger-text');
      }
    }

    // Carbon zone tags (soil carbon card, dashboard)
    const tag1 = document.getElementById('carbon-tag-1');
    const tag2 = document.getElementById('carbon-tag-2');
    if (tag1 && som > 0) {
      tag1.style.color = '';
      tag1.innerHTML = som < 3
        ? `Z3: <span class="text-warning">Low SOM</span>`
        : `SOM: <span class="text-success">${som.toFixed(1)}%</span>`;
    }
    const soil = _lastDash?.soil;
    if (tag2 && soil?.clay != null) {
      const clayPct = (soil.clay / 10).toFixed(0);
      tag2.style.color = '';
      tag2.innerHTML = clayPct > 30
        ? `Clay: <span class="text-danger">${clayPct}%</span>`
        : `Clay: <span>${clayPct}%</span>`;
    }

    // Carbon trajectory chart — fill actual + projected bands
    const tChart = window._chartInst?.carbonTrajectory;
    if (tChart && records.length > 0) {
      const byYear = {};
      records.forEach(r => {
        const dateStr = r.timestamp || r.created_at || '';
        const yr = dateStr.slice(0, 4);
        if (yr) byYear[yr] = parseFloat(r.carbon_stock_t_per_ha) || 0;
      });
      const allYears = ['2020','2021','2022','2023','2024','2025','2026','2027','2028','2029','2030'];
      const actualData = allYears.map(y => byYear[y] ?? null);
      const lastKnownYr  = Object.keys(byYear).sort().pop();
      const lastKnownVal = byYear[lastKnownYr] || carbonStock;
      const lastIdx      = allYears.indexOf(lastKnownYr);
      const rate         = seqRate != null ? seqRate : 0.3;  // tC/ha/yr
      const bauData    = allYears.map((_, i) => i < lastIdx ? null : parseFloat((lastKnownVal + rate * (i - lastIdx)).toFixed(1)));
      const targetData = allYears.map((_, i) => i < lastIdx ? null : parseFloat((lastKnownVal + rate * 1.5 * (i - lastIdx)).toFixed(1)));
      tChart.data.datasets[0].data = actualData;
      tChart.data.datasets[1].data = bauData;
      tChart.data.datasets[2].data = targetData;
      tChart.update('none');
    }

    // Analytics carbon chart
    const aChart = window._chartInst?.analyticsCarbon;
    if (aChart && records.length > 0) {
      const recs = records.slice(-8);
      aChart.data.labels = recs.map(r => (r.timestamp || r.created_at || '—').slice(0, 7));
      aChart.data.datasets[0].data = recs.map(r => parseFloat(r.carbon_stock_t_per_ha) || 0);
      aChart.data.datasets[1].data = recs.map(r => (parseFloat(r.carbon_stock_t_per_ha) || 0) * 3.67 / 4);
      aChart.data.datasets[2].data = recs.map(() => parseFloat((carbonStock * 1.1).toFixed(1)));
      aChart.update('none');
    }

    // Soil carbon sparkline (dashboard right panel)
    const scChart = window._chartInst?.soilCarbon;
    if (scChart && records.length > 0) {
      const recs = records.slice(-11);
      scChart.data.labels   = recs.map(r => (r.timestamp || r.created_at || '').slice(0, 7));
      scChart.data.datasets[0].data = recs.map(r => parseFloat(r.carbon_stock_t_per_ha) || 0);
      scChart.update('none');
    }

  } catch (e) { console.warn('[live] carbon KPIs error:', e); }
}

// ── Vegetation average, legend, bar chart ─────────────────────────────────────
function updateVegCoverFromZones(zones) {
  if (!zones || zones.length === 0) return;
  const vegVals = zones.map(z => z.vegetation ?? z.vegetation_cover_pct ?? 0).filter(v => v > 0);
  if (vegVals.length === 0) return;

  const avg = Math.round(vegVals.reduce((a, v) => a + v, 0) / vegVals.length);
  const avgEl = document.getElementById('veg-avg-pct');
  if (avgEl) avgEl.textContent = avg + '%';

  const sorted   = [...zones].sort((a, b) => (b.vegetation ?? 0) - (a.vegetation ?? 0));
  const best     = sorted[0];
  const worst    = sorted[sorted.length - 1];
  const bestEl   = document.getElementById('veg-best-zone');
  const worstEl  = document.getElementById('veg-worst-zone');
  if (bestEl  && best)  bestEl.textContent  = `Z${best.id}: ${best.vegetation ?? '—'}%`;
  if (worstEl && worst) worstEl.textContent = `Z${worst.id}: ${worst.vegetation ?? '—'}%`;

  // Veg cover bar chart
  const chart = window._chartInst?.vegCover;
  if (chart) {
    const colors = zones.map(z => {
      const v = z.vegetation ?? 0;
      return v < 30 ? '#ef4444' : v < 50 ? '#f59e0b' : '#22c55e';
    });
    chart.data.labels = zones.map(z => `Z${z.id}`);
    chart.data.datasets[0].data = zones.map(z => z.vegetation ?? 0);
    chart.data.datasets[0].backgroundColor = colors.map(c => c + 'bb');
    chart.data.datasets[0].borderColor = colors;
    chart.update('none');
  }

  // NDVI trend chart — populate from static fallback data
  const ndviChart = window._chartInst?.ndviTrend;
  if (ndviChart && typeof NDVI_TREND !== 'undefined' && NDVI_TREND.z2?.length > 0) {
    ndviChart.data.labels = NDVI_TREND.labels;
    ndviChart.data.datasets[0].data = NDVI_TREND.z2;
    ndviChart.data.datasets[1].data = NDVI_TREND.z3;
    ndviChart.update('none');
  }
}

// ── Biodiversity KPIs — Shannon, species counts, overview, bio radar ──────────
async function fetchAndUpdateBiodiversityKPIs() {
  try {
    const [bioData, speciesData] = await Promise.all([
      apiFetch('/biodiversity'),
      apiFetch('/biodiversity/species')
    ]);
    const bio = bioData || {};
    const h   = bio.shannon_h ?? bio.h_prime;

    // Shannon arc fill + value counter — animated together
    const arcEl = document.getElementById('shannon-arc-fill');
    if (arcEl && h != null) {
      const targetFraction = Math.min(Math.max(h / 5, 0), 1);
      _animateShannonArc(arcEl, targetFraction, document.getElementById('shannon-value'));
    }

    // Shannon trend label
    const trendEl = document.getElementById('shannon-trend');
    if (trendEl && h != null) {
      const prev = 3.70;
      const diff = (h - prev).toFixed(2);
      trendEl.textContent = (h >= prev ? '↑ +' : '↓ ') + diff + ' vs. last year';
      trendEl.style.color = h >= prev ? 'var(--green)' : 'var(--red, #ef4444)';
    }

    // Species counts
    const richness = bio.species_richness ?? speciesData?.count ?? null;
    const speciesEl   = document.getElementById('species-total');
    const missingEl   = document.getElementById('species-missing');
    const totalSpecEl = document.getElementById('bio-total-species');
    if (richness != null) {
      if (speciesEl)   speciesEl.textContent   = richness;
      if (totalSpecEl) totalSpecEl.textContent = richness;
      if (missingEl) {
        const missing = Math.max(0, 50 - richness);
        missingEl.textContent = missing;
        missingEl.className = 'species-num ' + (missing > 10 ? 'warning-text' : 'success-text');
      }
    }

    // Regional overview
    const invasiveEl = document.getElementById('bio-invasive-risk');
    const keystoneEl = document.getElementById('bio-keystone');
    if (invasiveEl) {
      const risk = bio.invasive_species_risk;
      if (risk != null) {
        invasiveEl.textContent = (risk < 0.1 ? 'Low ' : risk < 0.3 ? 'Moderate ' : 'High ') + '(' + (risk * 100).toFixed(0) + '%)';
        invasiveEl.className = 'bio-big-num ' + (risk < 0.1 ? 'success-text' : risk < 0.3 ? 'warning-text' : 'danger-text');
      } else if (richness != null) {
        invasiveEl.textContent = 'Low (7%)';
        invasiveEl.style.color = 'var(--green)';
      }
    }
    if (keystoneEl) {
      const dom = bio.dominant_species?.[0] || speciesData?.species?.[0]?.species
        || speciesData?.species?.[0]?.canonicalName;
      if (dom) keystoneEl.textContent = dom.split(' ')[0];
    }

    // Analytics bio radar chart
    const bioChart = window._chartInst?.analyticsBio;
    if (bioChart) {
      const vegAvg   = ZONES.length > 0 ? ZONES.reduce((a, z) => a + (z.vegetation || 0), 0) / ZONES.length : 0;
      const soilScore = _lastDash?.soil_health?.soil_health_score ?? 0;
      const ndviNorm  = (_lastDash?.ndvi?.ndvi_mean ?? 0) * 100;
      const hNorm     = h != null ? (h / 5) * 100 : 0;
      const richNorm  = richness != null ? Math.min(richness / 80 * 100, 100) : 0;
      const socPct    = Math.min(((_lastDash?.soil?.soc ?? 0) / 10 / 50) * 100, 100);
      bioChart.data.datasets[0].data = [richNorm, hNorm, vegAvg, soilScore, ndviNorm, socPct].map(v => Math.round(v));
      bioChart.update('none');
    }

    // Data layers GBIF line
    updateDataLayersFeed();

  } catch (e) { console.warn('[live] biodiversity KPIs error:', e); }
}

// ── Alerts total badge ─────────────────────────────────────────────────────────
function updateAlertsTotalBadge(alerts) {
  const el = document.getElementById('alerts-total-badge');
  if (el) el.textContent = (alerts?.length ?? 0) + ' Total';
}

// ── Report table — populate from last dashboard fetch ─────────────────────────
function updateReportTable() {
  const soil  = _lastDash?.soil;
  const ndvi  = _lastDash?.ndvi;
  const sHealth = _lastDash?.soil_health;

  if (soil) {
    const som = soil.soc  != null ? ((soil.soc  / 10) * 0.172).toFixed(1) : null;
    const bd  = soil.bdod != null ? (soil.bdod / 100).toFixed(2) : null;
    const ph  = soil.phh2o!= null ? (soil.phh2o / 10).toFixed(1) : null;

    _setInner('report-som', som ? som + '%' : null);
    _setInner('report-bd',  bd  ? bd  + ' g/cm³' : null);
    _setInner('report-ph',  ph  || null);

    _setStatus('report-som-status', som, v => {
      const n = parseFloat(v); return { text: n >= 3 && n <= 6 ? '✓ Good' : '⚠ Low', cls: n >= 3 && n <= 6 ? 'success-text' : 'warning-text' };
    });
    _setStatus('report-bd-status', bd, v => {
      const n = parseFloat(v); return { text: n < 1.4 ? '✓ Good' : '⚠ Compacted', cls: n < 1.4 ? 'success-text' : 'warning-text' };
    });
    _setStatus('report-ph-status', ph, v => {
      const n = parseFloat(v); return { text: n >= 6.5 && n <= 7.5 ? '✓ Good' : '⚠ Off-range', cls: n >= 6.5 && n <= 7.5 ? 'success-text' : 'warning-text' };
    });
  }
  if (ndvi?.ndvi_mean != null) {
    const val = ndvi.ndvi_mean;
    _setInner('report-ndvi', val.toFixed(3));
    _setStatus('report-ndvi-status', val, v => {
      return v >= 0.5 ? { text: '✓ Healthy', cls: 'success-text' } : { text: '⚠ Low', cls: 'danger-text' };
    });
  }
}

// helper — set element text only if value is truthy
function _setInner(id, val) {
  const el = document.getElementById(id);
  if (el && val != null && val !== '') el.textContent = val;
}

// helper — set status element text + class from a resolver fn
function _setStatus(id, val, resolver) {
  if (val == null) return;
  const el = document.getElementById(id);
  if (!el) return;
  const { text, cls } = resolver(val);
  el.textContent = text;
  el.className   = cls;
}

// ── SOM / Bulk Density scatter chart from zones ───────────────────────────────
function updateSomScatterFromZones(zones) {
  const chart = window._chartInst?.somBulkDensity;
  if (!chart || !zones || zones.length === 0) return;
  const soil = _lastDash?.soil;
  const bd   = soil?.bdod != null ? soil.bdod / 100 : 1.38;
  const soc  = soil?.soc  != null ? soil.soc  / 10  : 3.16;

  // Build scatter points — one per zone, vary slightly around global soil values
  chart.data.datasets[0].data = zones.map(z => ({
    x: parseFloat((bd + (Math.random() - 0.5) * 0.08).toFixed(3)),
    y: parseFloat((soc * (0.6 + (z.vegetation ?? 50) / 100) + (Math.random() - 0.5) * 0.5).toFixed(2))
  }));
  chart.data.datasets[0].backgroundColor = zones.map(z => z.color + '99');
  chart.data.datasets[0].borderColor = zones.map(z => z.color);
  chart.update('none');
}

// ── Modal system ──────────────────────────────────────────────────────────────
function openModal(title, bodyHTML) {
  let overlay = document.getElementById('live-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'live-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" id="live-modal-box">
        <div class="modal-header">
          <span class="modal-title" id="live-modal-title"></span>
          <button class="modal-close" id="live-modal-close">✕</button>
        </div>
        <div class="modal-body" id="live-modal-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });
    document.getElementById('live-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }

  document.getElementById('live-modal-title').textContent = title;
  document.getElementById('live-modal-body').innerHTML = bodyHTML;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('live-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Zone detail modal ─────────────────────────────────────────────────────────
function openZoneModal(zone) {
  const risk = zone.risk || 'moderate';
  const color = getRiskColor(risk);
  const score = zone.riskScore || zone.risk_score || '—';
  const ndviVal = zone.ndvi != null ? zone.ndvi.toFixed(3) : '—';
  const vegPct = zone.vegetation != null ? zone.vegetation + '%' : '—';
  const elevation = zone.elevation_range ? zone.elevation_range[0] + '–' + zone.elevation_range[1] + 'm' : zone.elevation || '—';

  const html = `
    <div class="modal-zone-hero" style="border-left:4px solid ${color}">
      <div class="modal-zone-badge" style="background:${color}22;color:${color}">${risk.toUpperCase()} RISK</div>
      <div class="modal-zone-stats">
        <div class="mzs"><span class="mzs-label">Risk Score</span><span class="mzs-val" style="color:${color}">${score}/100</span></div>
        <div class="mzs"><span class="mzs-label">Area</span><span class="mzs-val">${zone.area_ha || zone.area} ha</span></div>
        <div class="mzs"><span class="mzs-label">NDVI</span><span class="mzs-val">${ndviVal}</span></div>
        <div class="mzs"><span class="mzs-label">Vegetation</span><span class="mzs-val">${vegPct}</span></div>
        <div class="mzs"><span class="mzs-label">Elevation</span><span class="mzs-val">${elevation}</span></div>
        <div class="mzs"><span class="mzs-label">Cluster</span><span class="mzs-val">${zone.cluster}</span></div>
      </div>
    </div>
    ${zone.description ? `<p class="modal-desc">${zone.description}</p>` : ''}
    <div class="modal-actions">
      <button class="btn-primary btn-sm" onclick="closeModal();activateSection('zones')">View in Zones</button>
      <button class="btn-secondary btn-sm" onclick="closeModal();activateSection('analytics')">Analytics</button>
    </div>
  `;
  openModal(zone.name + ' — ' + (zone.cluster || '') + ' Cluster', html);
}

// ── Pin detail modal ──────────────────────────────────────────────────────────
function openPinModal(pinId, analysis) {
  const a = analysis || _lastDash?.latest_pin_analysis;
  const sev = a?.erosion_severity || 'unknown';
  const veg = a?.vegetation_cover_percent;
  const conf = a?.confidence;
  const features = (a?.erosion_features || []).filter(f => f !== 'none');
  const types = a?.vegetation_types || [];
  const moisture = a?.moisture_estimate || '—';
  const color = sev === 'severe' || sev === 'high' ? '#ef4444' : sev === 'moderate' ? '#f59e0b' : '#22c55e';

  const html = `
    <div class="modal-zone-hero" style="border-left:4px solid ${color}">
      <div class="modal-zone-badge" style="background:${color}22;color:${color}">${sev.toUpperCase()} EROSION</div>
      <div class="modal-zone-stats">
        <div class="mzs"><span class="mzs-label">Vegetation Cover</span><span class="mzs-val">${veg != null ? veg + '%' : '—'}</span></div>
        <div class="mzs"><span class="mzs-label">Moisture</span><span class="mzs-val">${moisture}</span></div>
        <div class="mzs"><span class="mzs-label">Confidence</span><span class="mzs-val">${conf != null ? (conf*100).toFixed(0) + '%' : '—'}</span></div>
        <div class="mzs"><span class="mzs-label">Location</span><span class="mzs-val">Zone 3</span></div>
      </div>
    </div>
    ${features.length > 0 ? `
      <div class="modal-tags-section">
        <span class="modal-tags-label">Erosion Features Detected:</span>
        <div class="modal-tags">
          ${features.map(f => `<span class="modal-tag danger">${f.replace('_',' ')}</span>`).join('')}
        </div>
      </div>
    ` : ''}
    ${types.length > 0 ? `
      <div class="modal-tags-section">
        <span class="modal-tags-label">Vegetation Types:</span>
        <div class="modal-tags">
          ${types.map(t => `<span class="modal-tag success">${t}</span>`).join('')}
        </div>
      </div>
    ` : ''}
    ${a?.change_notes ? `<div class="modal-desc">${a.change_notes}</div>` : ''}
    <div class="modal-actions">
      <button class="btn-primary btn-sm" onclick="triggerPinAnalysis().then(r => { showToast(r.message || 'Analysis queued'); closeModal(); })">Trigger New Analysis</button>
      <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
    </div>
  `;
  openModal(`Smart Pin ${pinId} — Live Analysis`, html);
}

// ── Alert detail modal ────────────────────────────────────────────────────────
function openAlertModal(alertData) {
  const color = alertData.severity === 'high' || alertData.severity === 'critical' ? '#ef4444'
    : alertData.severity === 'moderate' ? '#f59e0b' : '#3b82f6';

  const html = `
    <div class="modal-zone-hero" style="border-left:4px solid ${color}">
      <div class="modal-zone-badge" style="background:${color}22;color:${color}">${(alertData.severity || 'info').toUpperCase()}</div>
      <div style="padding:12px 0;color:var(--text-2);line-height:1.6">${alertData.message || alertData.description || ''}</div>
    </div>
    <div class="modal-tags-section">
      <span class="modal-tags-label">Type:</span>
      <span class="modal-tag" style="background:${color}22;color:${color}">${alertData.type || 'system'}</span>
    </div>
    <div class="modal-actions">
      <button class="btn-primary btn-sm" onclick="closeModal();activateSection('alerts')">View All Alerts</button>
      <button class="btn-secondary btn-sm" onclick="closeModal()">Dismiss</button>
    </div>
  `;
  openModal('Alert Detail', html);
}

// ── Wire interactivity after render ──────────────────────────────────────────
function wireInteractivity() {
  // Pin cards → modal
  document.querySelectorAll('.pin-thumb').forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.style.cursor = 'pointer';
    const label = el.querySelector('.pin-label');
    const pinId = label ? label.textContent.split(':')[0].trim() : '?';
    el.addEventListener('click', () => openPinModal(pinId));
  });

  // Alert rows → modal
  document.querySelectorAll('.alert-row').forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const text = el.querySelector('.alert-text')?.textContent || '';
      const cls = el.className;
      const sev = cls.includes('danger') ? 'high' : cls.includes('warning') ? 'moderate' : 'info';
      openAlertModal({ message: text, severity: sev, type: 'erosion' });
    });
  });

  // Alert cards in alerts section → modal
  document.querySelectorAll('.alert-card').forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const title = el.querySelector('.alert-card-title')?.textContent || '';
      const desc  = el.querySelector('.alert-card-desc')?.textContent || '';
      const badge = el.querySelector('.alert-card-badge')?.textContent || '';
      openAlertModal({ message: title + ': ' + desc, severity: badge.toLowerCase(), type: 'erosion' });
    });
  });

  // Zone items → modal
  document.querySelectorAll('.zone-item').forEach(el => {
    if (el.dataset.modalWired) return;
    el.dataset.modalWired = '1';
    el.addEventListener('dblclick', () => {
      const zoneId = parseInt(el.dataset.zoneId);
      const zone = ZONES.find(z => z.id === zoneId);
      if (zone) openZoneModal(zone);
    });
  });
}

// ── Zone list rendering with live data ───────────────────────────────────────
async function renderZoneListLive() {
  const container = document.getElementById('zone-items-list');
  if (!container) return;
  container.innerHTML = '';  // always re-render with live data

  let zones = ZONES;
  try {
    const live = await fetchZones();
    if (live && live.length > 0) zones = live;
  } catch {}

  zones.forEach(zone => {
    const risk = zone.risk || 'low';
    const riskColor = getRiskColor(risk);
    const score = zone.riskScore || zone.risk_score || '—';
    const ndvi = zone.ndvi != null ? zone.ndvi.toFixed(2) : '—';
    const veg = zone.vegetation != null ? zone.vegetation + '%' : '—';
    const badgeClass = risk === 'high' ? 'danger' : risk === 'moderate' ? 'warning' : 'success';

    const item = document.createElement('div');
    item.className = 'zone-item';
    item.dataset.zoneId = zone.id;
    item.innerHTML = `
      <div class="zone-risk-dot" style="background:${riskColor};box-shadow:0 0 6px ${riskColor}44"></div>
      <div class="zone-item-info">
        <div class="zone-item-name">${zone.name}</div>
        <div class="zone-item-meta">${zone.area_ha || zone.area} ha · ${zone.cluster} · NDVI ${ndvi}</div>
      </div>
      <div class="zone-item-badges">
        <span class="zone-badge ${badgeClass}">${score}/100</span>
        <span style="font-size:9px;color:#64748b">${veg} veg</span>
      </div>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('.zone-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      if (zonesMap) zonesMap.setView(zone.center || [zone.lat, zone.lon], 15);
    });

    item.addEventListener('dblclick', () => openZoneModal(zone));
    container.appendChild(item);
  });

  wireInteractivity();
}

// ── Biodiversity live update ───────────────────────────────────────────────────
async function fetchAndUpdateBio() {
  try {
    const bio = await fetchBiodiversity();
    if (!bio) return;

    // Update KPI cards
    const kpiEls = {
      'bio-shannon': bio.shannon_h?.toFixed(2),
      'bio-richness': bio.species_richness,
      'bio-total': bio.total_occurrences,
    };
    Object.entries(kpiEls).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val != null) animateNumber(el, parseFloat(val), id === 'bio-shannon' ? 2 : 0);
    });
  } catch {}
}

// ── Carbon calculator wired to API ───────────────────────────────────────────
async function calculateCarbonLive() {
  const som   = parseFloat(document.getElementById('inp-som')?.value) || 3.5;
  const bd    = parseFloat(document.getElementById('inp-bd')?.value) || 1.34;
  const depth = parseFloat(document.getElementById('inp-depth')?.value) || 15;
  const zone  = 3;

  const resultEl = document.getElementById('carbon-result');
  if (resultEl) resultEl.innerHTML = '<span style="color:var(--text-3)">Calculating…</span>';

  try {
    const result = await calculateCarbonAPI(som, bd, depth, 1.0, zone);
    const r = result?.result || {};
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="carbon-calc-result">
          <div class="ccr-row"><span>OC%</span><strong>${r.organic_carbon_pct ?? (som*0.58).toFixed(2)}%</strong></div>
          <div class="ccr-row"><span>Carbon Stock</span><strong>${r.carbon_stock_t_per_ha ?? '—'} tC/ha</strong></div>
          <div class="ccr-row"><span>CO₂ Equivalent</span><strong>${r.co2_equivalent_t_per_ha ?? '—'} tCO₂/ha</strong></div>
        </div>
      `;
    }
    if (result?.warnings?.length > 0) {
      showToast('⚠ ' + result.warnings[0]);
    }
  } catch (err) {
    // Local fallback
    const oc = som * 0.58;
    const stock = oc * bd * depth * 100 / 1000;
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="carbon-calc-result">
          <div class="ccr-row"><span>OC%</span><strong>${oc.toFixed(2)}%</strong></div>
          <div class="ccr-row"><span>Carbon Stock</span><strong>${stock.toFixed(2)} tC/ha</strong></div>
          <div class="ccr-row"><span>CO₂ Equivalent</span><strong>${(stock*3.67).toFixed(1)} tCO₂/ha</strong></div>
        </div>
      `;
    }
  }
}

// ── ESG report wired to API ───────────────────────────────────────────────────
async function generateReportLive() {
  showToast('🤖 Generating AI ESG Report…');
  const reportEl = document.getElementById('report-output');
  if (reportEl) reportEl.innerHTML = '<div class="report-loading"><div class="spinner"></div><span>AI is analyzing all monitoring data…</span></div>';

  try {
    const result = await generateESGReport();  // defined in api.js
    const report = result?.report || {};

    if (reportEl) {
      const sections = [
        ['Executive Summary', report.executive_summary],
        ['Erosion Risk Assessment', report.erosion_risk_assessment],
        ['Vegetation & NDVI', report.vegetation_analysis],
        ['Soil Carbon', report.carbon_accounting],
        ['Biodiversity', report.biodiversity_assessment],
        ['Recommendations', Array.isArray(report.recommendations) ? report.recommendations.join('\n') : report.recommendations],
      ].filter(([, v]) => v);

      reportEl.innerHTML = sections.map(([title, body]) => `
        <div class="report-section">
          <h3 class="report-section-title">${title}</h3>
          <p class="report-section-body">${(body || '').replace(/\n/g, '<br>')}</p>
        </div>
      `).join('');
    }
    showToast('✅ ESG Report generated successfully');
  } catch (err) {
    if (reportEl) reportEl.innerHTML = '<div style="color:var(--text-3);padding:16px">Backend unavailable — connect to generate AI report.</div>';
    showToast('⚠ Report generation failed — backend offline?');
  }
}

// ── Timelapse images ──────────────────────────────────────────────────────────
async function fetchTimelapseImages() {
  const grid = document.getElementById('pins-grid-live');
  if (!grid) return;

  try {
    const resp = await apiFetch('/timelapse/images?limit=8');
    if (!resp || !resp.images || resp.images.length === 0) {
      grid.innerHTML = '<div class="pin-loading" style="color:var(--text-3);padding:16px;font-size:12px">No images found in timelapse folder</div>';
      return;
    }

    grid.innerHTML = '';
    resp.images.forEach((img, i) => {
      const ts = new Date(img.mtime * 1000);
      const timeStr = ts.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const el = document.createElement('div');
      el.className = 'pin-thumb';
      el.style.cursor = 'pointer';
      el.innerHTML = `
        <div class="pin-img" style="background:#0d1117">
          <img src="${img.url}" alt="${img.filename}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:4px" onerror="this.style.display='none'">
        </div>
        <div class="pin-info">
          <span class="pin-label" style="font-size:10px">${img.filename.slice(0, 18)}…</span>
          <span class="pin-date">${timeStr}</span>
          <span class="pin-status" style="color:var(--text-3)">${(img.size / 1024).toFixed(0)}KB</span>
        </div>
      `;
      el.addEventListener('click', () => openImageAnalysisModal(img));
      grid.appendChild(el);
    });

    // Also update zones pin feed
    updateZonesPinFeed(resp.images);
    // Also update analytics before/after
    updateBeforeAfter(resp.images);

  } catch (err) {
    console.error('[live] timelapse images error:', err);
    grid.innerHTML = '<div style="color:var(--text-3);padding:16px;font-size:12px">No timelapse images available</div>';
  }
}

async function openImageAnalysisModal(img) {
  openModal(`📷 ${img.filename}`, `
    <div style="text-align:center;margin-bottom:16px">
      <img src="${img.url}" style="max-width:100%;max-height:350px;border-radius:8px;border:1px solid var(--border)" onerror="this.style.display='none'">
    </div>
    <div id="img-analysis-body" class="modal-zone-hero" style="border-left:3px solid var(--blue)">
      <div style="display:flex;align-items:center;gap:8px;color:var(--text-3)">
        <div class="spinner"></div> Fetching AI analysis…
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-primary btn-sm" onclick="triggerImageAnalysis('${img.filename}')">🤖 Re-analyze</button>
      <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
    </div>
  `);

  try {
    const analysis = await apiFetch('/smart-pin/latest-analysis');
    const bodyEl = document.getElementById('img-analysis-body');
    if (!bodyEl) return;

    if (analysis && !analysis.message) {
      const sev = analysis.erosion_severity || 'unknown';
      const color = sev === 'severe' || sev === 'high' ? '#ef4444' : sev === 'moderate' ? '#f59e0b' : '#22c55e';
      bodyEl.style.borderLeftColor = color;
      bodyEl.innerHTML = `
        <div class="modal-zone-badge" style="background:${color}22;color:${color}">${sev.toUpperCase()} EROSION</div>
        <div class="modal-zone-stats" style="margin-top:10px">
          <div class="mzs"><span class="mzs-label">Vegetation Cover</span><span class="mzs-val">${analysis.vegetation_cover_percent ?? '—'}%</span></div>
          <div class="mzs"><span class="mzs-label">Moisture</span><span class="mzs-val">${analysis.moisture_estimate ?? '—'}</span></div>
          <div class="mzs"><span class="mzs-label">Confidence</span><span class="mzs-val">${analysis.confidence != null ? (analysis.confidence * 100).toFixed(0) + '%' : '—'}</span></div>
        </div>
        ${analysis.erosion_features?.filter(f => f !== 'none').length > 0 ? `
          <div style="margin-top:10px">
            <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;margin-bottom:5px">Erosion Features</div>
            <div class="modal-tags">${analysis.erosion_features.filter(f => f !== 'none').map(f => `<span class="modal-tag danger">${f.replace('_', ' ')}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${analysis.change_notes ? `<div style="margin-top:10px;font-size:11px;color:var(--text-2);line-height:1.6">${analysis.change_notes}</div>` : ''}
      `;
    } else {
      bodyEl.innerHTML = '<div style="color:var(--text-3);font-size:12px">No AI analysis available yet. Click "Re-analyze" to trigger Gemini analysis.</div>';
    }
  } catch {}
}

async function triggerImageAnalysis(filename) {
  showToast('🤖 Triggering AI analysis…');
  const result = await apiFetch('/smart-pin/analyze-now', { method: 'POST' });
  showToast(result?.message || 'Analysis queued');
}

// Store images for click handlers (avoids JSON-in-onclick issues)
let _zonesPinImages = [];

function updateZonesPinFeed(images) {
  const feed = document.getElementById('zones-pin-feed');
  if (!feed) return;
  const countEl = document.getElementById('pin-activity-count');
  if (countEl) countEl.textContent = `${images.length} recent images`;

  _zonesPinImages = images;
  const slice = images.slice(0, 5);

  feed.innerHTML = slice.map((img, i) => {
    const ts = new Date(img.mtime * 1000);
    return `
      <div class="zones-pin-item" data-img-idx="${i}">
        <img src="${img.url}" style="width:60px;height:45px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">
        <div class="zones-pin-item-info">
          <div style="font-size:11px;font-weight:600;color:var(--text-1)">${img.filename.slice(0, 20)}</div>
          <div style="font-size:9px;color:var(--text-3)">${ts.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
    `;
  }).join('');

  feed.querySelectorAll('.zones-pin-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.imgIdx);
      if (_zonesPinImages[idx]) openImageAnalysisModal(_zonesPinImages[idx]);
    });
  });
}

function updateBeforeAfter(images) {
  if (images.length < 2) return;
  const latest = images[0];
  const older = images[Math.min(images.length - 1, 5)];

  const beforeImg = document.getElementById('ba-before-img');
  const afterImg = document.getElementById('ba-after-img');
  const beforeLabel = document.getElementById('ba-before-label');
  const afterLabel = document.getElementById('ba-after-label');

  if (beforeImg) { beforeImg.src = older.url; beforeImg.style.display = ''; }
  if (afterImg)  { afterImg.src = latest.url; afterImg.style.display = ''; }
  if (beforeLabel) beforeLabel.textContent = new Date(older.mtime * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' — Earlier';
  if (afterLabel)  afterLabel.textContent  = new Date(latest.mtime * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' — Latest';
}

// ── Dropdown wiring ───────────────────────────────────────────────────────────
function wireDropdowns() {
  const notifBtn      = document.querySelector('.notif-btn');
  const notifDropdown = document.getElementById('notif-dropdown');
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('open');
      document.getElementById('profile-dropdown')?.classList.remove('open');
      const body = document.getElementById('notif-dropdown-body');
      if (body && _lastDash) {
        const alerts = _lastDash.alerts || [];
        body.innerHTML = alerts.length > 0
          ? alerts.map(a => `<div class="notif-item ${a.severity}">${a.message}</div>`).join('')
          : '<div class="notif-item" style="color:var(--text-3)">No active alerts</div>';
      }
    });
  }

  const profileBtn      = document.querySelector('.user-profile');
  const profileDropdown = document.getElementById('profile-dropdown');
  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdown.classList.toggle('open');
      notifDropdown?.classList.remove('open');
    });
  }

  document.addEventListener('click', () => {
    notifDropdown?.classList.remove('open');
    profileDropdown?.classList.remove('open');
  });
}

// ── Alerts buttons ────────────────────────────────────────────────────────────
function wireAlertsButtons() {
  document.querySelectorAll('.alerts-page .page-actions button').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    const txt = btn.textContent.trim();

    if (txt.includes('Mark All')) {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.alert-card').forEach(el => {
          el.style.opacity = '0.5';
          el.style.filter = 'grayscale(1)';
        });
        showToast('All alerts marked as read');
      });
    }

    if (txt.includes('Configure')) {
      btn.addEventListener('click', () => {
        openModal('Configure Alert Thresholds', `
          <div class="modal-zone-hero" style="border-left:3px solid var(--blue)">
            <div class="modal-zone-stats">
              <div class="mzs" style="grid-column:span 3">
                <span class="mzs-label">Rainfall Alert Threshold (mm/hr)</span>
                <input type="range" min="5" max="30" value="15" oninput="this.nextElementSibling.textContent=this.value+'mm'" style="width:100%;margin-top:6px">
                <span class="mzs-val">15mm</span>
              </div>
              <div class="mzs" style="grid-column:span 3">
                <span class="mzs-label">NDVI Alert Threshold</span>
                <input type="range" min="10" max="60" value="30" oninput="this.nextElementSibling.textContent='0.'+this.value" style="width:100%;margin-top:6px">
                <span class="mzs-val">0.30</span>
              </div>
              <div class="mzs" style="grid-column:span 3">
                <span class="mzs-label">Email Notifications</span>
                <input type="email" placeholder="admin@solterra.com" style="margin-top:6px;background:var(--bg-3);border:1px solid var(--border);color:var(--text-1);padding:6px 10px;border-radius:6px;width:100%">
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-primary btn-sm" onclick="showToast('Alert thresholds saved');closeModal()">Save Thresholds</button>
            <button class="btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        `);
      });
    }
  });
}

// ── Zone page buttons ─────────────────────────────────────────────────────────
function wireZoneButtons() {
  document.querySelectorAll('.zones-page .page-actions button').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    const txt = btn.textContent.trim();

    if (txt.includes('Export')) {
      btn.addEventListener('click', () => {
        openModal('Export Zone Report', `
          <div class="modal-zone-hero" style="border-left:3px solid var(--blue)">
            <div style="font-size:12px;color:var(--text-2);line-height:1.8">
              <p><strong>Exporting zone report for all 9 zones</strong></p>
              <p>• Total area: 147.19 ha</p>
              <p>• Site: Tsenovo Solar Park, Bulgaria</p>
              <p>• Zones with active erosion: Z2, Z3</p>
              <p>• Last updated: ${new Date().toLocaleDateString()}</p>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-primary btn-sm" onclick="showToast('Zone report would download as PDF');closeModal()">Download PDF</button>
            <button class="btn-secondary btn-sm" onclick="showToast('Zone data exported as CSV');closeModal()">Export CSV</button>
            <button class="btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        `);
      });
    }

    if (txt.includes('Add')) {
      btn.addEventListener('click', () => {
        openModal('Add New Zone', `
          <div class="modal-zone-hero" style="border-left:3px solid var(--green)">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><span style="font-size:9px;color:var(--text-3);text-transform:uppercase">Zone Name</span><input type="text" placeholder="Zone 10" style="margin-top:4px;background:var(--bg-3);border:1px solid var(--border);color:var(--text-1);padding:7px 10px;border-radius:6px;width:100%"></div>
              <div><span style="font-size:9px;color:var(--text-3);text-transform:uppercase">Area (ha)</span><input type="number" placeholder="5.0" style="margin-top:4px;background:var(--bg-3);border:1px solid var(--border);color:var(--text-1);padding:7px 10px;border-radius:6px;width:100%"></div>
              <div><span style="font-size:9px;color:var(--text-3);text-transform:uppercase">Cluster</span><select style="margin-top:4px;background:var(--bg-3);border:1px solid var(--border);color:var(--text-1);padding:7px 10px;border-radius:6px;width:100%"><option>North</option><option>Middle</option><option>South</option></select></div>
              <div><span style="font-size:9px;color:var(--text-3);text-transform:uppercase">Risk Level</span><select style="margin-top:4px;background:var(--bg-3);border:1px solid var(--border);color:var(--text-1);padding:7px 10px;border-radius:6px;width:100%"><option>Low</option><option>Moderate</option><option>High</option></select></div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-primary btn-sm" onclick="showToast('Zone added (requires backend integration)');closeModal()">Add Zone</button>
            <button class="btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        `);
      });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA LAYERS — Interactive panel engine
// ═══════════════════════════════════════════════════════════════════════════════

let _selectedLayer  = null;
let _layerChartInst = null;   // Chart instance inside the detail panel

// ── Map label map ──────────────────────────────────────────────────────────────
const _LAYER_MAP_LABELS = {
  ndvi:    'NDVI · Sentinel-2 · Zone 3',
  pins:    'Smart Erosion Pins · Tsenovo',
  weather: 'Open-Meteo Weather',
  nasa:    'NASA POWER · Solar / Precip',
  pvgis:   'PVGIS Solar Resource',
  soil:    'SoilGrids ISRIC · Tsenovo',
  gbif:    'GBIF Biodiversity · 5km radius',
  carbon:  'Soil Lab Samples · Zone 3',
};

// ── Strip status helpers ──────────────────────────────────────────────────────
function _setIntChip(id, dotClass, val) {
  const dot = document.getElementById(`int-dot-${id}`);
  const valEl = document.getElementById(`int-val-${id}`);
  if (dot) dot.className = `int-dot ${dotClass}`;
  if (valEl) valEl.textContent = val;
}

// ── Select a layer → render detail panel ────────────────────────────────────
async function selectLayer(layerId) {
  _selectedLayer = layerId;

  // Highlight selected chip + sidebar item
  document.querySelectorAll('.int-chip').forEach(c => c.classList.toggle('selected', c.dataset.layer === layerId));
  document.querySelectorAll('.layer-item-v2').forEach(i => i.classList.toggle('active', i.dataset.layer === layerId));

  // Update map badge label
  const mapLabel = document.getElementById('map-layer-label');
  if (mapLabel) mapLabel.textContent = _LAYER_MAP_LABELS[layerId] || layerId;

  const panel = document.getElementById('layer-detail-panel');
  if (!panel) return;

  // Show loading state
  panel.innerHTML = `<div class="ldp-loading"><span class="live-dot"></span> Loading ${layerId} data…</div>`;

  // Destroy previous chart
  if (_layerChartInst) { _layerChartInst.destroy(); _layerChartInst = null; }

  try {
    switch (layerId) {
      case 'ndvi':    await _renderLayerNDVI(panel); break;
      case 'pins':    await _renderLayerPins(panel); break;
      case 'weather': await _renderLayerWeather(panel); break;
      case 'nasa':    await _renderLayerNASA(panel); break;
      case 'pvgis':   await _renderLayerPVGIS(panel); break;
      case 'soil':    await _renderLayerSoil(panel); break;
      case 'gbif':    await _renderLayerGBIF(panel); break;
      case 'carbon':  await _renderLayerCarbon(panel); break;
      default: panel.innerHTML = `<div class="ldp-error">Unknown layer: ${layerId}</div>`;
    }
  } catch (err) {
    panel.innerHTML = `<div class="ldp-error">⚠ Failed to load ${layerId} data: ${err.message}</div>`;
    console.error('[DataLayers]', layerId, err);
  }
}

// ── Refresh all: update strip labels ────────────────────────────────────────
async function updateDataLayersFeed() {
  // Update the integration strip from cached dashboard data
  const d = _lastDash;
  if (!d) return;

  const ndvi = d.ndvi;
  if (ndvi?.ndvi_mean != null) {
    const ok = ndvi.source !== 'mock';
    _setIntChip('ndvi', ok ? 'ok' : 'warn', `NDVI ${ndvi.ndvi_mean.toFixed(3)}`);
    _setMeta('ndvi', `NDVI Z3: ${ndvi.ndvi_mean.toFixed(3)} · ${ndvi.source}`);
    _setBadge('ndvi', ok ? 'success' : 'warning', ok ? 'Live' : 'Mock');
  }

  const w = d.weather;
  if (w) {
    _setIntChip('weather', 'ok', `${w.avg_temperature_c?.toFixed(1) ?? '—'}°C · ${w.total_precipitation_mm?.toFixed(0) ?? '—'}mm`);
    _setMeta('weather', `Temp: ${w.avg_temperature_c?.toFixed(1) ?? '—'}°C · Precip: ${w.total_precipitation_mm?.toFixed(0) ?? '—'}mm`);
    _setBadge('weather', 'success', 'Live');
  }

  const s = d.soil;
  if (s?.phh2o) {
    const ph = (s.phh2o/10).toFixed(1), soc = (s.soc/10).toFixed(1);
    _setIntChip('soil', 'ok', `pH ${ph} · SOC ${soc}‰`);
    _setMeta('soil', `pH: ${ph} · SOC: ${soc}‰ · Clay: ${(s.clay/10).toFixed(0)}%`);
    _setBadge('soil', 'success', 'Live');
  }

  // GBIF — from cached DOM values
  const shannon = document.getElementById('shannon-value')?.textContent;
  const bioTotal = document.getElementById('bio-total-species')?.textContent;
  if (bioTotal && bioTotal !== '—') {
    _setIntChip('gbif', 'ok', `${bioTotal} spp · H′${shannon ?? '—'}`);
    _setMeta('gbif', `${bioTotal} species · Shannon H′: ${shannon ?? '—'}`);
    _setBadge('gbif', 'success', 'Live');
  }

  _setIntChip('pins', 'ok', '7 pins · 1 offline');
  _setMeta('pins', `7 pins active · 1 offline · ${new Date().toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'})}`);

  // Re-render selected layer detail if visible
  if (_selectedLayer) selectLayer(_selectedLayer);
}

function refreshAllLayers() {
  // Trigger fresh data fetch for all sources
  updateDataLayersFeed();
  fetchAndUpdateBiodiversityKPIs();
  // Also pre-warm NASA POWER and PVGIS (they cache themselves)
  apiFetch('/nasa-power/summary').then(d => {
    if (!d) return;
    _setIntChip('nasa', 'ok', `${d.total_precip_mm?.toFixed(0) ?? '—'}mm · ${d.avg_solar_wm2?.toFixed(0) ?? '—'}W/m²`);
    _setMeta('nasa', `30d precip: ${d.total_precip_mm?.toFixed(0) ?? '—'}mm · Solar: ${d.avg_solar_wm2?.toFixed(0) ?? '—'} W/m²`);
    _setBadge('nasa', 'success', 'Live');
  }).catch(() => { _setIntChip('nasa', 'warn', 'unavailable'); });

  apiFetch('/pvgis/monthly').then(d => {
    if (!d || !d.monthly?.length) return;
    const yr = d.monthly.reduce((s, m) => s + (m.Hh_kwh_m2 || 0), 0);
    _setIntChip('pvgis', 'ok', `${yr.toFixed(0)} kWh/m²/yr`);
    _setMeta('pvgis', `Annual irradiance: ${yr.toFixed(0)} kWh/m²/yr`);
    _setBadge('pvgis', 'success', 'Live');
  }).catch(() => { _setIntChip('pvgis', 'warn', 'unavailable'); });

  apiFetch('/carbon/history').then(d => {
    if (!d?.records?.length) return;
    const latest = d.records.slice(-1)[0];
    const som = latest?.som_pct ?? latest?.som_percent;
    const stock = latest?.carbon_stock_t_per_ha;
    _setIntChip('carbon', 'ok', `${stock?.toFixed(2) ?? '—'} tC/ha`);
    _setMeta('carbon', `Latest: SOM ${som?.toFixed(1) ?? '—'}% · ${stock?.toFixed(2) ?? '—'} tC/ha`);
    _setBadge('carbon', 'success', 'Live');
  }).catch(() => {});
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
function _setMeta(id, text)   { const el = document.getElementById(`lm-${id}`);  if (el) el.textContent = text; }
function _setBadge(id, cls, text) {
  const el = document.getElementById(`lb-${id}`);
  if (!el) return;
  el.textContent = text;
  el.className = `layer-badge ${cls}`;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function _ldpHeader(icon, title, subtitle, statusText, statusOk) {
  return `
    <div class="ldp-header">
      <div>
        <div class="ldp-title-row"><span class="ldp-src-icon">${icon}</span><span class="ldp-title">${title}</span></div>
        <div class="ldp-subtitle">${subtitle}</div>
      </div>
      <div class="ldp-status-chip">
        <span class="${statusOk ? 'live-dot' : 'mock-dot'}"></span> ${statusText}
      </div>
    </div>`;
}

function _ldpMetrics(items) {
  return `<div class="ldp-metrics">${items.map(([label, val, sub]) => `
    <div class="ldp-metric">
      <span class="ldp-metric-label">${label}</span>
      <span class="ldp-metric-val">${val}</span>
      ${sub ? `<span class="ldp-metric-sub">${sub}</span>` : ''}
    </div>`).join('')}</div>`;
}

function _ldpChartWrap(canvasId, title, subtitle = '') {
  return `
    <div class="ldp-chart-wrap">
      <div class="ldp-chart-title">${title}<span style="color:var(--text-3);font-weight:400;text-transform:none;letter-spacing:0">${subtitle}</span></div>
      <canvas id="${canvasId}"></canvas>
    </div>`;
}

// ── 1. Sentinel-2 NDVI Detail ────────────────────────────────────────────────
async function _renderLayerNDVI(panel) {
  const allNdvi = await apiFetch('/ndvi/all-zones');
  const z3      = _lastDash?.ndvi || {};
  const zones   = Object.entries(allNdvi || {}).map(([zid, d]) => ({
    zone: `Z${zid}`, ndvi: d?.ndvi_mean ?? null, src: d?.source
  }));

  const ndviVal = z3.ndvi_mean;
  const isLive  = z3.source && z3.source !== 'mock' && z3.source !== 'unavailable';

  panel.innerHTML =
    _ldpHeader('🛰', 'Sentinel-2 NDVI', 'Copernicus Dataspace · Sentinel Hub OAuth2', isLive ? 'Live Satellite' : 'Cached / Mock', isLive) +
    _ldpMetrics([
      ['Z3 NDVI', ndviVal != null ? ndviVal.toFixed(3) : '—', 'primary focus'],
      ['Source',   z3.source || '—', ''],
      ['Alert threshold', '0.300', 'below = alert'],
      ['Status',  ndviVal != null ? (ndviVal < 0.30 ? '⚠ Critical' : ndviVal < 0.45 ? '↓ Low' : '✓ Healthy') : '—', ''],
    ]) +
    _ldpChartWrap('ldp-ndvi-chart', 'NDVI by Zone', zones.length ? '' : ' — awaiting data') +
    `<div class="ldp-section-title">All Zones</div>
    <table class="ldp-table">
      <tr><th>Zone</th><th>NDVI</th><th>Source</th><th>Status</th></tr>
      ${zones.map(z => {
        const cls = z.ndvi == null ? '' : z.ndvi < 0.30 ? 'color:#ef4444' : z.ndvi < 0.45 ? 'color:#f59e0b' : 'color:#22c55e';
        return `<tr><td>${z.zone}</td><td style="${cls}">${z.ndvi != null ? z.ndvi.toFixed(3) : '—'}</td><td style="color:var(--text-3)">${z.src || '—'}</td><td style="${cls}">${z.ndvi != null ? (z.ndvi < 0.30 ? 'Critical' : z.ndvi < 0.45 ? 'Low' : 'Healthy') : '—'}</td></tr>`;
      }).join('')}
    </table>`;

  // Bar chart: NDVI by zone
  const validZones = zones.filter(z => z.ndvi != null);
  if (validZones.length > 0) {
    const ctx = document.getElementById('ldp-ndvi-chart');
    if (ctx) _layerChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: validZones.map(z => z.zone),
        datasets: [{
          data: validZones.map(z => z.ndvi),
          backgroundColor: validZones.map(z => z.ndvi < 0.30 ? '#ef444488' : z.ndvi < 0.45 ? '#f59e0b88' : '#22c55e88'),
          borderColor: validZones.map(z => z.ndvi < 0.30 ? '#ef4444' : z.ndvi < 0.45 ? '#f59e0b' : '#22c55e'),
          borderWidth: 1, borderRadius: 3,
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 1, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 9 } } },
                  x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 9 } } } } }
    });
  }

  _setIntChip('ndvi', isLive ? 'ok' : 'warn', `NDVI ${ndviVal?.toFixed(3) ?? '—'}`);
}

// ── 2. Smart Erosion Pins Detail ─────────────────────────────────────────────
async function _renderLayerPins(panel) {
  const [pinStatus, history] = await Promise.all([
    apiFetch('/smart-pin/status'),
    apiFetch('/smart-pin/history?limit=20'),
  ]);

  const pins   = pinStatus?.pins || [];
  const onlineCount = pins.filter(p => p.status === 'active').length;
  const recentAnalyses = history || [];
  const latest = recentAnalyses[recentAnalyses.length - 1];

  panel.innerHTML =
    _ldpHeader('📍', 'Smart Erosion Pins', 'On-site IoT · Raspberry Pi + Camera', `${onlineCount}/${pins.length} Online`, onlineCount > 0) +
    _ldpMetrics([
      ['Total Pins', pins.length, ''],
      ['Online',     onlineCount, 'active'],
      ['Offline',    pins.length - onlineCount, ''],
      ['Analyses',   recentAnalyses.length, 'in history'],
    ]) +
    `<div class="ldp-section-title">Pin Status</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px">
      ${pins.map(p => `
        <div style="background:var(--bg-card);border:1px solid ${p.status==='active'?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.2)'};border-radius:6px;padding:6px 8px;text-align:center">
          <div style="font-size:11px;font-weight:700;color:var(--text-1)">${p.id}</div>
          <div style="font-size:9px;color:${p.status==='active'?'#22c55e':'#ef4444'};margin-top:2px">${p.status==='active'?'● Online':'○ Offline'}</div>
          <div style="font-size:9px;color:var(--text-3)">Z${p.zone}</div>
        </div>`).join('')}
    </div>` +
    (latest ? `
    <div class="ldp-section-title">Latest Analysis — ${latest.pin_id || '—'}</div>
    ${_ldpMetrics([
      ['Veg Cover', latest.vegetation_cover_percent != null ? latest.vegetation_cover_percent + '%' : '—', ''],
      ['Severity', latest.erosion_severity || '—', ''],
      ['Moisture', latest.moisture_estimate || '—', ''],
      ['Confidence', latest.confidence != null ? (latest.confidence*100).toFixed(0)+'%' : '—', ''],
    ])}
    <div style="font-size:9px;color:var(--text-3);font-family:IBM Plex Mono,monospace;margin-top:4px">${latest.timestamp || ''}</div>
    ` : '<div style="color:var(--text-3);font-size:11px;padding:12px 0">No pin analyses recorded yet.</div>') +
    (recentAnalyses.length > 0 ? `
    <div class="ldp-section-title">Recent Records (${Math.min(recentAnalyses.length, 10)})</div>
    <table class="ldp-table">
      <tr><th>Pin</th><th>Severity</th><th>Veg%</th><th>Moisture</th><th>Time</th></tr>
      ${recentAnalyses.slice(-10).reverse().map(a => `
        <tr>
          <td>${a.pin_id || '—'}</td>
          <td style="color:${a.erosion_severity==='severe'||a.erosion_severity==='high'?'#ef4444':a.erosion_severity==='moderate'?'#f59e0b':'#22c55e'}">${a.erosion_severity || '—'}</td>
          <td>${a.vegetation_cover_percent ?? '—'}%</td>
          <td>${a.moisture_estimate || '—'}</td>
          <td>${(a.timestamp||'').slice(0,16).replace('T',' ')}</td>
        </tr>`).join('')}
    </table>` : '');

  _setIntChip('pins', onlineCount > 0 ? 'ok' : 'err', `${onlineCount}/${pins.length} online`);
}

// ── 3. Open-Meteo Weather Detail ─────────────────────────────────────────────
async function _renderLayerWeather(panel) {
  const data = await apiFetch('/weather');
  const sum  = data?.summary || _lastDash?.weather || {};
  const hist = data?.historical || {};
  const fc   = data?.forecast || {};

  const times  = hist.time || [];
  const precip = hist.precipitation || [];
  const temps  = hist.temperature || [];

  // Build daily totals for last 14 days
  const daily = {};
  times.forEach((t, i) => {
    const day = t.slice(0, 10);
    if (!daily[day]) daily[day] = { precip: 0, temps: [] };
    daily[day].precip += (precip[i] || 0);
    if (temps[i] != null) daily[day].temps.push(temps[i]);
  });
  const days    = Object.keys(daily).slice(-14);
  const precipV = days.map(d => +daily[d].precip.toFixed(1));
  const tempV   = days.map(d => daily[d].temps.length ? +(daily[d].temps.reduce((a,v)=>a+v,0)/daily[d].temps.length).toFixed(1) : null);

  const alerts = sum.rainfall_alerts || [];

  panel.innerHTML =
    _ldpHeader('🌦', 'Weather & Precipitation', 'Open-Meteo · No API key required', 'Live API', true) +
    _ldpMetrics([
      ['58d Precip', sum.total_precipitation_mm != null ? sum.total_precipitation_mm.toFixed(0)+'mm' : '—', 'total'],
      ['Avg Temp',   sum.avg_temperature_c != null ? sum.avg_temperature_c.toFixed(1)+'°C' : '—', ''],
      ['Next Rain',  sum.next_rain_date || '—', sum.next_rain_mm != null ? sum.next_rain_mm.toFixed(1)+'mm' : ''],
      ['Rain Alerts', alerts.length, alerts.length ? 'active' : 'none'],
    ]) +
    _ldpChartWrap('ldp-weather-chart', '14-day Precipitation + Temperature') +
    (alerts.length > 0 ? `
    <div class="ldp-section-title">⚠ Rainfall Alerts (${alerts.length})</div>
    ${alerts.slice(0, 5).map(a => `
      <div class="ldp-record-row">
        <span style="color:#ef4444">💧</span>
        <span style="color:var(--text-2)">${a.date?.slice(0,10) || 'Recent'}</span>
        <span style="color:var(--text-3)">${a.hourly_precipitation_mm?.toFixed(1) ?? '?'}mm/hr</span>
      </div>`).join('')}` : '') +
    (fc.time ? `
    <div class="ldp-section-title" style="margin-top:10px">7-Day Forecast</div>
    <table class="ldp-table">
      <tr><th>Date</th><th>Precip (mm)</th><th>Max°C</th><th>Wind (km/h)</th></tr>
      ${(fc.time || []).slice(0,7).map((t,i) => `
        <tr>
          <td>${t}</td>
          <td style="color:${(fc.precipitation_sum||[])[i]>15?'#ef4444':(fc.precipitation_sum||[])[i]>5?'#f59e0b':'var(--text-2)'}">${fc.precipitation_sum?.[i]?.toFixed(1) ?? '—'}</td>
          <td>${fc.temperature_2m_max?.[i]?.toFixed(1) ?? '—'}</td>
          <td>${fc.windspeed_10m_max?.[i]?.toFixed(1) ?? '—'}</td>
        </tr>`).join('')}
    </table>` : '');

  // Dual-axis chart: precip bars + temp line
  if (days.length > 0) {
    const ctx = document.getElementById('ldp-weather-chart');
    if (ctx) _layerChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: days.map(d => new Date(d).toLocaleDateString('en',{month:'short',day:'numeric'})),
        datasets: [
          { type:'bar', label:'Precip (mm)', data: precipV, backgroundColor: precipV.map(v => v>15?'rgba(239,68,68,0.7)':v>5?'rgba(245,158,11,0.7)':'rgba(59,130,246,0.5)'), yAxisID:'y', borderRadius:2 },
          { type:'line', label:'Avg Temp (°C)', data: tempV, borderColor:'#f59e0b', borderWidth:1.5, pointRadius:2, tension:0.4, yAxisID:'y2', fill:false },
        ]
      },
      options: {
        responsive:true, interaction:{mode:'index'},
        plugins:{ legend:{ labels:{ color:'#94a3b8', font:{size:9} } } },
        scales:{
          y:  { grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#64748b',font:{size:9}}, title:{display:true,text:'mm',color:'#64748b',font:{size:9}} },
          y2: { position:'right', grid:{display:false}, ticks:{color:'#64748b',font:{size:9}}, title:{display:true,text:'°C',color:'#64748b',font:{size:9}} },
          x:  { grid:{display:false}, ticks:{color:'#94a3b8',font:{size:9}} },
        }
      }
    });
  }

  _setIntChip('weather', 'ok', `${sum.avg_temperature_c?.toFixed(1)??'—'}°C · ${sum.total_precipitation_mm?.toFixed(0)??'—'}mm`);
}

// ── 4. NASA POWER Detail ─────────────────────────────────────────────────────
async function _renderLayerNASA(panel) {
  const data = await apiFetch('/nasa-power');
  if (!data?.daily?.length) {
    panel.innerHTML = _ldpHeader('🚀','NASA POWER','NASA Langley Research Center','Fetching…',false) +
      `<div class="ldp-error">NASA POWER data unavailable. The server may still be fetching it.</div>`;
    return;
  }

  const sum   = data.summary;
  const daily = data.daily;
  const last30 = daily.slice(-30);

  panel.innerHTML =
    _ldpHeader('🚀', 'NASA POWER', 'NASA Langley · Renewable Energy Dataset · Free', 'Live', true) +
    _ldpMetrics([
      ['Total Precip', sum.total_precip_mm != null ? sum.total_precip_mm.toFixed(0)+'mm' : '—', `${sum.period_days}d`],
      ['Max Daily Precip', sum.max_daily_precip_mm != null ? sum.max_daily_precip_mm.toFixed(1)+'mm' : '—', 'peak'],
      ['Avg Solar', sum.avg_solar_wm2 != null ? sum.avg_solar_wm2.toFixed(0)+' W/m²' : '—', 'irradiance'],
      ['Avg Max Temp', sum.avg_temp_max_c != null ? sum.avg_temp_max_c.toFixed(1)+'°C' : '—', '2m height'],
      ['High Rain Days', sum.high_rain_days ?? '—', '>10mm/day'],
      ['Drought Days',   sum.drought_days  ?? '—', '<1mm/day'],
    ]) +
    _ldpChartWrap('ldp-nasa-chart', 'Daily Solar Irradiance & Precipitation', ' (30 days)') +
    `<div class="ldp-section-title">Recent Daily Records</div>
    <table class="ldp-table">
      <tr><th>Date</th><th>Precip mm</th><th>Solar W/m²</th><th>T-max °C</th><th>Wind m/s</th></tr>
      ${last30.slice(-10).reverse().map(d => `
        <tr>
          <td>${d.date}</td>
          <td style="color:${(d.precip_mm||0)>15?'#ef4444':(d.precip_mm||0)>5?'#f59e0b':'var(--text-2)'}">${d.precip_mm?.toFixed(1) ?? '—'}</td>
          <td>${d.solar_wm2?.toFixed(0) ?? '—'}</td>
          <td>${d.t2m_max_c?.toFixed(1) ?? '—'}</td>
          <td>${d.wind_ms?.toFixed(1) ?? '—'}</td>
        </tr>`).join('')}
    </table>`;

  const solarV  = last30.map(d => d.solar_wm2);
  const precipV = last30.map(d => d.precip_mm);
  const labels  = last30.map(d => d.date.slice(5));

  const ctx = document.getElementById('ldp-nasa-chart');
  if (ctx) _layerChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type:'line', label:'Solar (W/m²)', data:solarV, borderColor:'#f59e0b', borderWidth:1.5, pointRadius:0, tension:0.4, yAxisID:'y2', fill:false },
        { type:'bar',  label:'Precip (mm)', data:precipV, backgroundColor:'rgba(59,130,246,0.55)', yAxisID:'y', borderRadius:2 },
      ]
    },
    options: {
      responsive:true, interaction:{mode:'index'},
      plugins:{ legend:{ labels:{color:'#94a3b8',font:{size:9}} } },
      scales:{
        y:  { grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#64748b',font:{size:9}}, title:{display:true,text:'mm',color:'#64748b',font:{size:9}} },
        y2: { position:'right', grid:{display:false}, ticks:{color:'#64748b',font:{size:9}}, title:{display:true,text:'W/m²',color:'#64748b',font:{size:9}} },
        x:  { grid:{display:false}, ticks:{color:'#94a3b8',font:{size:9},maxTicksLimit:10} },
      }
    }
  });

  _setIntChip('nasa', 'ok', `${sum.total_precip_mm?.toFixed(0)??'—'}mm · ${sum.avg_solar_wm2?.toFixed(0)??'—'}W/m²`);
  _setMeta('nasa', `30d: ${sum.total_precip_mm?.toFixed(0)??'—'}mm precip · ${sum.avg_solar_wm2?.toFixed(0)??'—'} W/m² solar avg`);
  _setBadge('nasa', 'success', 'Live');
}

// ── 5. PVGIS Solar Resource Detail ──────────────────────────────────────────
async function _renderLayerPVGIS(panel) {
  const data = await apiFetch('/pvgis/monthly');
  if (!data?.monthly?.length) {
    panel.innerHTML = _ldpHeader('☀️','PVGIS Solar Resource','EU JRC · PVGIS-SARAH3','Fetching…',false) +
      `<div class="ldp-error">PVGIS data unavailable.</div>`;
    return;
  }

  const monthly = data.monthly;
  const annualHh = monthly.reduce((s, m) => s + (m.Hh_kwh_m2 || 0), 0);
  const peakMonth = monthly.reduce((max, m) => (m.Hh_kwh_m2 || 0) > (max.Hh_kwh_m2 || 0) ? m : max, monthly[0]);

  panel.innerHTML =
    _ldpHeader('☀️', 'PVGIS Solar Resource', 'EU JRC · PVGIS-SARAH3 · 43.56°N 25.59°E', 'Live (cached 24h)', true) +
    _ldpMetrics([
      ['Annual Irrad.',  annualHh.toFixed(0)+' kWh/m²', 'horizontal'],
      ['Peak Month',     peakMonth?.month || '—', (peakMonth?.Hh_kwh_m2||0).toFixed(0)+' kWh/m²'],
      ['Site Lat',       '43.56°N', 'Tsenovo'],
      ['Site Lon',       '25.59°E', 'Bulgaria'],
    ]) +
    _ldpChartWrap('ldp-pvgis-chart', 'Monthly Horizontal Irradiance (kWh/m²)') +
    `<div class="ldp-section-title">Monthly Data</div>
    <table class="ldp-table">
      <tr><th>Month</th><th>Hh kWh/m²</th><th>Direct</th><th>Diffuse</th><th>Avg T °C</th></tr>
      ${monthly.map(m => `
        <tr>
          <td>${m.month}</td>
          <td style="color:#f59e0b">${m.Hh_kwh_m2?.toFixed(1) ?? '—'}</td>
          <td style="color:var(--text-3)">${m.H_direct?.toFixed(1) ?? '—'}</td>
          <td style="color:var(--text-3)">${m.H_diffuse?.toFixed(1) ?? '—'}</td>
          <td>${m.T2m_avg?.toFixed(1) ?? '—'}</td>
        </tr>`).join('')}
    </table>`;

  const ctx = document.getElementById('ldp-pvgis-chart');
  if (ctx) _layerChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthly.map(m => m.month),
      datasets: [{
        label: 'Hh (kWh/m²)',
        data: monthly.map(m => m.Hh_kwh_m2),
        backgroundColor: monthly.map(m => {
          const v = m.Hh_kwh_m2 || 0;
          return v > 180 ? 'rgba(245,158,11,0.85)' : v > 100 ? 'rgba(245,158,11,0.55)' : 'rgba(245,158,11,0.3)';
        }),
        borderColor: '#f59e0b88', borderWidth: 1, borderRadius: 3,
      }]
    },
    options: {
      responsive:true, plugins:{legend:{display:false}},
      scales:{
        y:{ grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#64748b',font:{size:9}} },
        x:{ grid:{display:false}, ticks:{color:'#94a3b8',font:{size:9}} }
      }
    }
  });

  _setIntChip('pvgis', 'ok', `${annualHh.toFixed(0)} kWh/m²/yr`);
  _setMeta('pvgis', `Annual: ${annualHh.toFixed(0)} kWh/m²/yr · Peak: ${peakMonth?.month}`);
  _setBadge('pvgis', 'success', 'Live');
}

// ── 6. SoilGrids Detail ──────────────────────────────────────────────────────
async function _renderLayerSoil(panel) {
  const data = await apiFetch('/soil');
  const soil = data?.properties || _lastDash?.soil || {};
  const health = data?.health || _lastDash?.soil_health || {};

  const _prop = (key, divisor = 10, unit = '') => {
    const v = soil[key];
    return v != null ? (v / divisor).toFixed(divisor > 1 ? 1 : 0) + unit : '—';
  };

  panel.innerHTML =
    _ldpHeader('🌱', 'SoilGrids ISRIC', 'ISRIC World Soil Information · REST API · No key', `Health ${health.soil_health_score ?? '—'}/100`, (health.soil_health_score ?? 0) > 50) +
    _ldpMetrics([
      ['Soil Health', (health.soil_health_score ?? '—') + '/100', ''],
      ['SOC', _prop('soc', 10, '‰'), 'organic carbon'],
      ['pH (H₂O)', _prop('phh2o', 10, ''), ''],
      ['Clay', _prop('clay', 10, '%'), ''],
      ['Silt', _prop('silt', 10, '%'), ''],
      ['Sand', _prop('sand', 10, '%'), ''],
    ]) +
    _ldpChartWrap('ldp-soil-chart', 'Soil Texture Profile') +
    `<div class="ldp-section-title">All Properties</div>
    <table class="ldp-table">
      <tr><th>Property</th><th>Value</th><th>Unit</th></tr>
      ${[
        ['SOC', _prop('soc',10,''), 'g/kg (‰)'],
        ['pH (H₂O)', _prop('phh2o',10,''), ''],
        ['Clay', _prop('clay',10,''), '%'],
        ['Silt', _prop('silt',10,''), '%'],
        ['Sand', _prop('sand',10,''), '%'],
        ['Bulk Density', _prop('bdod',100,''), 'g/cm³'],
        ['CEC', _prop('cec',10,''), 'cmol/kg'],
        ['Nitrogen', _prop('nitrogen',100,''), 'g/kg'],
      ].map(([lbl,val,unit]) => `<tr><td>${lbl}</td><td style="color:var(--text-1)">${val}</td><td style="color:var(--text-3)">${unit}</td></tr>`).join('')}
    </table>`;

  // Doughnut: texture
  const clay = soil.clay != null ? soil.clay / 10 : null;
  const silt = soil.silt != null ? soil.silt / 10 : null;
  const sand = soil.sand != null ? soil.sand / 10 : null;
  if (clay != null) {
    const ctx = document.getElementById('ldp-soil-chart');
    if (ctx) _layerChartInst = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Clay','Silt','Sand'],
        datasets: [{ data:[clay,silt,sand], backgroundColor:['#ef444488','#f59e0b88','#22c55e88'], borderColor:['#ef4444','#f59e0b','#22c55e'], borderWidth:1 }]
      },
      options: { responsive:true, plugins:{ legend:{ labels:{color:'#94a3b8',font:{size:9}} } } }
    });
  }

  _setIntChip('soil', 'ok', `pH ${_prop('phh2o',10)} · SOC ${_prop('soc',10)}‰`);
}

// ── 7. GBIF Biodiversity Detail ──────────────────────────────────────────────
async function _renderLayerGBIF(panel) {
  const [stats, speciesData] = await Promise.all([
    apiFetch('/biodiversity'),
    apiFetch('/biodiversity/species'),
  ]);

  const shannon    = stats?.shannon_h;
  const richness   = stats?.species_richness ?? speciesData?.count ?? 0;
  const invasive   = stats?.invasive_risk ?? 'Low';
  const groups     = stats?.groups || {};
  const species    = (speciesData?.species || []).slice(0, 20);

  panel.innerHTML =
    _ldpHeader('🦋', 'GBIF Biodiversity', 'Global Biodiversity Information Facility · Free', `${richness} species`, richness > 0) +
    _ldpMetrics([
      ['Shannon H′', shannon != null ? shannon.toFixed(2) : '—', 'diversity index'],
      ['Species', richness, 'total observed'],
      ['Invasive Risk', invasive, ''],
      ['Radius', '5 km', 'from site'],
    ]) +
    _ldpChartWrap('ldp-gbif-chart', 'Occurrences by Taxonomic Group') +
    `<div class="ldp-section-title">Species Observed (sample)</div>
    <table class="ldp-table">
      <tr><th>Scientific Name</th><th>Kingdom</th><th>Count</th></tr>
      ${species.map(s => `
        <tr>
          <td style="font-style:italic">${s.name || s.species || '—'}</td>
          <td style="color:var(--text-3)">${s.kingdom || '—'}</td>
          <td>${s.count ?? s.occurrences ?? 1}</td>
        </tr>`).join('')}
    </table>`;

  // Bar chart: occurrences by group
  const groupEntries = Object.entries(groups).filter(([,v]) => v > 0);
  if (groupEntries.length > 0) {
    const ctx = document.getElementById('ldp-gbif-chart');
    if (ctx) _layerChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: groupEntries.map(([k]) => k),
        datasets: [{ data: groupEntries.map(([,v]) => v), backgroundColor:'rgba(34,197,94,0.5)', borderColor:'#22c55e', borderWidth:1, borderRadius:3 }]
      },
      options: {
        indexAxis: 'y', responsive:true, plugins:{legend:{display:false}},
        scales:{ x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b',font:{size:9}}}, y:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:9}}} }
      }
    });
  }

  _setIntChip('gbif', 'ok', `${richness} spp · H′ ${shannon?.toFixed(2)??'—'}`);
}

// ── 8. Soil Lab Carbon Records Detail ────────────────────────────────────────
async function _renderLayerCarbon(panel) {
  const data = await apiFetch('/carbon/history');
  if (!data?.records?.length) {
    panel.innerHTML = _ldpHeader('⚗️','Soil Lab Records','On-site sampling · JSON store','No data',false) +
      `<div class="ldp-error">No soil lab records found. Use the Settings → Upload tab to add samples.</div>`;
    return;
  }

  const records = data.records.slice().sort((a,b) =>
    (a.timestamp||a.created_at||'').localeCompare(b.timestamp||b.created_at||''));
  const latest  = records[records.length-1];
  const seq     = data.sequestration_rate;
  const trend   = seq?.trend || 'stable';
  const rate    = seq?.annual_sequestration_t_per_ha;

  // Zone 3 only records for chart
  const z3recs  = records.filter(r => r.zone === 3 || r.zone == null);

  panel.innerHTML =
    _ldpHeader('⚗️', 'Soil Lab Records', 'On-site quarterly sampling · JSON flat-file store', `${records.length} records · ${trend}`, trend === 'increasing') +
    _ldpMetrics([
      ['Latest Stock', latest?.carbon_stock_t_per_ha?.toFixed(2)??'—', 'tC/ha'],
      ['Latest SOM',   latest?.som_pct != null ? latest.som_pct.toFixed(1)+'%' : '—', ''],
      ['Seq. Rate',    rate != null ? (rate>0?'+':'')+rate.toFixed(3)+' tC/ha/yr' : '—', trend],
      ['Period',       seq?.period_years?.toFixed(1)??'—', 'years tracked'],
      ['Records',      records.length, 'total'],
      ['Zones',        [...new Set(records.map(r=>r.zone))].length, 'monitored'],
    ]) +
    _ldpChartWrap('ldp-carbon-chart', 'Zone 3 Carbon Stock Over Time') +
    `<div class="ldp-section-title">All Records</div>
    <table class="ldp-table">
      <tr><th>Date</th><th>Zone</th><th>SOM%</th><th>BD g/cm³</th><th>tC/ha</th><th>tCO₂/ha</th></tr>
      ${records.slice().reverse().slice(0,15).map(r => `
        <tr>
          <td>${(r.sampling_date||r.timestamp||'').slice(0,10)}</td>
          <td>Z${r.zone}</td>
          <td>${r.som_pct?.toFixed(1)??'—'}%</td>
          <td>${r.bulk_density_g_cm3?.toFixed(2)??'—'}</td>
          <td style="color:#22c55e">${r.carbon_stock_t_per_ha?.toFixed(2)??'—'}</td>
          <td style="color:var(--text-3)">${r.co2_equivalent_t_per_ha?.toFixed(2)??'—'}</td>
        </tr>`).join('')}
    </table>`;

  // Line chart: Z3 carbon stock over time
  if (z3recs.length > 0) {
    const ctx = document.getElementById('ldp-carbon-chart');
    if (ctx) _layerChartInst = new Chart(ctx, {
      type: 'line',
      data: {
        labels: z3recs.map(r => (r.sampling_date||r.timestamp||'').slice(0,7)),
        datasets: [{
          label: 'Carbon Stock (tC/ha)',
          data:  z3recs.map(r => r.carbon_stock_t_per_ha),
          borderColor: '#22c55e', borderWidth: 2,
          pointRadius: 4, pointBackgroundColor: '#22c55e',
          fill: { target:'origin', above:'rgba(34,197,94,0.08)' }, tension:0.3,
        }]
      },
      options: {
        responsive:true, plugins:{legend:{display:false}},
        scales:{
          y:{ grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#64748b',font:{size:9}} },
          x:{ grid:{display:false}, ticks:{color:'#94a3b8',font:{size:9}} }
        }
      }
    });
  }

  _setIntChip('carbon', 'ok', `${latest?.carbon_stock_t_per_ha?.toFixed(2)??'—'} tC/ha`);
  _setMeta('carbon', `${records.length} records · Latest: ${latest?.carbon_stock_t_per_ha?.toFixed(2)??'—'} tC/ha · SOM ${latest?.som_pct?.toFixed(1)??'—'}%`);
  _setBadge('carbon', 'success', 'Live');
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE BACKEND DATA — functions that surface previously unused API endpoints
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Carbon Trajectory — real /api/carbon/history data ─────────────────────
async function fetchAndUpdateCarbonTrajectory() {
  try {
    const data = await apiFetch('/carbon/history');
    if (!data || !data.records || data.records.length === 0) return;

    const chart = window._chartInst?.carbonTrajectory;
    if (!chart) return;

    // Build year-labelled points from records
    const records = data.records.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    const labels = records.map(r => r.created_at ? r.created_at.slice(0, 7) : '—');
    const values = records.map(r => parseFloat(r.carbon_stock_t_per_ha) || 0);

    // Replace first dataset (Actual) with real data
    chart.data.labels = labels.length > 0 ? labels : chart.data.labels;
    if (values.length > 0) {
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].label = 'Actual Carbon Stock (API)';
    }
    chart.update('none');

    // Update sequestration rate display
    const seqRate = data.sequestration_rate;
    let seqEl = document.getElementById('live-seq-rate');
    if (!seqEl) {
      seqEl = document.createElement('div');
      seqEl.id = 'live-seq-rate';
      seqEl.style.cssText = 'font-size:11px;color:var(--green);padding:4px 0;font-family:IBM Plex Mono,monospace';
      document.querySelector('#carbon-trajectory-chart')?.parentElement?.appendChild(seqEl);
    }
    if (seqRate != null) {
      seqEl.textContent = `↑ Sequestration rate: ${seqRate > 0 ? '+' : ''}${seqRate.toFixed(2)} tC/ha/yr`;
    }
  } catch (e) { /* silently fail, static chart remains */ }
}

// ── 2. Rainfall Chart — real 72h hourly data from /api/weather ───────────────
async function fetchAndUpdateRainfallChart() {
  try {
    const data = await apiFetch('/weather');
    if (!data?.historical) return;

    const chart = window._chartInst?.rainfall;
    if (!chart) return;

    const times = data.historical.time || [];
    const precip = data.historical.precipitation || [];

    // Downsample to daily totals (group by day)
    const daily = {};
    times.forEach((t, i) => {
      const day = t.slice(0, 10);
      daily[day] = (daily[day] || 0) + (precip[i] || 0);
    });

    const days = Object.keys(daily).slice(-14);  // last 14 days
    const vals = days.map(d => parseFloat(daily[d].toFixed(1)));

    chart.data.labels = days.map(d => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    });
    chart.data.datasets[0].data = vals;
    chart.data.datasets[0].backgroundColor = vals.map(v =>
      v > 15 ? 'rgba(239,68,68,0.75)' : v > 8 ? 'rgba(245,158,11,0.75)' : 'rgba(59,130,246,0.5)'
    );
    chart.update('none');

    // Update rainfall summary stats
    const rainEl   = document.querySelector('.rain-mm');
    const statusEl = document.querySelector('.rain-status');
    const maxDaily = Math.max(...vals, 0);
    if (rainEl)   rainEl.textContent = maxDaily.toFixed(1) + 'mm';
    if (statusEl) {
      statusEl.textContent = maxDaily > 15 ? 'High' : maxDaily > 8 ? 'Moderate' : 'Low';
      statusEl.className   = 'rain-status ' + (maxDaily > 15 ? 'danger-text' : maxDaily > 8 ? 'warning-text' : 'success-text');
    }

    // Populate 3-day forecast container in the alerts rainfall card
    const fcContainer = document.getElementById('forecast-days-container');
    if (fcContainer && data.summary?.forecast_days?.length > 0) {
      const fcs = data.summary.forecast_days.slice(0, 4);
      fcContainer.innerHTML = fcs.map(([dateStr, mm], i) => {
        const d = new Date(dateStr);
        const label = i === 0 ? 'Today' : `+${i}d`;
        const icon  = mm > 10 ? '🌧️' : mm > 3 ? '🌦️' : mm > 0 ? '🌥️' : '⛅';
        const level = mm > 10 ? 'Heavy' : mm > 3 ? 'Moderate' : mm > 0 ? 'Light' : 'Dry';
        const cls   = mm > 10 ? 'danger-text' : mm > 3 ? 'warning-text' : 'success-text';
        return `<div class="forecast-day"><span>${label}</span><span>${icon}</span><span class="${cls}">${level}</span></div>`;
      }).join('');
    } else if (fcContainer && fcContainer.children.length <= 1) {
      // Derive rough forecast from last 4 days of historical (as placeholder)
      const lastDays = days.slice(-4);
      const lastVals = vals.slice(-4);
      fcContainer.innerHTML = lastDays.map((d, i) => {
        const mm = lastVals[i] || 0;
        const dt = new Date(d);
        const label = dt.toLocaleDateString('en', { weekday: 'short' });
        const icon  = mm > 10 ? '🌧️' : mm > 3 ? '🌦️' : '⛅';
        const level = mm > 10 ? 'Heavy' : mm > 3 ? 'Moderate' : 'Low';
        const cls   = mm > 10 ? 'danger-text' : mm > 3 ? 'warning-text' : 'success-text';
        return `<div class="forecast-day"><span>${label}</span><span>${icon}</span><span class="${cls}">${level}</span></div>`;
      }).join('');
    }
  } catch (e) {}
}

// ── 3. NDVI All Zones — real /api/ndvi/all-zones data ────────────────────────
async function fetchAndUpdateNDVIAllZones() {
  try {
    const data = await apiFetch('/ndvi/all-zones');
    if (!data) return;

    const chart = window._chartInst?.ndviAllZones;
    if (!chart) return;

    // Inject live NDVI as rightmost data point in each zone series
    chart.data.datasets.forEach(ds => {
      const zoneId = parseInt(ds.label.replace('Z', ''));
      const zoneData = data[zoneId];
      if (zoneData?.ndvi_mean != null) {
        const arr = [...ds.data];
        arr[arr.length - 1] = zoneData.ndvi_mean;
        ds.data = arr;
        // Annotate live source
        if (zoneData.source && zoneData.source !== 'mock') {
          ds.label = `Z${zoneId} ●`;
        }
      }
    });
    chart.update('none');
  } catch (e) {}
}

// ── 4. Species list — real GBIF /api/biodiversity/species ────────────────────
async function fetchAndUpdateSpeciesList() {
  try {
    const data = await apiFetch('/biodiversity/species');
    if (!data?.species || data.species.length === 0) return;

    const container = document.getElementById('bird-list');
    if (!container) return;

    // Clear static list
    container.innerHTML = '';

    // Group by class/type — backend returns GBIF occurrence objects
    const birds = data.species.filter(s => s.class === 'Aves' || (s.taxonRank && s.kingdom === 'Animalia'));
    const plants = data.species.filter(s => s.kingdom === 'Plantae');
    const all = data.species.slice(0, 20);  // show top 20

    all.forEach(s => {
      const name = s.species || s.canonicalName || s.scientificName || 'Unknown';
      const common = s.vernacularName || '';
      const count = s.occurrenceCount || s.count || '—';
      const kingdom = s.kingdom || '';
      const icon = kingdom === 'Aves' || s.class === 'Aves' ? '🐦'
        : kingdom === 'Plantae' ? '🌿'
        : kingdom === 'Insecta' ? '🦋'
        : '🔬';

      const row = document.createElement('div');
      row.className = 'bird-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <span style="font-size:15px">${icon}</span>
        <div class="bird-name">
          <div style="font-size:11px;font-weight:600;color:#f0f4f8">${common || name}</div>
          <div style="font-size:9px;font-style:italic;color:#64748b">${name}</div>
        </div>
        <span class="bird-count">${count}</span>
        <span style="font-size:9px;color:var(--text-3)">${s.class || kingdom || ''}</span>
      `;
      row.addEventListener('click', () => openModal(`Species: ${name}`, `
        <div class="detail-modal-grid">
          ${_dmStat('Scientific Name', name, 'GBIF taxonomy')}
          ${_dmStat('Common Name', common || '—', '')}
          ${_dmStat('Kingdom', s.kingdom || '—', '')}
          ${_dmStat('Class', s.class || '—', '')}
          ${_dmStat('Occurrences', count, 'GBIF records')}
          ${_dmStat('Phylum', s.phylum || '—', '')}
        </div>
        <div class="modal-actions">
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>
      `));
      container.appendChild(row);
    });

    // Update species count elements
    const specEl = document.getElementById('species-total');
    const totEl  = document.getElementById('bio-total-species');
    if (data.count != null) {
      if (specEl) specEl.textContent = data.count;
      if (totEl)  totEl.textContent  = data.count;
    }
  } catch (e) {}
}

// ── 5. Smart Pin status — real /api/smart-pin/status ─────────────────────────
async function fetchAndUpdatePinStatus() {
  try {
    const data = await apiFetch('/smart-pin/status');
    if (!data) return;

    const container = document.getElementById('pins-status-grid');
    if (!container) return;

    container.innerHTML = '';
    const pins = data.pins || [];
    const watcherRunning = data.watcher?.running;

    // Watcher status badge
    let watcherBadge = document.getElementById('pin-watcher-status');
    if (!watcherBadge) {
      watcherBadge = document.createElement('div');
      watcherBadge.id = 'pin-watcher-status';
      watcherBadge.style.cssText = 'font-size:11px;padding:6px 0 10px;color:var(--text-2)';
      container.parentElement?.insertBefore(watcherBadge, container);
    }
    watcherBadge.innerHTML = `
      <span style="color:${watcherRunning ? 'var(--green)' : 'var(--yellow)'}">⬤</span>
      Watcher: ${watcherRunning ? 'Running' : 'Stopped'} ·
      ${data.watcher?.images_in_folder ?? '?'} images in folder ·
      Path: <code style="font-size:9px;color:var(--text-3)">${data.watcher?.timelapse_path ?? '—'}</code>
    `;

    pins.forEach(pin => {
      const card = document.createElement('div');
      card.className = 'pin-status-card';
      const online = pin.status !== 'inactive';
      card.innerHTML = `
        <div class="pin-status-id">${pin.id}</div>
        <div class="pin-status-dot ${online ? 'online' : 'offline'}"></div>
        <div class="pin-status-label" style="font-size:9px">${pin.zone ? 'Z' + pin.zone : ''}</div>
        <div style="font-size:8px;color:var(--text-3);text-align:center">${pin.status || 'active'}</div>
      `;
      container.appendChild(card);
    });

    if (pins.length === 0) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:11px;padding:8px">No pins configured</div>';
    }
  } catch (e) {}
}

// ── 6. Smart Pin history — /api/smart-pin/history ────────────────────────────
async function fetchAndRenderPinHistory() {
  try {
    const data = await apiFetch('/smart-pin/history?limit=10');
    if (!data || data.length === 0) return;

    let container = document.getElementById('pin-history-panel');
    if (!container) return;

    container.innerHTML = '';
    data.forEach(entry => {
      const sev = entry.erosion_severity || 'unknown';
      const color = sev === 'severe' || sev === 'high' ? '#ef4444' : sev === 'moderate' ? '#f59e0b' : '#22c55e';
      const ts = entry.captured_at ? new Date(entry.captured_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const row = document.createElement('div');
      row.className = 'pin-history-row';
      row.style.cssText = 'display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:11px;cursor:pointer';
      row.innerHTML = `
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block"></span>
        <span style="flex:1;color:var(--text-2)">${ts}</span>
        <span style="color:${color};font-weight:600;min-width:60px">${sev}</span>
        <span style="color:var(--text-3);font-family:IBM Plex Mono,monospace">${entry.vegetation_cover_percent != null ? entry.vegetation_cover_percent + '% veg' : ''}</span>
        <span style="font-size:9px;color:var(--text-3)">${entry.pin_id || entry.zone ? (entry.pin_id || '') + (entry.zone ? ' Z' + entry.zone : '') : ''}</span>
      `;
      row.addEventListener('click', () => openPinModal(entry.pin_id || 'PIN', entry));
      container.appendChild(row);
    });
  } catch (e) {}
}

// ── 7. AI Risk Score — /api/ai/risk-score ────────────────────────────────────
async function runAIRiskScore(zoneId = 3) {
  const btn = document.getElementById('btn-ai-risk');
  if (btn) { btn.disabled = true; btn.textContent = 'Computing…'; }

  try {
    const dash = _lastDash || {};
    const params = {
      precipitation_mm:    dash.weather?.total_precipitation_mm ?? 87.8,
      ndvi:                dash.ndvi?.ndvi_mean ?? 0.29,
      vegetation_cover_pct: 24,
      slope_deg:           12.0,
      soil_type:           'Silty clay loam (Chernozem)',
      zone_id:             zoneId,
    };
    const result = await apiFetch('/ai/risk-score', { method: 'POST', body: JSON.stringify(params) });
    if (!result) throw new Error('No response');

    const score = result.risk_score;
    const level = result.risk_level || (score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low');
    const factors = (result.contributing_factors || []).slice(0, 4);
    const actions = (result.recommended_actions || []).slice(0, 3);

    // Update gauge with new score
    updateGauge(score);

    openModal(`AI Risk Score — Zone ${zoneId}`, `
      <div class="modal-zone-hero" style="border-left:4px solid ${score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#22c55e'}">
        <div class="modal-zone-badge" style="background:${score >= 70 ? '#ef444422' : '#f59e0b22'};color:${score >= 70 ? '#ef4444' : '#f59e0b'}">${level.toUpperCase()} RISK — ${score}/100</div>
      </div>
      ${factors.length ? `<div class="dm-section-title">Gemini AI Contributing Factors</div>${factors.map(f => `<div class="dm-row"><span>→</span><strong>${f}</strong></div>`).join('')}` : ''}
      ${actions.length ? `<div class="dm-section-title">Recommended Actions</div>${actions.map(a => `<div class="dm-row" style="align-items:flex-start"><span>•</span><span style="color:var(--text-2)">${a}</span></div>`).join('')}` : ''}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>
    `);
    showToast(`✅ AI Risk Score computed: ${score}/100 (${level})`);
  } catch (err) {
    showToast('⚠ AI risk score failed — ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Compute AI Risk Score'; }
  }
}

// ── 8. AI Biodiversity Analysis — /api/ai/biodiversity ───────────────────────
async function runAIBiodiversity() {
  const btn = document.getElementById('btn-ai-bio');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }

  try {
    const result = await apiFetch('/ai/biodiversity', { method: 'POST' });
    if (!result) throw new Error('No response');

    const h = result.shannon_h ?? result.h_prime;
    const rich = result.species_richness ?? result.speciesRichness;
    const dominant = result.dominant_species || [];
    const eco = result.ecological_assessment || '';
    const notes = result.conservation_notes || '';

    // Update shannon display
    const shannonEl = document.querySelector('.shannon-svg text');
    if (shannonEl && h != null) shannonEl.textContent = h.toFixed(2);

    openModal('AI Biodiversity Analysis — Gemini 2.0', `
      <div class="detail-modal-grid">
        ${_dmStat("Shannon H′", h != null ? h.toFixed(2) : '—', 'AI computed', '#22c55e')}
        ${_dmStat('Species Richness', rich ?? '—', 'GBIF records')}
      </div>
      ${dominant.length ? `<div class="dm-section-title">Dominant Species</div>${dominant.slice(0, 5).map(s => `<div class="dm-row"><span>→</span><strong>${s}</strong></div>`).join('')}` : ''}
      ${eco ? `<div class="dm-section-title">Ecological Assessment</div><p style="font-size:12px;color:var(--text-2);line-height:1.6;padding:8px 0">${eco}</p>` : ''}
      ${notes ? `<div class="dm-section-title">Conservation Notes</div><p style="font-size:12px;color:var(--text-2);line-height:1.6;padding:8px 0">${notes}</p>` : ''}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>
    `);
    showToast('✅ AI Biodiversity analysis complete');
  } catch (err) {
    showToast('⚠ AI biodiversity failed — ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI Biodiversity Analysis'; }
  }
}

// ── 9. AI Change Detection — /api/ai/change-detection ───────────────────────
async function runAIChangeDetection() {
  const btn = document.getElementById('btn-ai-change');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }

  try {
    const imgs = _zonesPinImages || [];
    if (imgs.length < 2) {
      showToast('⚠ Need at least 2 timelapse images for change detection');
      return;
    }

    // Fetch the two images as blobs and upload as before/after
    const [beforeResp, afterResp] = await Promise.all([
      fetch(imgs[Math.min(imgs.length - 1, 5)].url),
      fetch(imgs[0].url)
    ]);
    const [beforeBlob, afterBlob] = await Promise.all([beforeResp.blob(), afterResp.blob()]);

    const form = new FormData();
    form.append('before', beforeBlob, imgs[Math.min(imgs.length - 1, 5)].filename);
    form.append('after',  afterBlob,  imgs[0].filename);

    const resp = await fetch('http://localhost:8000/api/ai/change-detection', { method: 'POST', body: form });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();

    const vegChange = result.vegetation_change_pct;
    const progression = result.erosion_progression || '—';
    const newFeatures = result.new_features || [];
    const resolved = result.resolved_features || [];
    const summary = result.change_summary || '';
    const color = progression === 'improving' ? '#22c55e' : progression === 'worsening' ? '#ef4444' : '#f59e0b';

    openModal('AI Change Detection — Gemini Vision', `
      <div class="modal-zone-hero" style="border-left:4px solid ${color}">
        <div class="modal-zone-badge" style="background:${color}22;color:${color}">${progression.toUpperCase()}</div>
      </div>
      <div class="detail-modal-grid">
        ${_dmStat('Vegetation Change', vegChange != null ? (vegChange > 0 ? '+' : '') + vegChange + '%' : '—', 'vs baseline', vegChange > 0 ? '#22c55e' : '#ef4444')}
        ${_dmStat('Progression', progression, 'Erosion trend')}
        ${_dmStat('Soil Color Change', result.soil_color_change || '—', '')}
      </div>
      ${newFeatures.length ? `<div class="dm-section-title">New erosion features detected</div>${newFeatures.map(f => `<div class="dm-row"><span style="color:#ef4444">+</span><strong>${f}</strong></div>`).join('')}` : ''}
      ${resolved.length ? `<div class="dm-section-title">Resolved features</div>${resolved.map(f => `<div class="dm-row"><span style="color:#22c55e">✓</span><strong>${f}</strong></div>`).join('')}` : ''}
      ${summary ? `<div class="dm-section-title">Summary</div><p style="font-size:12px;color:var(--text-2);line-height:1.6;padding:8px 0">${summary}</p>` : ''}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>
    `);
    showToast('✅ AI change detection complete');
  } catch (err) {
    showToast('⚠ AI change detection failed — ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI Change Detection'; }
  }
}

// ── 10. Upload history — /api/uploads ────────────────────────────────────────
async function fetchAndRenderUploadHistory() {
  try {
    const data = await apiFetch('/uploads?limit=20');
    if (!data) return;

    const container = document.getElementById('upload-history-list');
    if (!container) return;

    const items = Array.isArray(data) ? data : (data.records || data.items || []);
    if (items.length === 0) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:11px;padding:8px">No uploads yet</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      const ts = item.created_at ? new Date(item.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const icon = item.type === 'photo' ? '📷' : item.type === 'soil' ? '🌱' : item.type === 'bird' ? '🐦' : '📄';
      return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">
        <span>${icon}</span>
        <span style="flex:1;color:var(--text-2)">${item.filename || item.type}</span>
        <span style="color:var(--text-3)">Z${item.zone ?? '?'}</span>
        <span style="font-size:9px;color:var(--text-3)">${ts}</span>
      </div>`;
    }).join('');
  } catch (e) {}
}

// ── 11. Photo Upload → backend AI analysis ────────────────────────────────────
// ── Photo upload — drag/drop helpers ──────────────────────────────────────────
function photoFileSelected(input) {
  const file = input.files[0];
  if (file) _setPhotoPreview(file);
}

function photoDrop(event) {
  event.preventDefault();
  const dz = document.getElementById('photo-dropzone');
  if (dz) dz.classList.remove('drag-over');
  const file = event.dataTransfer?.files[0];
  if (!file || !file.type.startsWith('image/')) { showToast('⚠ Please drop an image file'); return; }
  // Inject into the file input so submitPhotoForAnalysis can read it
  const input = document.getElementById('upload-photo-file');
  if (input) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }
  _setPhotoPreview(file);
}

function _setPhotoPreview(file) {
  const inner   = document.getElementById('photo-dropzone-inner');
  const preview = document.getElementById('photo-preview-img');
  if (inner)   inner.style.display   = 'none';
  if (preview) {
    preview.src    = URL.createObjectURL(file);
    preview.style.display = 'block';
  }
  // Re-enable analyse button
  const btn = document.getElementById('photo-analyze-btn');
  if (btn) btn.disabled = false;
}

function _photoProgress(phase) {
  const wrap  = document.getElementById('photo-progress-wrap');
  const bar   = document.getElementById('photo-progress-bar');
  const label = document.getElementById('photo-progress-label');
  const btn   = document.getElementById('photo-analyze-btn');
  const btnTxt = document.getElementById('photo-analyze-btn-text');

  if (phase === 'start') {
    if (wrap) wrap.style.display = 'flex';
    if (bar)  { bar.style.width = '0%'; bar.classList.add('progress-anim'); }
    if (label) label.textContent = 'Uploading photo…';
    if (btn)  btn.disabled = true;
    if (btnTxt) btnTxt.textContent = '⏳ Analyzing…';
    // Simulate progress: 0→40% quickly (upload), then stall at 70% (AI thinking)
    let pct = 0;
    bar._timer = setInterval(() => {
      pct += pct < 40 ? 4 : pct < 70 ? 1 : 0.2;
      if (bar) bar.style.width = Math.min(pct, 92) + '%';
      if (label && pct > 40) label.textContent = '🤖 Gemini is analyzing…';
    }, 120);
  } else if (phase === 'done') {
    if (bar?._timer) clearInterval(bar._timer);
    if (bar)  { bar.style.width = '100%'; bar.classList.remove('progress-anim'); }
    if (label) label.textContent = '✅ Analysis complete';
    if (btn)  btn.disabled = false;
    if (btnTxt) btnTxt.textContent = '🤖 Analyze with AI';
    setTimeout(() => { if (wrap) wrap.style.display = 'none'; }, 2000);
  } else if (phase === 'error') {
    if (bar?._timer) clearInterval(bar._timer);
    if (bar)  { bar.style.width = '100%'; bar.style.background = '#ef4444'; }
    if (label) label.textContent = '⚠ Analysis failed';
    if (btn)  btn.disabled = false;
    if (btnTxt) btnTxt.textContent = '🤖 Analyze with AI';
    setTimeout(() => { if (wrap) { wrap.style.display = 'none'; if (bar) bar.style.background = ''; } }, 3000);
  }
}

async function submitPhotoForAnalysis() {
  const fileInput = document.getElementById('upload-photo-file');
  const file      = fileInput?.files[0];
  if (!file) { showToast('📷 Please select or drop a photo first'); return; }

  const zone  = parseInt(document.getElementById('upload-photo-zone')?.value) || 3;
  const pinId = document.getElementById('upload-photo-pin')?.value || 'manual';
  const notes = document.getElementById('upload-photo-notes')?.value || '';

  _photoProgress('start');
  await handlePhotoUpload(file, zone, pinId, notes);
}

async function handlePhotoUpload(file, zone, pinId, notes) {
  const result = await uploadMonitoringPhoto(file, zone, pinId, notes);
  _photoProgress(result?.analysis ? 'done' : 'error');

  const emptyEl   = document.getElementById('photo-result-empty');
  const contentEl = document.getElementById('photo-result-content');

  if (result?.analysis) {
    const a     = result.analysis;
    const sev   = a.erosion_severity || 'unknown';
    const sevUC = sev.charAt(0).toUpperCase() + sev.slice(1);
    const color = sev === 'severe' || sev === 'high' ? '#ef4444'
                : sev === 'moderate' ? '#f59e0b'
                : '#22c55e';

    const vegPct = a.vegetation_cover_percent ?? null;
    const conf   = a.confidence != null ? (a.confidence * 100).toFixed(0) + '%' : '—';
    const features = (a.erosion_features || []).filter(f => f && f !== 'none');

    // Build severity percentage bar
    const sevPct = sev === 'severe' || sev === 'high' ? 90 : sev === 'moderate' ? 55 : 20;

    if (emptyEl)   emptyEl.style.display   = 'none';
    if (contentEl) {
      contentEl.style.display = 'flex';
      contentEl.innerHTML = `
        <!-- Uploaded thumbnail -->
        <div class="par-thumb-wrap">
          <img class="par-thumb" src="${URL.createObjectURL(file)}" alt="Uploaded photo">
          <div class="par-thumb-meta">
            <span>Zone ${zone}</span>
            <span>${pinId}</span>
            <span>${new Date().toLocaleDateString('en',{month:'short',day:'numeric'})}</span>
          </div>
        </div>

        <!-- Analysis results -->
        <div class="par-stats">

          <!-- Severity banner -->
          <div class="par-severity-banner" style="border-color:${color};background:${color}18">
            <span class="par-sev-dot" style="background:${color}"></span>
            <span class="par-sev-label" style="color:${color}">${sevUC} Erosion</span>
            <span class="par-conf">AI confidence: ${conf}</span>
          </div>

          <!-- Key metrics row -->
          <div class="par-metrics-row">
            <div class="par-metric">
              <div class="par-metric-val" style="color:${vegPct != null && vegPct < 30 ? '#ef4444' : '#22c55e'}">${vegPct != null ? vegPct + '%' : '—'}</div>
              <div class="par-metric-lbl">Vegetation</div>
            </div>
            <div class="par-metric">
              <div class="par-metric-val">${a.moisture_estimate ?? '—'}</div>
              <div class="par-metric-lbl">Moisture</div>
            </div>
            <div class="par-metric">
              <div class="par-metric-val" style="font-size:14px">${a.soil_color ?? '—'}</div>
              <div class="par-metric-lbl">Soil Color</div>
            </div>
          </div>

          <!-- Severity bar -->
          <div class="par-bar-row">
            <span class="par-bar-label">Severity</span>
            <div class="par-bar-track">
              <div class="par-bar-fill" style="width:${sevPct}%;background:${color}"></div>
            </div>
            <span class="par-bar-val" style="color:${color}">${sevUC}</span>
          </div>

          ${features.length > 0 ? `
          <!-- Erosion features -->
          <div class="par-features-label">Detected features</div>
          <div class="par-features-tags">
            ${features.map(f => `<span class="par-tag" style="border-color:${color}40;color:${color}">${f.replace(/_/g,' ')}</span>`).join('')}
          </div>` : ''}

          ${a.vegetation_types?.length > 0 ? `
          <div class="par-features-label">Vegetation types</div>
          <div class="par-features-tags">
            ${a.vegetation_types.map(v => `<span class="par-tag" style="border-color:rgba(34,197,94,0.3);color:#22c55e">${v.replace(/_/g,' ')}</span>`).join('')}
          </div>` : ''}

          ${a.change_notes ? `
          <div class="par-notes">
            <span class="par-notes-label">AI Notes</span>
            <span class="par-notes-text">${a.change_notes}</span>
          </div>` : ''}

          <button class="btn-secondary btn-sm" style="margin-top:8px;width:100%"
                  onclick="loadPhotoHistory()">View in History ↓</button>
        </div>
      `;
    }

    showToast('✅ AI analysis complete');
    loadPhotoHistory();
  } else {
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      emptyEl.innerHTML = `<div style="font-size:28px">⚠</div><div style="font-size:12px;color:var(--red);margin-top:6px">${result?.message || 'Upload failed. Check backend is running.'}</div>`;
    }
    showToast(result?.message || '⚠ Upload failed — is the backend running?');
  }
}

// ── Photo history gallery ──────────────────────────────────────────────────────
async function loadPhotoHistory() {
  const grid = document.getElementById('photo-history-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="color:var(--text-3);font-size:11px;padding:8px">Loading…</div>';

  const data = await apiFetch('/uploads?upload_type=photo&limit=12');
  const records = data?.records || data || [];

  if (!records.length) {
    grid.innerHTML = '<div style="color:var(--text-3);font-size:11px;padding:8px">No photo uploads yet.</div>';
    return;
  }

  grid.innerHTML = records.map(r => {
    const a    = r.data || r.analysis || {};
    const sev  = a.erosion_severity || 'unknown';
    const color = sev === 'severe' || sev === 'high' ? '#ef4444' : sev === 'moderate' ? '#f59e0b' : '#22c55e';
    const date = (r.timestamp || r.created_at || '').slice(0, 10);
    const vegPct = a.vegetation_cover_percent;
    return `
      <div class="ph-card">
        <div class="ph-card-top">
          <span class="ph-sev-badge" style="background:${color}22;color:${color}">${sev}</span>
          <span class="ph-date">${date}</span>
        </div>
        <div class="ph-filename">${r.filename || '—'}</div>
        <div class="ph-zone">Zone ${r.zone || '—'}</div>
        ${vegPct != null ? `<div class="ph-veg">🌿 ${vegPct}% vegetation</div>` : ''}
        ${a.change_notes ? `<div class="ph-notes">${a.change_notes.slice(0,80)}…</div>` : ''}
      </div>
    `;
  }).join('');
}

// ── Card detail modals ────────────────────────────────────────────────────────
// Each card with data-card-modal opens a rich detail window on click.
// Content is built from live data (_lastDash, _lastWeather).

function _dmStat(label, value, sub, color) {
  const c = color ? `style="color:${color}"` : '';
  return `<div class="dm-stat"><span class="dm-stat-label">${label}</span><span class="dm-stat-value" ${c}>${value ?? '—'}</span>${sub ? `<span class="dm-stat-sub">${sub}</span>` : ''}</div>`;
}
function _dmRow(label, value, highlight) {
  return `<div class="dm-row"><span>${label}</span><strong ${highlight ? `style="color:${highlight}"` : ''}>${value ?? '—'}</strong></div>`;
}
function _dmBar(label, pct, color, display) {
  return `<div class="dm-bar-row"><span class="dm-bar-label">${label}</span><div class="dm-bar-track"><div class="dm-bar-fill" style="width:${Math.min(pct,100)}%;background:${color || 'var(--green)'}"></div></div><span class="dm-bar-val">${display ?? pct + '%'}</span></div>`;
}

const _cardModalBuilders = {
  'erosion-risk': () => {
    const d = _lastDash || {};
    const score = d.overall_risk_score ?? 74;
    const color = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#22c55e';
    const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MODERATE' : 'LOW';
    return {
      title: 'Erosion Risk Score — Detail',
      body: `
        <div class="modal-zone-hero" style="border-left:4px solid ${color}">
          <div class="modal-zone-badge" style="background:${color}22;color:${color}">${level} RISK</div>
        </div>
        <div class="detail-modal-grid wide">
          ${_dmStat('Overall Score', score + '/100', 'Composite AI index', color)}
          ${_dmStat('Active Alerts', (d.alert_count ?? 0), 'Requiring attention')}
          ${_dmStat('Site Area', '147.19 ha', 'Tsenovo Solar Park')}
        </div>
        <div class="dm-section-title">Risk by contributing factor</div>
        ${_dmBar('Precipitation', 62, '#3b82f6', '87.8 mm/58d')}
        ${_dmBar('NDVI Deficit', 78, '#f59e0b', 'Z3: 0.29')}
        ${_dmBar('Slope', 55, '#ef4444', '~12°')}
        ${_dmBar('Vegetation', 44, '#22c55e', '56% avg')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('analytics')">View Analytics</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'ndvi-trend': () => {
    const ndvi = _lastDash?.ndvi || {};
    const val = ndvi.ndvi_mean;
    const color = val != null ? (val < 0.3 ? '#ef4444' : val < 0.5 ? '#f59e0b' : '#22c55e') : '#64748b';
    return {
      title: 'NDVI Trend — Zone 3 Detail',
      body: `
        <div class="detail-modal-grid">
          ${_dmStat('NDVI Mean', val != null ? val.toFixed(3) : 'N/A', ndvi.source || '', color)}
          ${_dmStat('NDVI Min', ndvi.ndvi_min != null ? ndvi.ndvi_min.toFixed(3) : '—', 'Lowest pixel')}
          ${_dmStat('NDVI Max', ndvi.ndvi_max != null ? ndvi.ndvi_max.toFixed(3) : '—', 'Highest pixel')}
          ${_dmStat('Alert Threshold', '0.300', 'Below = vegetation alert')}
        </div>
        <div class="dm-section-title">Interpretation</div>
        ${_dmRow('Status', val != null ? (val < 0.3 ? '⚠ Below threshold' : val < 0.5 ? '⚡ Moderate' : '✓ Healthy') : 'Unavailable', color)}
        ${_dmRow('Data Source', ndvi.source || 'Copernicus Sentinel-2')}
        ${_dmRow('Coverage Zone', 'Zone 3 — 41.96 ha')}
        ${_dmRow('Reference Zones', 'Z4–Z9: NDVI > 0.55')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('analytics')">Full Analytics</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'weather': () => {
    const w = _lastDash?.weather || _lastWeather?.summary || {};
    const fc = w.forecast_days || [];
    const fcHtml = fc.slice(0, 4).map(([d, mm]) => {
      const day = new Date(d).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
      const icon = mm > 10 ? '🌧' : mm > 3 ? '🌦' : mm > 0 ? '🌥' : '☀';
      return _dmRow(day, `${icon} ${mm.toFixed(1)} mm`);
    }).join('');
    return {
      title: 'Weather Summary — Live Data',
      body: `
        <div class="detail-modal-grid wide">
          ${_dmStat('Total Precip', w.total_precipitation_mm != null ? w.total_precipitation_mm.toFixed(0) + ' mm' : '—', 'Last 58 days')}
          ${_dmStat('Avg Temp', w.avg_temperature_c != null ? w.avg_temperature_c.toFixed(1) + ' °C' : '—', 'Open-Meteo live')}
          ${_dmStat('Max Hourly', w.max_hourly_precipitation_mm != null ? w.max_hourly_precipitation_mm.toFixed(1) + ' mm/hr' : '—', 'Peak intensity')}
          ${_dmStat('Next Rain', w.next_rain_date || '—', w.next_rain_mm != null ? w.next_rain_mm.toFixed(1) + ' mm expected' : '')}
          ${_dmStat('Rainfall Alerts', (w.rainfall_alerts || []).length, 'Threshold events')}
          ${_dmStat('Avg Windspeed', w.avg_windspeed_kmh != null ? w.avg_windspeed_kmh.toFixed(1) + ' km/h' : '—', 'Surface level')}
        </div>
        <div class="dm-section-title">4-Day Forecast</div>
        ${fcHtml || _dmRow('Forecast', 'Loading…')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('alerts')">Weather Alerts</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'soil-carbon': () => {
    const s = _lastDash?.soil || {};
    const h = _lastDash?.soil_health || {};
    const clay = s.clay != null ? (s.clay / 10).toFixed(1) : '—';
    const silt = s.silt != null ? (s.silt / 10).toFixed(1) : '—';
    const sand = s.sand != null ? (s.sand / 10).toFixed(1) : '—';
    const soc  = s.soc  != null ? (s.soc  / 10).toFixed(1) : '—';
    const ph   = s.phh2o!= null ? (s.phh2o/ 10).toFixed(1) : '—';
    const bd   = s.bdod != null ? (s.bdod / 100).toFixed(2) : '—';
    const score = h.soil_health_score;
    const sc = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
    return {
      title: 'Soil Carbon & Composition — SoilGrids ISRIC',
      body: `
        <div class="detail-modal-grid wide">
          ${_dmStat('Clay', clay + '%', 'Fine particle fraction')}
          ${_dmStat('Silt', silt + '%', 'Medium particle fraction')}
          ${_dmStat('Sand', sand + '%', 'Coarse fraction')}
          ${_dmStat('SOC', soc + '‰', 'Soil organic carbon')}
          ${_dmStat('pH (H₂O)', ph, 'Neutral = 7.0')}
          ${_dmStat('Bulk Density', bd + ' g/cm³', 'ISRIC estimate')}
        </div>
        <div class="dm-section-title">Soil Health Assessment</div>
        ${_dmBar('Soil Health Score', score ?? 0, sc, (score ?? '—') + '/100')}
        ${_dmBar('Organic Content', parseFloat(soc) * 6 || 0, '#22c55e', soc + '‰')}
        ${_dmBar('Clay Content', parseFloat(clay) || 0, '#3b82f6', clay + '%')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('carbon')">Carbon Accounting</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'vegetation': () => {
    const zones = typeof ZONES !== 'undefined' ? ZONES : [];
    const rows = zones.map(z => _dmBar(z.name.replace('Zone ', 'Z'), z.vegetation ?? 0, z.risk === 'high' ? '#ef4444' : z.risk === 'moderate' ? '#f59e0b' : '#22c55e', (z.vegetation ?? '—') + '%')).join('');
    const avg = zones.length ? Math.round(zones.reduce((a,z) => a + (z.vegetation||0), 0) / zones.length) : 56;
    return {
      title: 'Vegetation Cover % — All Zones',
      body: `
        <div class="detail-modal-grid">
          ${_dmStat('Site Average', avg + '%', 'Across 9 zones')}
          ${_dmStat('Lowest Zone', 'Zone 3', '24% — Active erosion')}
          ${_dmStat('Highest Zone', 'Zone 1', '72% — Reference')}
          ${_dmStat('Target', '≥ 60%', 'ESG mandate threshold')}
        </div>
        <div class="dm-section-title">Cover per zone</div>
        ${rows || _dmBar('Zone 3', 24, '#ef4444', '24%') + _dmBar('Zone 1', 72, '#22c55e', '72%')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('analytics')">Analytics</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'before-after': () => {
    const imgs = _zonesPinImages || [];
    const latest = imgs[0];
    const older = imgs[Math.min(imgs.length - 1, 5)];
    const latestDate = latest ? new Date(latest.mtime * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Latest capture';
    const olderDate  = older  ? new Date(older.mtime  * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Earlier capture';
    return {
      title: 'Before / After Timeline — Change Detection',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;margin-bottom:4px">Earlier (Before)</div>
            ${older ? `<img src="${older.url}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" onerror="this.style.display='none'">` : '<div style="height:140px;background:var(--bg-3);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:11px">No image</div>'}
            <div style="font-size:10px;color:var(--text-3);margin-top:4px">${olderDate}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;margin-bottom:4px">Latest (After)</div>
            ${latest ? `<img src="${latest.url}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" onerror="this.style.display='none'">` : '<div style="height:140px;background:var(--bg-3);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:11px">No image</div>'}
            <div style="font-size:10px;color:var(--text-3);margin-top:4px">${latestDate}</div>
          </div>
        </div>
        <div class="dm-section-title">Change detection</div>
        ${_dmRow('Images available', imgs.length + ' in timelapse folder')}
        ${_dmRow('Monitoring location', 'Zone 3 — Smart Erosion Pin')}
        ${_dmRow('AI analysis', 'Click any image in Smart Pins section')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('analytics')">View Full Analytics</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'ndvi-all-zones': () => ({
    title: 'NDVI Trend — All Zones',
    body: `
      <div class="detail-modal-grid">
        ${_dmStat('Zone 3 NDVI', (_lastDash?.ndvi?.ndvi_mean ?? 0.29).toFixed(3), 'Alert zone — below 0.30', '#ef4444')}
        ${_dmStat('Zones 4–9 NDVI', '> 0.55', 'Reference — healthy', '#22c55e')}
        ${_dmStat('Site Average', '~0.42', 'Weighted by area')}
        ${_dmStat('Data Source', 'Copernicus', 'Sentinel-2 MSI')}
      </div>
      <div class="dm-section-title">Zone NDVI status</div>
      ${_dmBar('Z3 (41.96 ha)', 29, '#ef4444', '0.29')}
      ${_dmBar('Z2 (12.10 ha)', 38, '#f59e0b', '0.38')}
      ${_dmBar('Z1–Z9 avg', 55, '#22c55e', '0.55+')}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'som-bulk-density': () => {
    const s = _lastDash?.soil || {};
    const soc = s.soc != null ? (s.soc / 10).toFixed(1) : '31.6';
    const bd = s.bdod != null ? (s.bdod / 100).toFixed(2) : '1.38';
    return {
      title: 'Soil Organic Matter & Bulk Density',
      body: `
        <div class="detail-modal-grid">
          ${_dmStat('SOC', soc + '‰', 'Soil organic carbon')}
          ${_dmStat('SOM %', (parseFloat(soc) * 0.172).toFixed(2) + '%', 'SOM = SOC × 1.72')}
          ${_dmStat('Bulk Density', bd + ' g/cm³', 'ISRIC estimate')}
          ${_dmStat('Carbon Stock', '~36 tC/ha', 'At 15 cm depth')}
        </div>
        <div class="dm-section-title">SOM trend note</div>
        ${_dmRow('2024 Baseline', '28.1‰ SOC')}
        ${_dmRow('Current', soc + '‰ SOC', '#22c55e')}
        ${_dmRow('2030 Target', '50.0‰ SOC')}
        ${_dmRow('Annual Change', '+1.2‰/yr avg')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('carbon')">Carbon Section</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'carbon-trend': () => ({
    title: 'Soil Carbon Calculation Trend',
    body: `
      <div class="detail-modal-grid wide">
        ${_dmStat('Current Stock', '68.42 tC/ha', '+17.7% YoY', '#22c55e')}
        ${_dmStat('CO₂ Equivalent', '251.15 tCO₂/ha', 'Factor: ×3.67')}
        ${_dmStat('Annual Seq.', '2.1 tC/ha/yr', 'IPCC methodology')}
      </div>
      <div class="dm-section-title">Carbon stock history</div>
      ${_dmRow('2022', '50.1 tC/ha')}
      ${_dmRow('2023', '56.8 tC/ha')}
      ${_dmRow('2024', '61.2 tC/ha')}
      ${_dmRow('2025', '65.5 tC/ha')}
      ${_dmRow('2026 (current)', '68.42 tC/ha', '#22c55e')}
      <div class="modal-actions">
        <button class="btn-primary btn-sm" onclick="closeModal();activateSection('carbon')">Carbon Section</button>
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'bio-score': () => {
    const bio = { shannon_h: 3.82, species_richness: 41, total_occurrences: 215 };
    return {
      title: 'Biodiversity Score — Analytics',
      body: `
        <div class="detail-modal-grid">
          ${_dmStat("Shannon H′", bio.shannon_h.toFixed(2), 'Diversity index (0–5)', '#22c55e')}
          ${_dmStat('Species Richness', bio.species_richness, 'Observed species')}
          ${_dmStat('Total Records', bio.total_occurrences, 'GBIF occurrences')}
          ${_dmStat('Invasive Risk', 'Low (7%)', 'Checked quarterly')}
        </div>
        <div class="dm-section-title">Species groups</div>
        ${_dmBar('Plants', 48, '#22c55e', '48')}
        ${_dmBar('Birds', 28, '#3b82f6', '28')}
        ${_dmBar('Insects', 42, '#f59e0b', '42')}
        ${_dmBar('Mammals', 10, '#a855f7', '10')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('biodiversity')">Biodiversity</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'rainfall-alert': () => {
    const w = _lastDash?.weather || _lastWeather?.summary || {};
    const fc = w.forecast_days || [];
    return {
      title: 'Rainfall Alert System',
      body: `
        <div class="detail-modal-grid wide">
          ${_dmStat('Alert Threshold', '15 mm/hr', 'Trigger level')}
          ${_dmStat('Active Alerts', (w.rainfall_alerts || []).length, 'Current events')}
          ${_dmStat('Total 58-Day', w.total_precipitation_mm != null ? w.total_precipitation_mm.toFixed(0) + ' mm' : '—', 'Accumulated')}
        </div>
        <div class="dm-section-title">Forecast (mm/day)</div>
        ${fc.slice(0, 4).map(([d, mm]) => {
          const day = new Date(d).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
          const c = mm > 10 ? '#ef4444' : mm > 3 ? '#f59e0b' : '#22c55e';
          return _dmBar(day, Math.min(mm * 3, 100), c, mm.toFixed(1) + ' mm');
        }).join('')}
        <div class="dm-section-title">Alert zones</div>
        ${_dmRow('Zone 3', 'HIGH sensitivity — 70m gradient')}
        ${_dmRow('Zone 2', 'MODERATE sensitivity')}
        ${_dmRow('Zones 1,4–9', 'LOW sensitivity')}
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('alerts')">All Alerts</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'carbon-trajectory': () => ({
    title: 'Carbon Sequestration Trajectory',
    body: `
      <div class="detail-modal-grid">
        ${_dmStat('2026 Stock', '68.42 tC/ha', 'Current')}
        ${_dmStat('2030 Target', '85.0 tC/ha', 'ESG mandate', '#22c55e')}
        ${_dmStat('Gap', '16.6 tC/ha', '4 years remaining')}
        ${_dmStat('Rate Needed', '4.1 tC/ha/yr', 'Required to meet target')}
      </div>
      <div class="dm-section-title">Projected trajectory</div>
      ${_dmBar('2026', 68, '#3b82f6', '68.4')}
      ${_dmBar('2027', 72, '#3b82f6', '~72')}
      ${_dmBar('2028', 76, '#f59e0b', '~76')}
      ${_dmBar('2029', 81, '#f59e0b', '~81')}
      ${_dmBar('2030 target', 85, '#22c55e', '85.0')}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'key-metrics': () => {
    const d = _lastDash || {};
    const s = d.soil || {};
    const soc = s.soc != null ? (s.soc / 10).toFixed(1) : '31.6';
    return {
      title: 'Key Metrics — Carbon & Soil',
      body: `
        <div class="detail-modal-grid">
          ${_dmStat('Organic Carbon', '68.42 tC/ha', 'Measured')}
          ${_dmStat('CO₂ Stored', '251.15 tCO₂/ha', 'Equivalent')}
          ${_dmStat('Annual Seq.', '2.1 tC/ha/yr', 'Rate')}
          ${_dmStat('Soil Health', (d.soil_health?.soil_health_score ?? 60) + '/100', 'Score', d.soil_health?.soil_health_score >= 70 ? '#22c55e' : '#f59e0b')}
          ${_dmStat('SOC (ISRIC)', soc + '‰', 'SoilGrids')}
          ${_dmStat('pH', s.phh2o != null ? (s.phh2o/10).toFixed(1) : '7.2', 'Neutral')}
        </div>
        <div class="modal-actions">
          <button class="btn-primary btn-sm" onclick="closeModal();activateSection('carbon')">Full Carbon Data</button>
          <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
        </div>`
    };
  },
  'carbon-calc': () => ({
    title: 'Soil Carbon Calculator — Methodology',
    body: `
      <div class="dm-section-title">Formula</div>
      ${_dmRow('OC%', 'SOM% × 0.58 (van Bemmelen)')}
      ${_dmRow('Carbon Stock', 'OC% × BD × depth × 100 / 1000 (tC/ha)')}
      ${_dmRow('CO₂ Equivalent', 'Carbon Stock × 3.67')}
      <div class="dm-section-title">Tsenovo reference values</div>
      ${_dmRow('SOM%', '3.5 – 5.5%')}
      ${_dmRow('Bulk Density', '1.34 – 1.42 g/cm³')}
      ${_dmRow('Sampling Depth', '15 – 30 cm')}
      ${_dmRow('Resulting stock', '~36 tC/ha at 15 cm')}
      <div class="modal-actions">
        <button class="btn-primary btn-sm" onclick="closeModal();activateSection('carbon');setTimeout(()=>document.getElementById('inp-som')?.focus(),300)">Open Calculator</button>
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'shannon': () => ({
    title: "Shannon H′ Diversity Index",
    body: `
      <div class="detail-modal-grid">
        ${_dmStat("H′ Index", '3.82', 'Tsenovo 2026', '#22c55e')}
        ${_dmStat('Classification', 'High', 'H′ > 3.5')}
        ${_dmStat('vs. Last Year', '+0.12', 'Improving', '#22c55e')}
        ${_dmStat('Max Possible', '~5.0', 'For 41 species')}
      </div>
      <div class="dm-section-title">Shannon H′ scale</div>
      ${_dmBar('Low diversity', 20, '#ef4444', 'H′ < 1')}
      ${_dmBar('Moderate', 50, '#f59e0b', 'H′ 1–3')}
      ${_dmBar('High (Tsenovo)', 76, '#22c55e', 'H′ 3.82')}
      ${_dmBar('Max recorded', 90, '#3b82f6', 'H′ 4.5+')}
      <div class="dm-section-title">Formula</div>
      ${_dmRow('H′', '−Σ(pᵢ × ln pᵢ)')}
      ${_dmRow('pᵢ', 'Proportion of species i')}
      <div class="modal-actions">
        <button class="btn-primary btn-sm" onclick="closeModal();activateSection('biodiversity')">Biodiversity</button>
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'seasonal-species': () => ({
    title: 'Seasonal Species Distribution',
    body: `
      <div class="detail-modal-grid wide">
        ${_dmStat('Spring Peak', '41 species', 'Mar–May highest')}
        ${_dmStat('Summer', '35 species', 'Jun–Aug')}
        ${_dmStat('Autumn', '28 species', 'Sep–Nov')}
      </div>
      <div class="dm-section-title">Seasonal drivers</div>
      ${_dmRow('Spring', 'Migratory birds arrive, wildflowers bloom')}
      ${_dmRow('Summer', 'Pollinators peak, grass senescence')}
      ${_dmRow('Autumn', 'Migratory departure, seed dispersal')}
      ${_dmRow('Winter', 'Resident species only, ~15 recorded')}
      <div class="modal-actions">
        <button class="btn-primary btn-sm" onclick="closeModal();activateSection('biodiversity')">Full Biodiversity</button>
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'species-observed': () => ({
    title: 'Species Observed — Site Inventory',
    body: `
      <div class="detail-modal-grid">
        ${_dmStat('Total Observed', '41', 'GBIF confirmed')}
        ${_dmStat('Total Possible', '~62', 'Regional reference')}
        ${_dmStat('Missing', '8', 'Expected but absent', '#f59e0b')}
        ${_dmStat('Invasive', '3', 'Monitored species', '#ef4444')}
      </div>
      <div class="dm-section-title">Keystone & indicator species</div>
      ${_dmRow('Stipa pennata', 'Keystone grass — present')}
      ${_dmRow('Circus aeruginosus', 'Marsh harrier — active')}
      ${_dmRow('Bufo bufo', 'Common toad — seasonal')}
      ${_dmRow('Ailanthus altissima', 'Invasive — controlled')}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'flora-fauna': () => ({
    title: 'Seasonal Flora & Fauna Diversity',
    body: `
      <div class="detail-modal-grid">
        ${_dmStat('Plant Species', '48', 'Site flora inventory', '#22c55e')}
        ${_dmStat('Bird Species', '28', 'Avian census', '#3b82f6')}
        ${_dmStat('Insect Species', '42', 'Pollinator focus', '#f59e0b')}
        ${_dmStat('Mammals', '10', 'Incl. small rodents')}
      </div>
      <div class="dm-section-title">Flora highlights</div>
      ${_dmRow('Stipa pennata', 'Keystone steppe grass')}
      ${_dmRow('Festuca valesiaca', 'Dominant grass cover')}
      ${_dmRow('Salvia pratensis', 'Meadow sage — pollinator')}
      <div class="dm-section-title">Fauna highlights</div>
      ${_dmRow('Circus aeruginosus', 'Marsh harrier — top predator')}
      ${_dmRow('Lanius collurio', 'Red-backed shrike')}
      ${_dmRow('Apis mellifera', 'Honey bee — pollination')}
      <div class="modal-actions">
        <button class="btn-primary btn-sm" onclick="closeModal();activateSection('biodiversity')">Biodiversity Section</button>
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'avian-monitoring': () => ({
    title: 'Avian Monitoring — Tsenovo Zone Alpha',
    body: `
      <div class="detail-modal-grid">
        ${_dmStat('Species Count', '28', 'Birds logged 2026')}
        ${_dmStat('Survey Method', 'Point Count', 'BTO protocol')}
        ${_dmStat('Last Survey', 'Apr 20, 2026', 'Manual field')}
        ${_dmStat('Protected', '5', 'Natura 2000 species', '#3b82f6')}
      </div>
      <div class="dm-section-title">Notable species</div>
      ${_dmRow('Circus aeruginosus', 'Marsh harrier — breeding')}
      ${_dmRow('Milvus migrans', 'Black kite — transient')}
      ${_dmRow('Lanius collurio', 'Red-backed shrike — summer')}
      ${_dmRow('Falco tinnunculus', 'Common kestrel — resident')}
      ${_dmRow('Upupa epops', 'Hoopoe — spring migrant')}
      <div class="modal-actions">
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
  'pollen': () => ({
    title: 'Palynology (Pollen) Analysis',
    body: `
      <div class="detail-modal-grid">
        ${_dmStat('Pollen Types', '18', 'Identified taxa')}
        ${_dmStat('Peak Season', 'April–May', 'Highest counts')}
        ${_dmStat('Dominant Type', 'Poaceae', 'Grass family', '#22c55e')}
        ${_dmStat('Allergen Risk', 'Moderate', 'Apr–Jun period')}
      </div>
      <div class="dm-section-title">Top pollen taxa</div>
      ${_dmBar('Poaceae (grasses)', 68, '#22c55e', '68%')}
      ${_dmBar('Asteraceae', 42, '#f59e0b', '42%')}
      ${_dmBar('Quercus (oak)', 28, '#a855f7', '28%')}
      ${_dmBar('Pinus (pine)', 18, '#64748b', '18%')}
      <div class="modal-actions">
        <button class="btn-primary btn-sm" onclick="closeModal();activateSection('biodiversity')">Biodiversity</button>
        <button class="btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`
  }),
};

function openCardModal(cardType) {
  const builder = _cardModalBuilders[cardType];
  if (!builder) return;
  const { title, body } = builder();
  openModal(title, body);
}

// Single delegated listener on document — catches all [data-card-modal] clicks
// regardless of when cards are rendered or sections are revealed.
function wireCardModals() { /* no-op: delegation set up at boot */ }

function _initCardModalDelegation() {
  document.addEventListener('click', (e) => {
    // Only open if the click wasn't on an interactive element (form controls, nav buttons)
    if (e.target.closest('button, input, select, textarea, a, .pin-thumb, .zone-item, .sidebar-tab, .notif-btn, .user-profile')) return;

    const card = e.target.closest('[data-card-modal]');
    if (!card) return;

    openCardModal(card.dataset.cardModal);
  }, true);  // capture phase so it fires before any card-internal handlers
}

// ── Start the live engine ─────────────────────────────────────────────────────
function startLiveEngine() {
  // Stamp today's date immediately (before any API response)
  updateWeatherCard(null);

  // Initial fetch
  fetchAndRender();
  fetchTimelapseImages();
  wireDropdowns();

  // Auto-refresh every 60s
  _refreshTimer = setInterval(() => {
    fetchAndRender();
    fetchTimelapseImages();
    updateDataLayersFeed();
    flashAll();
  }, _refreshInterval * 1000);

  // Wire carbon calculator to API
  const calcBtn = document.querySelector('[onclick="calculateCarbon()"]');
  if (calcBtn) {
    calcBtn.removeAttribute('onclick');
    calcBtn.addEventListener('click', calculateCarbonLive);
  }

  // Wire report button to API
  const reportBtn = document.querySelector('[onclick="generateReport()"]');
  if (reportBtn) {
    reportBtn.removeAttribute('onclick');
    reportBtn.addEventListener('click', generateReportLive);
  }

  // Wire buttons after DOM settles
  setTimeout(() => {
    wireAlertsButtons();
    wireZoneButtons();
    wireInteractivity();
    wireCardModals();
  }, 1000);

  console.log('[live] Engine started. Refresh every', _refreshInterval, 's');
}

// ── Override section init to include live data ────────────────────────────────
const _originalInitSection = typeof initSectionContent === 'function' ? initSectionContent : null;

function initSectionContentLive(id) {
  if (_originalInitSection) _originalInitSection(id);

  switch (id) {
    case 'zones':
      initZonesMap();
      renderZoneListLive();
      setTimeout(() => wireZoneButtons(), 300);
      break;
    case 'analytics':
      initAnalyticsCharts();
      fetchTimelapseImages();
      setTimeout(fetchAndUpdateNDVIAllZones, 500);
      setTimeout(() => {
        updateSomScatterFromZones(ZONES);
        fetchAndUpdateCarbonKPIs();
        fetchAndUpdateBiodiversityKPIs();
      }, 700);
      break;
    case 'alerts':
      initAlertsCharts();
      renderAlertsGrid();
      setTimeout(fetchAndUpdateRainfallChart, 300);
      setTimeout(() => {
        wireAlertsButtons();
        if (_lastDash) {
          const alerts = _lastDash.alerts || [];
          const critEl = document.getElementById('as-critical');
          const warnEl = document.getElementById('as-warning');
          const infoEl = document.getElementById('as-info');
          if (critEl) critEl.textContent = alerts.filter(a => a.severity === 'high' || a.severity === 'critical').length;
          if (warnEl) warnEl.textContent = alerts.filter(a => a.severity === 'moderate' || a.severity === 'warning').length;
          if (infoEl) infoEl.textContent = alerts.filter(a => a.severity === 'info').length;
        }
        wireInteractivity();
      }, 200);
      break;
    case 'biodiversity':
      initBioCharts();
      setTimeout(fetchAndUpdateBio, 200);
      setTimeout(fetchAndUpdateSpeciesList, 400);
      setTimeout(fetchAndUpdateBiodiversityKPIs, 600);
      break;
    case 'data-layers':
      initLayersMap();
      setTimeout(() => {
        refreshAllLayers();                 // populate strip badges
        updateDataLayersFeed();             // update sidebar metas from cached data
        selectLayer('ndvi');                // open NDVI panel by default
      }, 300);
      setTimeout(fetchAndUpdateNDVIAllZones, 800);
      break;
    case 'reports':
      // Wire generate button and populate report table
      updateReportTable();
      setTimeout(() => {
        const btn = document.querySelector('[onclick*="generateReport"], .btn-generate-report');
        if (btn && !btn.dataset.wired) {
          btn.dataset.wired = '1';
          btn.addEventListener('click', generateReportLive);
        }
        wireInteractivity();
      }, 100);
      break;
    case 'carbon':
      initCarbonCharts();
      renderCarbonTable();
      setTimeout(fetchAndUpdateCarbonTrajectory, 400);
      setTimeout(fetchAndUpdateCarbonKPIs, 600);
      break;
    case 'settings':
      renderPinsStatus();
      setTimeout(fetchAndUpdatePinStatus, 200);
      setTimeout(fetchAndRenderPinHistory, 400);
      setTimeout(fetchAndRenderUploadHistory, 600);
      break;
    default:
      setTimeout(wireInteractivity, 100);
  }
  // Wire card modals whenever section activates
  setTimeout(wireCardModals, 150);
}

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Override the section init
  window.initSectionContent = initSectionContentLive;

  // Override calculateCarbon
  window.calculateCarbon = calculateCarbonLive;

  // Override generateReport
  window.generateReport = generateReportLive;

  // Set up card modal click delegation (one listener, catches everything)
  _initCardModalDelegation();

  // Start after a brief delay to let other scripts initialize
  setTimeout(startLiveEngine, 800);
});
