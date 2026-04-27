/* ═══════════════════════════════════════════════════════
   CHART.JS CONFIGURATIONS
═══════════════════════════════════════════════════════ */

Chart.defaults.color = '#64748b';
Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
Chart.defaults.font.size = 10;

// Global chart instance registry — allows live.js to update any chart by key
window._chartInst = {};

const CHART_GRID = {
  color: 'rgba(255,255,255,0.05)',
  drawBorder: false
};
const NO_LEGEND = { display: false };
const NO_TOOLTIP_TITLE = { callbacks: { title: () => '' } };

function makeGradient(ctx, color1, color2) {
  const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  g.addColorStop(0, color1);
  g.addColorStop(1, color2);
  return g;
}

/* ─── NDVI Trend (left panel) ─── */
function initNdviChart() {
  const el = document.getElementById('ndvi-chart');
  if (!el) return;
  const ctx = el.getContext('2d');

  return window._chartInst.ndviTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Z2',
          data: [],
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          fill: false
        },
        {
          label: 'Z3',
          data: [],
          borderColor: '#ef4444',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 90);
            g.addColorStop(0, 'rgba(239,68,68,0.25)');
            g.addColorStop(1, 'rgba(239,68,68,0)');
            return g;
          }
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: NO_LEGEND, tooltip: { ...NO_TOOLTIP_TITLE } },
      scales: {
        x: { grid: CHART_GRID, border: { display: false }, ticks: { font: { size: 9 } } },
        y: {
          grid: CHART_GRID,
          border: { display: false },
          min: 0, max: 1.0,
          ticks: { font: { size: 9 }, stepSize: 0.2 }
        }
      }
    }
  });
}

/* ─── Soil Carbon (right panel) ─── */
function initCarbonChart() {
  const el = document.getElementById('carbon-chart');
  if (!el) return;
  const ctx = el.getContext('2d');

  return window._chartInst.soilCarbon = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: '#f59e0b',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 80);
          g.addColorStop(0, 'rgba(245,158,11,0.3)');
          g.addColorStop(1, 'rgba(245,158,11,0)');
          return g;
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: NO_LEGEND, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });
}

/* ─── Vegetation Cover (right panel) ─── */
function initVegChart() {
  const el = document.getElementById('veg-chart');
  if (!el) return;
  const ctx = el.getContext('2d');

  return window._chartInst.vegCover = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderColor: [],
        borderWidth: 1,
        borderRadius: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: NO_LEGEND, tooltip: { callbacks: { label: ctx => ctx.raw + '%' } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 8 } } },
        y: {
          grid: CHART_GRID,
          border: { display: false },
          min: 0, max: 100,
          ticks: { font: { size: 8 }, callback: v => v + '%' }
        }
      }
    }
  });
}

/* ─── Rainfall (alerts section) ─── */
function initRainfallChart() {
  const el = document.getElementById('rainfall-chart');
  if (!el) return;
  const ctx = el.getContext('2d');

  return window._chartInst.rainfall = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderRadius: 2,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: NO_LEGEND, tooltip: { callbacks: { label: ctx => ctx.raw + 'mm' } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 8 }, maxRotation: 45 } },
        y: { grid: CHART_GRID, border: { display: false }, ticks: { font: { size: 8 }, callback: v => v + 'mm' } }
      }
    }
  });
}

/* ─── Analytics NDVI (analytics section) ─── */
function initAnalyticsNdviChart() {
  const el = document.getElementById('analytics-ndvi-chart');
  if (!el) return;
  const ctx = el.getContext('2d');
  const months = ['Jan','Feb','Mar','Apr','May','Jun'];
  // Instance stored so live.js can inject real /api/ndvi/all-zones data

  const colors = ['#22c55e','#f59e0b','#ef4444','#3b82f6','#a855f7','#14b8a6','#f97316','#ec4899','#6366f1'];

  return window._chartInst.ndviAllZones = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: ZONES.map((z) => ({
        label: `Z${z.id}`,
        data: [],
        borderColor: z.color,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: false
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } },
      scales: {
        x: { grid: CHART_GRID, border: { display: false } },
        y: { grid: CHART_GRID, border: { display: false }, min: 0, max: 1 }
      }
    }
  });
}

/* ─── Analytics SOM chart ─── */
function initAnalyticsSomChart() {
  const el = document.getElementById('analytics-som-chart');
  if (!el) return;
  const ctx = el.getContext('2d');

  return window._chartInst.somBulkDensity = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Zones',
        data: [],
        backgroundColor: [],
        borderColor: [],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: NO_LEGEND },
      scales: {
        x: { grid: CHART_GRID, border: { display: false }, title: { display: true, text: 'Bulk Density (g/cm³)', color: '#64748b', font: { size: 10 } } },
        y: { grid: CHART_GRID, border: { display: false }, title: { display: true, text: 'SOM %', color: '#64748b', font: { size: 10 } } }
      }
    }
  });
}

/* ─── Carbon Trajectory ─── */
function initCarbonTrajectoryChart() {
  const el = document.getElementById('carbon-trajectory-chart');
  if (!el) return;
  const ctx = el.getContext('2d');

  return window._chartInst.carbonTrajectory = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['2020','2021','2022','2023','2024','2025','2026','2027','2028','2029','2030'],
      datasets: [
        {
          label: 'Actual Carbon Stock',
          data: [null, null, null, null, null, null, null, null, null, null, null],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.15)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 3
        },
        {
          label: 'Projected (BAU)',
          data: [null, null, null, null, null, null, null, null, null, null, null],
          borderColor: '#3b82f6',
          borderDash: [4, 4],
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 0
        },
        {
          label: 'Target CO₂e',
          data: [null, null, null, null, null, null, null, null, null, null, null],
          borderColor: '#f59e0b',
          borderDash: [2, 3],
          borderWidth: 1,
          fill: false,
          tension: 0.4,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
      scales: {
        x: { grid: CHART_GRID, border: { display: false } },
        y: { grid: CHART_GRID, border: { display: false }, title: { display: true, text: 'tC/ha', color: '#64748b', font: { size: 10 } } }
      }
    }
  });
}

/* ─── Biodiversity Seasonal ─── */
function initBioSeasonalChart() {
  const el = document.getElementById('bio-seasonal-chart');
  if (!el) return;

  return window._chartInst.bioSeasonal = new Chart(el, {
    type: 'radar',
    data: {
      labels: ['Spring', 'Summer', 'Autumn', 'Winter'],
      datasets: [
        { label: 'Birds', data: [0, 0, 0, 0], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1.5, pointRadius: 3 },
        { label: 'Insects', data: [0, 0, 0, 0], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1.5, pointRadius: 3 },
        { label: 'Plants', data: [0, 0, 0, 0], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1.5, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } },
      scales: {
        r: {
          grid: { color: 'rgba(255,255,255,0.07)' },
          angleLines: { color: 'rgba(255,255,255,0.07)' },
          pointLabels: { font: { size: 9 }, color: '#94a3b8' },
          ticks: { display: false }
        }
      }
    }
  });
}

/* ─── Biodiversity Diversity Chart ─── */
function initBioDiversityChart() {
  const el = document.getElementById('bio-diversity-chart');
  if (!el) return;

  return window._chartInst.bioDiversity = new Chart(el, {
    type: 'bar',
    data: {
      labels: ['Plants', 'Birds', 'Insects', 'Mammals', 'Amphibians'],
      datasets: [
        { label: 'Spring', data: [0, 0, 0, 0, 0], backgroundColor: 'rgba(34,197,94,0.7)' },
        { label: 'Summer', data: [0, 0, 0, 0, 0], backgroundColor: 'rgba(59,130,246,0.7)' },
        { label: 'Autumn', data: [0, 0, 0, 0, 0], backgroundColor: 'rgba(245,158,11,0.7)' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, stacked: false },
        y: { grid: CHART_GRID, border: { display: false } }
      }
    }
  });
}

/* ─── Pollen Analysis ─── */
function initPollenChart() {
  const el = document.getElementById('pollen-chart');
  if (!el) return;

  return window._chartInst.pollen = new Chart(el, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Count',
        data: [],
        backgroundColor: ['#22c55e','#3b82f6','#f59e0b','#a855f7','#14b8a6','#64748b'].map(c => c + 'bb'),
        borderRadius: 3,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: 'y',
      plugins: { legend: NO_LEGEND },
      scales: {
        x: { grid: CHART_GRID, border: { display: false } },
        y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 9 } } }
      }
    }
  });
}

/* ─── Analytics Carbon (analytics section) ─── */
function initAnalyticsCarbonChart() {
  const el = document.getElementById('analytics-carbon-chart');
  if (!el) return;

  return window._chartInst.analyticsCarbon = new Chart(el, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        { label: 'Soil Carbon', data: [], backgroundColor: 'rgba(34,197,94,0.6)', borderRadius: 3 },
        { label: 'CO₂e', data: [], backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 3 },
        { label: 'Target (CO₂e)', data: [], type: 'line', borderColor: '#f59e0b', borderDash: [4,4], borderWidth: 1.5, pointRadius: 0, fill: false, backgroundColor: 'transparent' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: { grid: CHART_GRID, border: { display: false } }
      }
    }
  });
}

/* ─── Analytics Bio ─── */
function initAnalyticsBioChart() {
  const el = document.getElementById('analytics-bio-chart');
  if (!el) return;

  return window._chartInst.analyticsBio = new Chart(el, {
    type: 'radar',
    data: {
      labels: ['Species Richness', 'Shannon H\'', 'Vegetation Cover', 'Soil Health', 'Water Quality', 'Carbon Stock'],
      datasets: [{
        label: 'Current',
        data: [0, 0, 0, 0, 0, 0],
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.15)',
        borderWidth: 2,
        pointRadius: 3
      }, {
        label: 'Target',
        data: [85, 85, 75, 85, 80, 90],
        borderColor: '#3b82f6',
        borderDash: [4, 4],
        backgroundColor: 'rgba(59,130,246,0.05)',
        borderWidth: 1.5,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } },
      scales: {
        r: {
          grid: { color: 'rgba(255,255,255,0.07)' },
          angleLines: { color: 'rgba(255,255,255,0.07)' },
          pointLabels: { font: { size: 9 }, color: '#94a3b8' },
          ticks: { display: false },
          min: 0, max: 100
        }
      }
    }
  });
}

/* ─── Initialize all charts ─── */
let chartsInitialized = {};

function initDashboardCharts() {
  if (!chartsInitialized.ndvi) { chartsInitialized.ndvi = initNdviChart(); }
  if (!chartsInitialized.carbon) { chartsInitialized.carbon = initCarbonChart(); }
  if (!chartsInitialized.veg) { chartsInitialized.veg = initVegChart(); }
}

function initAlertsCharts() {
  if (!chartsInitialized.rainfall) { chartsInitialized.rainfall = initRainfallChart(); }
}

function initAnalyticsCharts() {
  if (!chartsInitialized.analyticsNdvi) { chartsInitialized.analyticsNdvi = initAnalyticsNdviChart(); }
  if (!chartsInitialized.analyticsSom) { chartsInitialized.analyticsSom = initAnalyticsSomChart(); }
  if (!chartsInitialized.analyticsCarbon) { chartsInitialized.analyticsCarbon = initAnalyticsCarbonChart(); }
  if (!chartsInitialized.analyticsBio) { chartsInitialized.analyticsBio = initAnalyticsBioChart(); }
}

function initCarbonCharts() {
  if (!chartsInitialized.carbonTraj) { chartsInitialized.carbonTraj = initCarbonTrajectoryChart(); }
}

function initBioCharts() {
  if (!chartsInitialized.bioSeasonal) { chartsInitialized.bioSeasonal = initBioSeasonalChart(); }
  if (!chartsInitialized.bioDiversity) { chartsInitialized.bioDiversity = initBioDiversityChart(); }
  if (!chartsInitialized.pollen) { chartsInitialized.pollen = initPollenChart(); }
}
