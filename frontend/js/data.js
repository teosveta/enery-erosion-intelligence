/* ═══════════════════════════════════════════════════════
   MOCK DATA — Tsenovo Solar Park
═══════════════════════════════════════════════════════ */

const SITE_DATA = {
  name: 'Tsenovo Solar Park',
  location: 'Dzhulyunitsa, Tsenovo, Bulgaria',
  coords: [43.5556, 25.5918],
  capacity: '63.01 MWp',
  area: '147.19 ha',
  zones: 9
};

const ZONES = [
  {
    id: 1, name: 'Zone 1', cluster: 'North',
    area: 33.66, risk: 'moderate', riskScore: 42,
    ndvi: 0.54, vegetation: 68, center: [43.588, 25.620],
    color: '#f59e0b', elevation: '69–128m',
    description: 'Stage 1 PV — 27.01 MWp. Moderate vegetation cover.',
    polygon: [
      [43.594, 25.616],[43.594, 25.623],[43.591, 25.626],
      [43.586, 25.625],[43.583, 25.620],[43.586, 25.615],
      [43.591, 25.614]
    ]
  },
  {
    id: 2, name: 'Zone 2', cluster: 'Middle',
    area: 5.92, risk: 'moderate', riskScore: 51,
    ndvi: 0.41, vegetation: 48, center: [43.5605, 25.5920],
    color: '#f59e0b', elevation: '85–112m',
    description: 'Small parcel north of Zone 3. Moderate risk.',
    polygon: [
      [43.562, 25.590],[43.562, 25.595],
      [43.559, 25.595],[43.559, 25.590]
    ]
  },
  {
    id: 3, name: 'Zone 3', cluster: 'Middle',
    area: 41.96, risk: 'high', riskScore: 78,
    ndvi: 0.29, vegetation: 24, center: [43.5556, 25.5918],
    color: '#ef4444', elevation: '82–152m',
    description: '⚠ PRIMARY FOCUS — Active erosion. 70m elevation gradient drives rill formation.',
    polygon: [
      [43.5544, 25.5813],[43.5537, 25.5830],[43.5539, 25.5858],
      [43.5540, 25.5897],[43.5551, 25.5896],[43.5559, 25.5906],
      [43.5574, 25.5911],[43.5590, 25.5917],[43.5585, 25.5943],
      [43.5575, 25.5956],[43.5568, 25.5949],[43.5559, 25.5965],
      [43.5551, 25.5945],[43.5539, 25.5920],[43.5536, 25.5858],
      [43.5552, 25.5830],[43.5552, 25.5832],[43.5561, 25.5830],
      [43.5566, 25.5853]
    ]
  },
  {
    id: 4, name: 'Zone 4', cluster: 'South',
    area: 5.12, risk: 'low', riskScore: 22,
    ndvi: 0.61, vegetation: 74, center: [43.520, 25.575],
    color: '#22c55e', elevation: '90–115m',
    description: 'Good vegetation recovery. Low erosion risk.',
    polygon: [
      [43.521, 25.573],[43.521, 25.577],
      [43.519, 25.577],[43.519, 25.573]
    ]
  },
  {
    id: 5, name: 'Zone 5', cluster: 'South',
    area: 6.91, risk: 'low', riskScore: 18,
    ndvi: 0.67, vegetation: 79, center: [43.523, 25.577],
    color: '#22c55e', elevation: '95–125m',
    description: 'Healthy grass cover. Monitoring as reference.',
    polygon: [
      [43.525, 25.575],[43.525, 25.580],
      [43.521, 25.580],[43.521, 25.575]
    ]
  },
  {
    id: 6, name: 'Zone 6', cluster: 'South',
    area: 6.27, risk: 'moderate', riskScore: 38,
    ndvi: 0.46, vegetation: 54, center: [43.522, 25.585],
    color: '#f59e0b', elevation: '88–118m',
    description: 'Some bare patches along fence lines. Monitoring.',
    polygon: [
      [43.524, 25.583],[43.524, 25.588],
      [43.520, 25.588],[43.520, 25.583]
    ]
  },
  {
    id: 7, name: 'Zone 7', cluster: 'South',
    area: 14.55, risk: 'high', riskScore: 65,
    ndvi: 0.32, vegetation: 29, center: [43.516, 25.580],
    color: '#ef4444', elevation: '80–110m',
    description: 'Low carbon, high clay content. Vegetation loss tracked.',
    polygon: [
      [43.518, 25.577],[43.518, 25.584],
      [43.514, 25.584],[43.514, 25.577]
    ]
  },
  {
    id: 8, name: 'Zone 8', cluster: 'South',
    area: 29.85, risk: 'low', riskScore: 15,
    ndvi: 0.71, vegetation: 82, center: [43.512, 25.590],
    color: '#22c55e', elevation: '75–100m',
    description: 'Reference zone — no active erosion. Benchmark for restoration targets.',
    polygon: [
      [43.515, 25.587],[43.515, 25.594],
      [43.509, 25.594],[43.509, 25.587]
    ]
  },
  {
    id: 9, name: 'Zone 9', cluster: 'South',
    area: 2.95, risk: 'low', riskScore: 12,
    ndvi: 0.73, vegetation: 85, center: [43.508, 25.588],
    color: '#22c55e', elevation: '72–90m',
    description: 'Reference zone — excellent vegetation. Used as ecological baseline.',
    polygon: [
      [43.509, 25.587],[43.509, 25.589],
      [43.507, 25.589],[43.507, 25.587]
    ]
  }
];

const NDVI_TREND = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  z2: [0.52, 0.49, 0.44, 0.41, 0.38, 0.36],
  z3: [0.38, 0.34, 0.32, 0.29, 0.27, 0.24]
};

const VEGETATION_BY_ZONE = {
  labels: ['Z1','Z2','Z3','Z4','Z5','Z6','Z7','Z8','Z9'],
  values: [68, 48, 24, 74, 79, 54, 29, 82, 85],
  colors: ['#f59e0b','#f59e0b','#ef4444','#22c55e','#22c55e','#f59e0b','#ef4444','#22c55e','#22c55e']
};

const CARBON_TREND = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  values: [58.2, 60.1, 63.5, 68.4, null, null]
};

const RAINFALL_DATA = {
  labels: ['Apr 20','Apr 21','Apr 22','Apr 23','Apr 24','Apr 25','Apr 26','Apr 27'],
  values: [2, 0, 5, 0, 8, 3, 12, 18]
};

const ALERTS_DATA = [
  {
    severity: 'critical',
    title: 'Vegetation Cover Below 25%',
    description: 'Vegetation cover in Zone 3 has fallen below the 25% threshold. Available seeding window: next 10–12 days.',
    date: 'Apr 27, 2026', zone: 'Z3',
    actions: ['Schedule Seeding', 'View Details']
  },
  {
    severity: 'critical',
    title: 'High Erosion Risk Detected',
    description: 'Quality SMA observations calculated 78/100 risk score for Zone 3. Heavy rainfall forecast increases urgency.',
    date: 'Apr 27, 2026', zone: 'Z3',
    actions: ['Generate Report', 'Notify Site Manager']
  },
  {
    severity: 'critical',
    title: 'Sensor Node Failure — Zone 4',
    description: 'Smart Pin P04 connectivity lost since Apr 25, 2026 14:32. Last reading: Severe erosion detected.',
    date: 'Apr 25, 2026', zone: 'P04',
    actions: ['Restore Device', 'Flood Node']
  },
  {
    severity: 'critical',
    title: 'Potential Slope Instability',
    description: 'Zone 3 western edge (Ш-7 borehole area, 152m elevation) shows soil moisture saturation after 18mm rainfall.',
    date: 'Apr 27, 2026', zone: 'Z3',
    actions: ['Inspect Retaining Map', 'Analyse Trends']
  },
  {
    severity: 'warning',
    title: 'Culvert Blockage Warning',
    description: 'Drainage culvert in Zone 2 shows sediment accumulation. O&M inspection required within 7 days.',
    date: 'Apr 22, 2026', zone: 'Z2',
    actions: ['Restore Device', 'Flood Node']
  },
  {
    severity: 'warning',
    title: 'Weather Alert: Flood Risk',
    description: 'Open-Meteo 3-day forecast shows 45mm accumulated rainfall. Zone 3 and Zone 7 at elevated flood risk.',
    date: 'Apr 26, 2026', zone: 'Z3/Z7',
    actions: ['Deploy Measures', 'Display Alerts']
  }
];

const CARBON_TABLE_DATA = [
  { field: 'Tsenovo Farm', date: '2026-03-15', depth: '0–15', som: '3.51', bd: '1.34', carbon: '68.42', co2: '251.1', change: '+12.3' },
  { field: 'Tsenovo Farm', date: '2026-01-10', depth: '0–15', som: '3.12', bd: '1.36', carbon: '60.32', co2: '221.4', change: '+5.7' },
  { field: 'Tsenovo Farm', date: '2025-10-20', depth: '5–15', som: '2.89', bd: '1.38', carbon: '55.91', co2: '205.2', change: 'ref' },
  { field: 'Tsenovo Farm', date: '2025-06-01', depth: '0–15', som: '2.71', bd: '1.41', carbon: '49.18', co2: '180.5', change: '-3.1' },
  { field: 'Tsenovo Farm', date: '2025-03-14', depth: '5–15', som: '2.55', bd: '1.42', carbon: '43.92', co2: '161.2', change: 'ref' }
];

const BIRD_DATA = [
  { name: 'Eurasian Skylark', species: 'Alauda arvensis', count: 8, trend: '↑' },
  { name: 'Common Buzzard', species: 'Buteo buteo', count: 3, trend: '→' },
  { name: 'European Bee-eater', species: 'Merops apiaster', count: 12, trend: '↑' },
  { name: 'Black Kite', species: 'Milvus migrans', count: 2, trend: '↓' },
  { name: 'Northern Lapwing', species: 'Vanellus vanellus', count: 6, trend: '→' }
];
