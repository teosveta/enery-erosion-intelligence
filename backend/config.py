"""
Erosion Intelligence Platform — Configuration
All API keys, credentials, and site data live here.
Secrets are loaded from backend/.env (never commit that file).
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the same directory as this file (backend/.env)
load_dotenv(Path(__file__).parent / ".env")

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent.parent          # enery-dashboard/
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR     = BASE_DIR / "data"
ANALYSIS_DIR = DATA_DIR / "analysis"
CACHE_DIR    = DATA_DIR / "cache"
UPLOADS_DIR  = DATA_DIR / "uploads"
SITES_DIR    = DATA_DIR / "sites"

# Smart Erosion Pin timelapse folder (Windows WSL network path)
TIMELAPSE_PATH_WINDOWS = r"\\wsl$\Ubuntu\home\tea\timelapse"
TIMELAPSE_PATH_LINUX   = "/home/tea/timelapse"

def get_timelapse_path() -> Path:
    """Return the timelapse path that exists on this machine."""
    p_win = Path(TIMELAPSE_PATH_WINDOWS)
    p_lin = Path(TIMELAPSE_PATH_LINUX)
    if p_win.exists():
        return p_win
    if p_lin.exists():
        return p_lin
    # Fallback: local mock folder (created by installer if missing)
    mock = DATA_DIR / "timelapse_mock"
    mock.mkdir(parents=True, exist_ok=True)
    return mock

# ── Gemini ──────────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    import warnings
    warnings.warn(
        "GEMINI_API_KEY is not set. AI features will be unavailable. "
        "Create backend/.env with GEMINI_API_KEY=<your key>.",
        RuntimeWarning,
        stacklevel=2,
    )

GEMINI_MODEL = "gemini-2.0-flash"

def get_gemini_url() -> str:
    """Build Gemini URL dynamically so key changes are picked up at runtime."""
    key = os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY or ""
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={key}"
    )

# Convenience alias — evaluated once at import but key is already loaded via load_dotenv()
GEMINI_URL = get_gemini_url()
GEMINI_SYSTEM_INSTRUCTION = """
You are the AI engine of the Erosion Intelligence Platform — a monitoring system for soil erosion at solar PV parks. Your primary tasks:

1. PHOTO ANALYSIS: When given a photo from a Smart Erosion Pin or Photo Monitoring upload, analyze it and return a JSON object with:
   - vegetation_cover_percent (integer 0-100)
   - soil_color ("dark_organic" | "medium" | "light_eroded" | "mixed")
   - moisture_estimate ("dry" | "moist" | "wet" | "saturated")
   - erosion_features (array of: "gully", "rill", "bare_patch", "sediment_deposit", "crust", "none")
   - erosion_severity ("none" | "low" | "moderate" | "high" | "severe")
   - vegetation_types (array of: "grass", "moss", "weeds", "crop_residue", "none")
   - change_notes (string — any notable observations)
   - confidence (float 0-1)

2. EROSION RISK SCORING: When given environmental data (precipitation mm, soil type, slope degrees, NDVI value, current vegetation cover %), calculate a composite Erosion Risk Score and return:
   - risk_score (integer 0-100)
   - risk_level ("low" | "moderate" | "high" | "critical")
   - contributing_factors (ranked array of strings)
   - recommended_actions (array of strings)

3. ESG REPORT GENERATION: When given aggregated monitoring data, generate professional ESG report paragraphs covering soil health, carbon sequestration, biodiversity, and erosion control effectiveness.

4. CHANGE DETECTION: When given two photos (before/after), compare them and describe changes in vegetation, erosion, and soil condition.

Always respond with valid JSON when performing analysis tasks. Use scientific terminology appropriate for environmental monitoring. Reference relevant metrics (NDVI, SOM, Shannon H index) when applicable. Be concise but precise.
""".strip()

# ── Copernicus / Sentinel Hub ───────────────────────────────────────────────
COPERNICUS_CLIENT_ID     = os.getenv("COPERNICUS_CLIENT_ID")
COPERNICUS_CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET")
if not COPERNICUS_CLIENT_ID or not COPERNICUS_CLIENT_SECRET:
    import warnings
    warnings.warn(
        "Copernicus credentials not set — NDVI satellite data will be unavailable. "
        "Set COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET in backend/.env.",
        RuntimeWarning,
        stacklevel=2,
    )
COPERNICUS_TOKEN_URL     = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
COPERNICUS_PROCESS_URL   = "https://sh.dataspace.copernicus.eu/api/v1/process"

# ── Open-Meteo ──────────────────────────────────────────────────────────────
WEATHER_BASE_URL  = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_BASE_URL = "https://api.open-meteo.com/v1/forecast"

# ── SoilGrids ───────────────────────────────────────────────────────────────
SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"

# ── GBIF ────────────────────────────────────────────────────────────────────
GBIF_BASE_URL = "https://api.gbif.org/v1"

# ── Alert Thresholds ─────────────────────────────────────────────────────────
RAINFALL_ALERT_MM     = 15.0   # mm/hour triggers alert
NDVI_ALERT_THRESHOLD  = 0.30   # NDVI below this = alert
VEG_COVER_ALERT_PCT   = 25     # vegetation % below this = alert

# ── Site Configuration — Tsenovo Solar Park ─────────────────────────────────
TSENOVO_SITE = {
    "id":        "tsenovo",
    "name":      "Tsenovo Solar Park",
    "location":  "Dzhulyunitsa, Tsenovo Municipality, Ruse District, Bulgaria",
    "lat":        43.5556,
    "lon":        25.5918,
    "capacity_mwp": 63.01,
    "total_area_ha": 147.19,
    "soil_type":  "Silty clay loam (Chernozem)",
    "natura2000": "Yantra River corridor (BG0000610)",
    "zones": [
        {
            "id": 1, "name": "Zone 1", "cluster": "North",
            "area_ha": 33.66, "center": [43.588, 25.620],
            "elevation_range": [69, 128], "slope_deg": 2.1,
            "parcel": "20849.9.8",
            "polygon": [
                [43.594, 25.616],[43.594, 25.623],[43.591, 25.626],
                [43.586, 25.625],[43.583, 25.620],[43.586, 25.615],
                [43.591, 25.614]
            ]
        },
        {
            "id": 2, "name": "Zone 2", "cluster": "Middle",
            "area_ha": 5.92, "center": [43.5605, 25.5920],
            "elevation_range": [85, 112], "slope_deg": 1.8,
            "parcel": "20849.18.19",
            "polygon": [
                [43.562, 25.590],[43.562, 25.595],
                [43.559, 25.595],[43.559, 25.590]
            ]
        },
        {
            "id": 3, "name": "Zone 3", "cluster": "Middle",
            "area_ha": 41.96, "center": [43.5556, 25.5918],
            "elevation_range": [82, 152], "slope_deg": 3.5,
            "parcel": "20849.27.53",
            "primary_focus": True,
            "polygon": [
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
            "id": 4, "name": "Zone 4", "cluster": "South",
            "area_ha": 5.12, "center": [43.520, 25.575],
            "elevation_range": [90, 115], "slope_deg": 1.5,
            "polygon": [
                [43.521,25.573],[43.521,25.577],[43.519,25.577],[43.519,25.573]
            ]
        },
        {
            "id": 5, "name": "Zone 5", "cluster": "South",
            "area_ha": 6.91, "center": [43.523, 25.577],
            "elevation_range": [95, 125], "slope_deg": 1.8,
            "polygon": [
                [43.525,25.575],[43.525,25.580],[43.521,25.580],[43.521,25.575]
            ]
        },
        {
            "id": 6, "name": "Zone 6", "cluster": "South",
            "area_ha": 6.27, "center": [43.522, 25.585],
            "elevation_range": [88, 118], "slope_deg": 2.0,
            "polygon": [
                [43.524,25.583],[43.524,25.588],[43.520,25.588],[43.520,25.583]
            ]
        },
        {
            "id": 7, "name": "Zone 7", "cluster": "South",
            "area_ha": 14.55, "center": [43.516, 25.580],
            "elevation_range": [80, 110], "slope_deg": 2.5,
            "polygon": [
                [43.518,25.577],[43.518,25.584],[43.514,25.584],[43.514,25.577]
            ]
        },
        {
            "id": 8, "name": "Zone 8", "cluster": "South",
            "area_ha": 29.85, "center": [43.512, 25.590],
            "elevation_range": [75, 100], "slope_deg": 1.2,
            "reference_zone": True,
            "polygon": [
                [43.515,25.587],[43.515,25.594],[43.509,25.594],[43.509,25.587]
            ]
        },
        {
            "id": 9, "name": "Zone 9", "cluster": "South",
            "area_ha": 2.95, "center": [43.508, 25.588],
            "elevation_range": [72, 90], "slope_deg": 1.0,
            "reference_zone": True,
            "polygon": [
                [43.509,25.587],[43.509,25.589],[43.507,25.589],[43.507,25.587]
            ]
        },
    ],
    "smart_pins": [
        {"id": "P04", "zone": 3, "lat": 43.5559, "lon": 25.5906, "status": "active"},
        {"id": "P08", "zone": 3, "lat": 43.5551, "lon": 25.5896, "status": "active"},
        {"id": "P11", "zone": 3, "lat": 43.5568, "lon": 25.5949, "status": "active"},
        {"id": "P15", "zone": 3, "lat": 43.5574, "lon": 25.5911, "status": "active"},
        {"id": "P02", "zone": 1, "lat": 43.588,  "lon": 25.620,  "status": "active"},
        {"id": "P07", "zone": 7, "lat": 43.516,  "lon": 25.580,  "status": "active"},
        {"id": "P12", "zone": 8, "lat": 43.512,  "lon": 25.590,  "status": "active"},
        {"id": "P18", "zone": 3, "lat": 43.5585, "lon": 25.5943, "status": "offline"},
    ]
}

# All registered sites (multi-site scalability)
ALL_SITES = {"tsenovo": TSENOVO_SITE}
DEFAULT_SITE_ID = "tsenovo"
