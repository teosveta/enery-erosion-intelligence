# Erosion Intelligence Platform

**AI-powered soil erosion monitoring for solar PV parks**
Built for the AmCham Innovation Hackathon 2026 · Tsenovo Solar Park, Bulgaria

---

## Overview

The Erosion Intelligence Platform is a full-stack environmental monitoring system that combines custom-built field hardware with satellite data, biodiversity databases, AI vision analysis, and a real-time web dashboard. It was built for the 63 MWp Tsenovo Solar Park (147.19 ha, Ruse District, Bulgaria) — a site with nine distinct monitoring zones and significant erosion risk in Zone 3 due to a 70-metre elevation gradient.

The platform answers a single critical question for solar park operators and ESG stakeholders: **Is the soil healthy, and is erosion getting worse or better?**

---

## Table of Contents

1. [Hardware — Smart Erosion Pins](#1-hardware--smart-erosion-pins)
2. [Software Architecture](#2-software-architecture)
3. [Data Sources & External APIs](#3-data-sources--external-apis)
4. [AI & Machine Learning](#4-ai--machine-learning)
5. [Dashboard Sections](#5-dashboard-sections)
6. [File Structure](#6-file-structure)
7. [Setup & Running](#7-setup--running)
8. [API Reference](#8-api-reference)
9. [Site Configuration — Tsenovo](#9-site-configuration--tsenovo)
10. [ESG & Reporting](#10-esg--reporting)

---

## 1. Hardware — Smart Erosion Pins

### What they are

Smart Erosion Pins are custom field monitoring devices installed directly in the soil at erosion-prone locations. They are the primary data-collection sensors of the platform.

Each pin is a physical stake driven into the ground. As erosion removes soil around it, the exposed length of the pin increases — giving a direct, continuous measure of how much soil has been lost.

### Camera & timelapse system

Each pin hosts a camera module that captures timelapse photographs at regular intervals. The photos are stored in a watched folder:

| Environment | Path |
|---|---|
| Windows (via WSL) | `\\wsl$\Ubuntu\home\tea\timelapse` |
| Linux / WSL native | `/home/tea/timelapse` |
| Fallback (offline) | `data/timelapse_mock/` |

Images are named by capture timestamp: `2026-04-28_11-09-15.jpg`  
Supported formats: `.jpg`, `.jpeg`, `.png`, `.bmp`

### Active monitoring pins — Zone 3

| Pin ID | Latitude | Longitude | Status |
|--------|----------|-----------|--------|
| P04 | 43.5559 | 25.5906 | Active |
| P08 | 43.5551 | 25.5896 | Active |
| P11 | 43.5568 | 25.5949 | Active |
| P15 | 43.5574 | 25.5911 | Active |
| P18 | 43.5585 | 25.5943 | Offline |

Additional pins at Zone 1 (P02), Zone 7 (P07), and Zone 8 (P12) serve as reference sensors.

### Automatic image processing pipeline

```
Camera captures photo
       ↓
Saved to timelapse folder
       ↓
Backend watcher polls every 60 seconds
       ↓
New image detected → AI vision analysis (OpenRouter / GPT-4o mini)
       ↓
Results stored in JSON database (data/analysis/)
       ↓
Live dashboard updated on next refresh
```

Only images that arrive *after* the backend started are analysed automatically. Existing images are skipped on startup to avoid re-processing. Any image can also be analysed on demand by clicking it in the dashboard.

---

## 2. Software Architecture

### Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 · FastAPI · Uvicorn (async, hot-reload) |
| Frontend | Vanilla HTML/CSS/JavaScript (no build step) |
| Data persistence | JSON files under `data/` (no database server required) |
| HTTP client | httpx (async) |
| File I/O | aiofiles (async) |
| AI | OpenRouter API → OpenAI-compatible chat completions |

### Backend services

```
backend/
├── main.py               # FastAPI app, all REST endpoints, startup/shutdown
├── config.py             # All configuration, API keys, site data
├── db.py                 # JSON file store (analysis, cache, uploads, soil, risk)
├── services/
│   ├── ai.py             # AI vision analysis, risk scoring, ESG report, insights
│   ├── weather.py        # Open-Meteo historical + forecast weather
│   ├── copernicus.py     # Sentinel-2 NDVI via Copernicus Sentinel Hub
│   ├── soilgrids.py      # SoilGrids ISRIC soil properties
│   ├── gbif.py           # GBIF species occurrence + Shannon H′ diversity
│   ├── carbon.py         # Soil carbon calculator (SOM → tC/ha → CO₂e)
│   ├── nasa_power.py     # NASA POWER solar irradiance data
│   └── pvgis.py          # PVGIS photovoltaic energy estimates
└── watchers/
    └── timelapse.py      # Background folder watcher for new pin photos
```

### Frontend structure

```
frontend/
├── index.html            # Single-page app shell, navigation, section containers
├── css/
│   └── style.css         # Full design system (dark theme, CSS variables, animations)
└── js/
    ├── live.js            # Real-time data engine: fetches, renders, modals, charts
    └── app.js             # Navigation, section switching, global UI utilities
```

### Data storage layout

```
data/
├── analysis/
│   ├── index.json         # Ordered list of all AI analyses (last 500)
│   └── P04_20260428_*.json  # Individual analysis records
├── cache/
│   └── *.json             # Time-bounded API response cache (TTL per service)
├── uploads/
│   ├── index.json         # Manual upload records
│   └── photo_*.jpg        # Uploaded monitoring photos
├── soil_lab.json          # Manual soil lab entries (SOM, bulk density, pH, NPK)
└── risk_scores.json       # AI-generated erosion risk scores per zone
```

---

## 3. Data Sources & External APIs

### Open-Meteo — weather (free, no key)

- **Historical archive**: hourly precipitation, temperature, wind speed, cloud cover for the last ~2 months
- **3-day forecast**: precipitation forecast used to predict upcoming erosion risk events
- **Alert threshold**: ≥15 mm/hour rainfall triggers a high-risk alert
- Cache TTL: 1 hour

### Copernicus Sentinel Hub — NDVI satellite imagery

- **Satellite**: Sentinel-2 L2A (10 m resolution)
- **Data**: NDVI (Normalised Difference Vegetation Index) per zone polygon
- **Evalscript**: `NDVI = (B08 − B04) / (B08 + B04)` — standard red-edge formula
- **Method**: Statistics API, 5-day aggregation intervals, max 30% cloud cover
- **Alert threshold**: NDVI < 0.30 flags critical vegetation loss
- **Credentials**: OAuth2 client credentials (Copernicus Data Space)
- Cache TTL: 6 hours

### SoilGrids ISRIC — soil physical properties

- **Properties fetched**: soil organic carbon, bulk density, clay/silt/sand fractions
- **Depths**: 0–5 cm, 5–15 cm, 15–30 cm
- **Endpoint**: `https://rest.isric.org/soilgrids/v2.0/properties/query`
- Free, no authentication required
- Cache TTL: 24 hours

### GBIF — Global Biodiversity Information Facility

- **Data**: species occurrence records within ~5 km of site coordinates
- **Taxon groups monitored**: birds (Aves), insects (Insecta), plants (Plantae), mammals (Mammalia), amphibians, reptiles
- **Computed metrics**: Shannon H′ diversity index, species richness, evenness, top-10 species
- Free, no authentication required
- Cache TTL: 12 hours

### NASA POWER — solar irradiance

- Historical daily solar irradiance and clear-sky data for the site coordinates
- Used for PV performance context in the dashboard
- Free API

### PVGIS — photovoltaic energy estimates

- European Commission Joint Research Centre tool
- Estimates annual and monthly PV energy output for the 63 MWp array
- Free API

---

## 4. AI & Machine Learning

### Vision model

| Property | Value |
|---|---|
| Provider | OpenRouter |
| Model | `openai/gpt-4o-mini` |
| Context | 128K tokens |
| Vision | Yes — base64-encoded JPEG/PNG |
| Cost | ~$0.000003 per analysis call |
| Auth | `OPENROUTER_API_KEY` in `backend/.env` |

### AI task 1 — Photo analysis (primary)

Triggered by:
- Background watcher finding a new timelapse image
- User clicking a pin photo in the dashboard ("on-demand" analysis)
- Manual photo upload in the Photo Monitoring section

The model receives the image encoded as base64 alongside a detailed structured prompt. It returns a JSON object with twelve fields:

| Field | Type | Description |
|---|---|---|
| `vegetation_cover_percent` | int 0–100 | Fraction of ground covered by plants |
| `soil_color` | enum | `dark_organic` · `medium` · `light_eroded` · `mixed` |
| `moisture_estimate` | enum | `dry` · `moist` · `wet` · `saturated` |
| `erosion_features` | array | Any of: `gully`, `rill`, `bare_patch`, `sediment_deposit`, `crust` |
| `erosion_severity` | enum | `none` · `low` · `moderate` · `high` · `severe` |
| `vegetation_types` | array | Any of: `grass`, `moss`, `weeds`, `crop_residue`, `shrub` |
| `vegetation_health` | enum | `poor` · `fair` · `good` · `excellent` |
| `soil_stability` | enum | `unstable` · `at_risk` · `stable` · `well_established` |
| `water_runoff_signs` | boolean | Visible runoff channels or sediment trails |
| `change_notes` | string | 2–3 specific sentences about what is visible in the photo |
| `recommended_action` | string | One concrete actionable recommendation |
| `confidence` | float 0–1 | Model confidence in the assessment |

### AI task 2 — Erosion risk scoring

Given environmental inputs (precipitation, NDVI, vegetation cover %, slope degrees, soil type, zone ID), the model computes a composite **Erosion Risk Score (0–100)** and returns:
- `risk_score`, `risk_level`
- `contributing_factors` — ranked list of causes
- `recommended_actions` — prioritised mitigation steps

### AI task 3 — ESG report generation

The model synthesises all monitoring data into a professional ESG sustainability report covering:
1. Executive summary
2. Erosion risk assessment
3. Vegetation and NDVI analysis
4. Soil carbon accounting
5. Biodiversity assessment
6. Actionable recommendations

A data-driven fallback report is generated automatically if the AI call fails.

### AI task 4 — Change detection (before/after)

Two photos are sent simultaneously. The model compares them and returns vegetation change percentage, erosion progression status, new features identified, and resolved features.

### AI task 5 — Analytics insights

Given live metrics (NDVI, risk score, carbon stock, Shannon H′, species richness, avg vegetation %), the model generates three ecosystem insight cards and two recommendations for the Analytics section.

### Rate limiting & resilience

The backend handles OpenRouter rate limits gracefully:

| Error type | Behaviour |
|---|---|
| Per-minute throttle (429) | Retry at 20 s → 40 s → 65 s (outlasts the 60 s window) |
| Per-day limit exhausted | Fast-fail immediately with clear message — no wasted retries |
| AI unavailable | Upload endpoints save the photo/data and return `ai_error` field; ESG report uses data-driven fallback |

### Soil carbon calculations (deterministic, no AI)

The `services/carbon.py` module implements the standard IPCC/pedology formula chain:

```
SOM (%)  →  × 0.58 (Van Bemmelen factor)  →  Organic Carbon (%)
Organic Carbon × Bulk Density × Depth × 100 / 1000  →  Carbon Stock (tC/ha)
Carbon Stock × 3.67  →  CO₂ equivalent (tCO₂e/ha)
```

Sequestration rate is computed from time-series lab records. A 10-year projection trajectory is built for ESG reporting.

### Biodiversity index (deterministic, no AI)

Shannon H′ entropy is computed from GBIF species occurrence counts:

```
H′ = −Σ (pᵢ × ln pᵢ)   where pᵢ = count(species i) / total observations
```

Evenness = H′ / ln(S) where S = species richness.

---

## 5. Dashboard Sections

| Section | What it shows |
|---|---|
| **Overview** | Live risk gauge (0–100), NDVI Zone 3, weather alerts, latest pin photo, before/after comparison |
| **Smart Erosion Pins** | Clickable photo grid (last 12 images), animated AI analysis modal on click |
| **Zones** | Zone-by-zone map, NDVI per zone, risk scores, zone statistics |
| **Weather** | Historical precipitation chart, 3-day forecast, rainfall alert history |
| **Biodiversity** | GBIF species groups, Shannon H′, top species list, taxon breakdown |
| **Carbon** | Soil carbon stock, CO₂ equivalent, SOM entry form, trajectory chart |
| **Analytics** | AI-generated ecosystem insights, multi-metric correlations |
| **Photo Monitoring** | Manual photo upload → instant AI analysis, upload history |
| **Field Data Upload** | CSV/manual entry for pollen, bird counts, soil lab data |
| **ESG Report** | Full AI-generated sustainability report, downloadable |

### Smart Pin analysis modal

Clicking any photo in the Smart Erosion Pins feed opens a modal that:
1. Shows the full-resolution image with capture timestamp and file size
2. Displays three animated loading steps (scan → vegetation → erosion risk)
3. Replaces the loader with a rich results card:
   - Glowing severity indicator with colour coding
   - Animated fill bars for vegetation coverage and AI confidence
   - Property grid: moisture, soil colour, plant health, soil stability
   - Red runoff warning banner (if detected)
   - Colour-coded erosion feature tags (red) and vegetation type tags (green)
   - AI observations block
   - Recommended action card

---

## 6. File Structure

```
enery-dashboard/
├── README.md
├── backend/
│   ├── .env                    ← secrets (never commit)
│   ├── requirements.txt
│   ├── config.py
│   ├── main.py
│   ├── db.py
│   ├── services/
│   │   ├── ai.py
│   │   ├── carbon.py
│   │   ├── copernicus.py
│   │   ├── gbif.py
│   │   ├── nasa_power.py
│   │   ├── pvgis.py
│   │   ├── soilgrids.py
│   │   └── weather.py
│   └── watchers/
│       └── timelapse.py
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       └── live.js
└── data/
    ├── analysis/
    ├── cache/
    ├── uploads/
    ├── soil_lab.json
    └── risk_scores.json
```

---

## 7. Setup & Running

### Prerequisites

- Python 3.11+
- pip
- (Optional) WSL with Ubuntu for the timelapse camera path

### 1. Install backend dependencies

```bash
cd backend
pip install fastapi uvicorn httpx aiofiles python-dotenv python-multipart
```

### 2. Create `backend/.env`

```env
# OpenRouter AI (required for photo analysis, ESG reports, insights)
OPENROUTER_API_KEY=sk-or-v1-...

# Copernicus Sentinel Hub (required for NDVI satellite data)
COPERNICUS_CLIENT_ID=sh-...
COPERNICUS_CLIENT_SECRET=...
```

> **Cost note:** The platform uses `openai/gpt-4o-mini` via OpenRouter at ~$0.000003 per call.  
> $5 of credits covers approximately 1.6 million analysis calls.

### 3. Start the backend

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend serves the frontend static files automatically.  
Open: **http://localhost:8000**

API documentation: **http://localhost:8000/api/docs**

### 4. Smart Erosion Pin camera (optional)

Place JPEG images in the timelapse folder:
- Windows: `\\wsl$\Ubuntu\home\tea\timelapse\`
- Linux: `/home/tea/timelapse/`

New images are detected within 60 seconds and analysed automatically.

### Alert thresholds (configurable in `config.py`)

| Metric | Alert threshold |
|---|---|
| Rainfall | ≥ 15 mm/hour |
| NDVI | < 0.30 |
| Vegetation cover | < 25% |

---

## 8. API Reference

All endpoints are prefixed with `/api/`. Interactive docs at `/api/docs`.

### Core endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server status, timelapse watcher state |
| GET | `/api/dashboard` | Aggregated live data for the main dashboard |
| GET | `/api/sites` | All registered sites |

### Weather

| Method | Path | Description |
|---|---|---|
| GET | `/api/weather` | Historical weather for site coordinates |
| GET | `/api/weather/forecast` | 3-day precipitation forecast |

### NDVI & Vegetation

| Method | Path | Description |
|---|---|---|
| GET | `/api/ndvi` | Current NDVI for Zone 3 (primary focus) |
| GET | `/api/ndvi/all-zones` | NDVI for all nine zones (parallel fetch) |

### Smart Erosion Pins

| Method | Path | Description |
|---|---|---|
| GET | `/api/timelapse/images` | List images in the timelapse folder |
| GET | `/api/timelapse/image/{filename}` | Serve a specific timelapse image |
| POST | `/api/smart-pin/trigger` | Trigger analysis of the latest image |
| POST | `/api/smart-pin/analyze-image?filename=X` | Analyse a specific image on demand |
| GET | `/api/smart-pin/latest-analysis` | Most recent stored analysis result |
| GET | `/api/smart-pin/history` | Full analysis history (last 50 records) |

### AI analysis

| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/risk-score` | Compute erosion risk score for a zone |
| GET | `/api/ai/report` | Generate full ESG report |
| GET | `/api/ai/analytics-insights` | Generate analytics insight cards |

### Photo monitoring & uploads

| Method | Path | Description |
|---|---|---|
| POST | `/api/upload/photo` | Upload a photo, triggers AI analysis |
| POST | `/api/upload/soil` | Upload soil lab data (JSON or CSV) |
| POST | `/api/upload/pollen` | Upload pollen count CSV |
| POST | `/api/upload/birds` | Upload bird observation CSV |
| GET | `/api/uploads` | List recent uploads |

### Soil carbon

| Method | Path | Description |
|---|---|---|
| POST | `/api/carbon/calculate` | Calculate carbon stock from SOM inputs |
| GET | `/api/carbon/history` | Historical carbon records |
| GET | `/api/carbon/trajectory` | 10-year projected carbon trajectory |

### Biodiversity

| Method | Path | Description |
|---|---|---|
| GET | `/api/biodiversity` | GBIF occurrence data + Shannon H′ index |
| GET | `/api/biodiversity/species` | Full species list |

### Soil & environment

| Method | Path | Description |
|---|---|---|
| GET | `/api/soilgrids` | Soil physical properties from ISRIC SoilGrids |

---

## 9. Site Configuration — Tsenovo

The full site model is defined in `config.py` under `TSENOVO_SITE`.

| Parameter | Value |
|---|---|
| Site name | Tsenovo Solar Park |
| Location | Dzhulyunitsa, Tsenovo Municipality, Ruse District, Bulgaria |
| Coordinates | 43.5556 °N, 25.5918 °E |
| Capacity | 63.01 MWp |
| Total area | 147.19 ha |
| Soil type | Silty clay loam (Chernozem) |
| Natura 2000 | Yantra River corridor (BG0000610) |
| Zones | 9 (North cluster: 1; Middle cluster: 2–3; South cluster: 4–9) |

### Zone summary

| Zone | Area (ha) | Slope | Role |
|------|-----------|-------|------|
| 1 | 33.66 | 2.1° | North cluster |
| 2 | 5.92 | 1.8° | Middle cluster |
| **3** | **41.96** | **3.5°** | **Primary erosion focus** |
| 4–7 | 5–15 | 1.5–2.5° | South cluster |
| 8 | 29.85 | 1.2° | Reference zone |
| 9 | 2.95 | 1.0° | Reference zone |

Zone 3 is the critical area: the steepest slope (3.5°), largest contiguous area (41.96 ha), a 70-metre elevation gradient from 82 m to 152 m, and the highest concentration of monitoring pins.

---

## 10. ESG & Reporting

The platform directly supports ESG (Environmental, Social, Governance) reporting requirements for solar park operators and investors.

### Metrics tracked

| Category | Metric | Source |
|---|---|---|
| Soil health | Erosion severity per zone | AI photo analysis |
| Soil health | SOM %, bulk density, pH, NPK | Manual lab upload |
| Soil health | Soil carbon stock (tC/ha) | Calculated (IPCC formula) |
| Vegetation | NDVI (Sentinel-2) | Copernicus satellite |
| Vegetation | Cover % per pin | AI photo analysis |
| Biodiversity | Shannon H′ index | GBIF occurrence data |
| Biodiversity | Species richness | GBIF occurrence data |
| Biodiversity | Taxon group breakdown | GBIF occurrence data |
| Climate | CO₂ equivalent sequestered | Calculated |
| Climate | 10-year carbon trajectory | Projected from lab records |

### Automated ESG report sections

1. **Sustainable Farming Position** — site overview, monitoring methodology
2. **Soil Health Assessment** — zone-by-zone erosion risk, severity distribution
3. **Carbon Sequestration Progress** — current stock vs. 2030 target (50 tC/ha)
4. **Biodiversity & Ecosystem Services** — species diversity, Natura 2000 compliance, key indicator species

The ESG report is generated on demand from the dashboard and can be exported as text for inclusion in sustainability disclosures, investor reports, or regulatory submissions.

---

## Acknowledgements

- **Sentinel-2 imagery** — European Space Agency / Copernicus Data Space Ecosystem
- **Species occurrence data** — Global Biodiversity Information Facility (GBIF.org)
- **Soil data** — ISRIC World Soil Information (SoilGrids)
- **Weather data** — Open-Meteo (open-source weather API)
- **Solar data** — NASA POWER, European Commission PVGIS
- **AI backbone** — OpenRouter · OpenAI GPT-4o mini

---

*Erosion Intelligence Platform · AmCham Hackathon 2026 · Built for Tsenovo Solar Park, Bulgaria*
