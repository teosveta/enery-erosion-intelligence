"""
Erosion Intelligence Platform — FastAPI Backend
Serves the frontend static files + REST API endpoints.

Start: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import logging
import mimetypes
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import (
    FRONTEND_DIR, DATA_DIR, UPLOADS_DIR,
    TSENOVO_SITE, ALL_SITES, DEFAULT_SITE_ID,
    NDVI_ALERT_THRESHOLD, VEG_COVER_ALERT_PCT, RAINFALL_ALERT_MM,
)
import db
from services import gemini, weather, copernicus, soilgrids, gbif, carbon
from watchers import timelapse

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("main")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Erosion Intelligence Platform API",
    description="AI-powered erosion monitoring for Tsenovo Solar Park",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Serve frontend static files ───────────────────────────────────────────────
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
    log.info("Serving frontend from: %s", FRONTEND_DIR)

# ── Startup / Shutdown ────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    log.info("Erosion Intelligence Platform starting up...")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    # Start Smart Pin watcher in background
    asyncio.create_task(timelapse.run_watcher(poll_interval_secs=60))
    log.info("Smart Pin timelapse watcher scheduled.")

@app.on_event("shutdown")
async def shutdown():
    timelapse.stop_watcher()
    log.info("Erosion Intelligence Platform shut down.")

# ═══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "site": DEFAULT_SITE_ID,
        "timelapse": timelapse.watcher_status(),
    }

# ── Sites ─────────────────────────────────────────────────────────────────────
@app.get("/api/sites")
async def list_sites():
    return [{"id": k, "name": v["name"], "location": v["location"]} for k, v in ALL_SITES.items()]

@app.get("/api/sites/{site_id}")
async def get_site(site_id: str):
    site = ALL_SITES.get(site_id)
    if not site:
        raise HTTPException(404, f"Site '{site_id}' not found")
    return site

# ── Zones ─────────────────────────────────────────────────────────────────────
@app.get("/api/zones")
async def get_zones(site_id: str = DEFAULT_SITE_ID):
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    zones = site["zones"]

    # Enrich each zone with latest risk score
    risk_scores = await db.get_latest_risk()
    risk_by_zone = {r["zone"]: r for r in (risk_scores or [])}

    enriched = []
    for z in zones:
        zid = z["id"]
        enriched.append({
            **z,
            "risk_score":    risk_by_zone.get(zid, {}).get("risk_score"),
            "risk_level":    risk_by_zone.get(zid, {}).get("risk_level"),
        })
    return enriched

@app.get("/api/zones/{zone_id}")
async def get_zone(zone_id: int, site_id: str = DEFAULT_SITE_ID):
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    zone = next((z for z in site["zones"] if z["id"] == zone_id), None)
    if not zone:
        raise HTTPException(404, f"Zone {zone_id} not found")

    risk = await db.get_latest_risk(zone_id)
    analyses = await db.get_analysis_history(limit=10)
    zone_analyses = [a for a in analyses if a.get("zone") == zone_id]

    return {
        **zone,
        "risk":        risk,
        "recent_analyses": zone_analyses[-5:],
    }

# ── Smart Pin ─────────────────────────────────────────────────────────────────
@app.get("/api/smart-pin/status")
async def pin_status():
    return {
        "watcher": timelapse.watcher_status(),
        "pins": TSENOVO_SITE["smart_pins"],
    }

@app.get("/api/smart-pin/latest-analysis")
async def latest_pin_analysis(pin_id: Optional[str] = None):
    analysis = await db.get_latest_analysis(pin_id)
    if not analysis:
        return {"message": "No analysis available yet. Waiting for first timelapse image."}
    return analysis

@app.get("/api/smart-pin/history")
async def pin_analysis_history(pin_id: Optional[str] = None, limit: int = 50):
    return await db.get_analysis_history(pin_id, limit)

@app.post("/api/smart-pin/analyze-now")
async def trigger_manual_analysis(background_tasks: BackgroundTasks):
    """Manually trigger analysis of the latest timelapse image."""
    from config import get_timelapse_path
    from watchers.timelapse import IMAGE_EXTENSIONS
    folder = get_timelapse_path()
    if not folder.exists():
        return {"message": "Timelapse folder not found", "path": str(folder)}
    images = [f for f in folder.iterdir() if f.suffix.lower() in IMAGE_EXTENSIONS]
    if not images:
        return {"message": "No images found in timelapse folder"}
    latest = max(images, key=lambda f: f.stat().st_mtime)

    async def _do():
        from watchers.timelapse import _process_image
        await _process_image(latest)

    background_tasks.add_task(_do)
    return {"message": f"Analysis triggered for {latest.name}", "file": latest.name}

# ── Weather ───────────────────────────────────────────────────────────────────
@app.get("/api/weather")
async def get_weather(
    lat: float = TSENOVO_SITE["lat"],
    lon: float = TSENOVO_SITE["lon"],
    days_back: int = 58,
):
    hist = await weather.get_historical(lat, lon, days_back=days_back)
    fc   = await weather.get_forecast(lat, lon)
    summary = weather.summarize_weather(hist, fc)
    return {
        "summary":  summary,
        "historical": {
            "time":          hist.get("hourly", {}).get("time", [])[-72:],
            "precipitation": hist.get("hourly", {}).get("precipitation", [])[-72:],
            "temperature":   hist.get("hourly", {}).get("temperature_2m", [])[-72:],
            "windspeed":     hist.get("hourly", {}).get("windspeed_10m", [])[-72:],
        },
        "forecast": fc.get("daily", {}),
    }

@app.get("/api/weather/alerts")
async def get_weather_alerts(
    lat: float = TSENOVO_SITE["lat"],
    lon: float = TSENOVO_SITE["lon"],
):
    hist = await weather.get_historical(lat, lon, days_back=10)
    alerts = weather.detect_rainfall_alerts(hist, threshold_mm=RAINFALL_ALERT_MM)
    return {"alerts": alerts, "count": len(alerts), "threshold_mm": RAINFALL_ALERT_MM}

# ── NDVI / Satellite ──────────────────────────────────────────────────────────
@app.get("/api/ndvi")
async def get_ndvi(zone_id: int = 3, site_id: str = DEFAULT_SITE_ID):
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    zone = next((z for z in site["zones"] if z["id"] == zone_id), None)
    if not zone:
        raise HTTPException(404, f"Zone {zone_id} not found")
    result = await copernicus.fetch_ndvi(zone["polygon"], zone_id=zone_id)
    return result

@app.get("/api/ndvi/all-zones")
async def get_ndvi_all(site_id: str = DEFAULT_SITE_ID):
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    results = {}
    for zone in site["zones"]:
        zid = zone["id"]
        results[zid] = await copernicus.fetch_ndvi(zone["polygon"], zone_id=zid)
    return results

# ── Soil (SoilGrids) ──────────────────────────────────────────────────────────
@app.get("/api/soil")
async def get_soil(
    lat: float = TSENOVO_SITE["lat"],
    lon: float = TSENOVO_SITE["lon"],
    zone_id: int = 3,
):
    props = await soilgrids.fetch_soil_properties(lat, lon, zone_id)
    health = soilgrids.compute_soil_health_score(props)
    return {"properties": props, "health": health}

# ── Biodiversity (GBIF) ───────────────────────────────────────────────────────
@app.get("/api/biodiversity")
async def get_biodiversity(
    lat: float = TSENOVO_SITE["lat"],
    lon: float = TSENOVO_SITE["lon"],
):
    stats = await gbif.fetch_all_groups(lat, lon)
    return stats

@app.get("/api/biodiversity/species")
async def get_species_list(
    lat: float = TSENOVO_SITE["lat"],
    lon: float = TSENOVO_SITE["lon"],
):
    species = await gbif.fetch_species_list(lat, lon)
    return {"count": len(species), "species": species}

# ── Carbon Calculator ─────────────────────────────────────────────────────────
class CarbonInput(BaseModel):
    som_pct:             float = Field(..., gt=0, lt=100, description="Soil Organic Matter %")
    bulk_density_g_cm3:  float = Field(..., gt=0, lt=3,  description="Bulk density g/cm³")
    depth_cm:            float = Field(..., gt=0, lt=200, description="Soil depth in cm")
    area_ha:             float = Field(1.0, gt=0,         description="Area in hectares")
    zone:                int   = Field(0,   ge=0, le=9)

@app.post("/api/carbon/calculate")
async def calculate_carbon(data: CarbonInput):
    warnings = carbon.validate_carbon_inputs(data.som_pct, data.bulk_density_g_cm3, data.depth_cm)
    result   = carbon.calculate_carbon_stock(
        data.som_pct, data.bulk_density_g_cm3, data.depth_cm, data.area_ha
    )
    record   = await db.save_soil_lab(data.zone, result)
    history  = await db.get_soil_lab(data.zone)
    seqrate  = carbon.compute_sequestration_rate(history)
    return {
        "result":    result,
        "warnings":  warnings,
        "sequestration_rate": seqrate,
        "history":   history[-10:],
    }

@app.get("/api/carbon/history")
async def carbon_history(zone: Optional[int] = None):
    records = await db.get_soil_lab(zone)
    seq = carbon.compute_sequestration_rate(records)
    trajectory = carbon.build_trajectory(records)
    return {"records": records, "sequestration_rate": seq, "trajectory": trajectory}

# ── Dashboard Aggregate ───────────────────────────────────────────────────────
@app.get("/api/dashboard")
async def get_dashboard(site_id: str = DEFAULT_SITE_ID):
    """
    One endpoint that returns everything the main dashboard needs.
    Runs all data fetches concurrently for speed.
    """
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    lat, lon = site["lat"], site["lon"]

    # Concurrent data fetch
    weather_task    = asyncio.create_task(weather.get_historical(lat, lon, days_back=10))
    forecast_task   = asyncio.create_task(weather.get_forecast(lat, lon))
    ndvi_task       = asyncio.create_task(copernicus.fetch_ndvi(
        next(z for z in site["zones"] if z["id"] == 3)["polygon"], zone_id=3
    ))
    soil_task       = asyncio.create_task(soilgrids.fetch_soil_properties(lat, lon, 3))
    analysis_task   = asyncio.create_task(db.get_latest_analysis())
    risk_task       = asyncio.create_task(db.get_latest_risk())

    hist, fc, ndvi_data, soil_data, latest_analysis, risk_scores = await asyncio.gather(
        weather_task, forecast_task, ndvi_task, soil_task, analysis_task, risk_task,
        return_exceptions=True,
    )

    # Safe unwrap
    def _safe(val, default=None):
        return default if isinstance(val, Exception) else val

    hist            = _safe(hist, {})
    fc              = _safe(fc, {})
    ndvi_data       = _safe(ndvi_data, {})
    soil_data       = _safe(soil_data, {})
    latest_analysis = _safe(latest_analysis)
    risk_scores     = _safe(risk_scores, [])

    weather_summary = weather.summarize_weather(hist, fc)
    soil_health     = soilgrids.compute_soil_health_score(soil_data)

    # Aggregate risk score (highest zone risk or computed)
    overall_risk = 50
    if risk_scores:
        scores = [r.get("risk_score", 0) for r in risk_scores if isinstance(r, dict)]
        if scores:
            overall_risk = max(scores)

    # Quick NDVI-based alert check
    ndvi_val = ndvi_data.get("ndvi_mean") if isinstance(ndvi_data, dict) else None
    alerts = []
    if ndvi_val and ndvi_val < NDVI_ALERT_THRESHOLD:
        alerts.append({"type": "ndvi", "severity": "high", "message": f"NDVI {ndvi_val:.2f} below threshold {NDVI_ALERT_THRESHOLD}"})
    for wa in weather_summary.get("rainfall_alerts", []):
        alerts.append({"type": "rainfall", **wa})

    return {
        "site":           {"id": site_id, "name": site["name"]},
        "overall_risk_score": overall_risk,
        "weather":        weather_summary,
        "ndvi":           ndvi_data,
        "soil":           soil_data,
        "soil_health":    soil_health,
        "latest_pin_analysis": latest_analysis,
        "risk_scores":    risk_scores,
        "alerts":         alerts,
        "alert_count":    len(alerts),
    }

# ── AI Risk Scoring ───────────────────────────────────────────────────────────
class RiskInput(BaseModel):
    precipitation_mm:    float = Field(..., ge=0)
    ndvi:                float = Field(..., ge=-1, le=1)
    vegetation_cover_pct: float = Field(..., ge=0, le=100)
    slope_deg:           float = Field(3.5, ge=0, le=90)
    soil_type:           str   = Field("Silty clay loam (Chernozem)")
    zone_id:             int   = Field(3, ge=1, le=9)

@app.post("/api/ai/risk-score")
async def ai_risk_score(data: RiskInput):
    result = await gemini.compute_risk_score(
        data.precipitation_mm, data.ndvi, data.vegetation_cover_pct,
        data.slope_deg, data.soil_type, data.zone_id,
    )
    record = await db.save_risk_score(data.zone_id, result)
    return result

# ── AI ESG Report ─────────────────────────────────────────────────────────────
@app.post("/api/ai/report")
async def generate_report(site_id: str = DEFAULT_SITE_ID):
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    lat, lon = site["lat"], site["lon"]

    # Collect data for report
    analyses  = await db.get_analysis_history(limit=20)
    soil_recs = await db.get_soil_lab()
    risk      = await db.get_latest_risk()
    ndvi      = await copernicus.fetch_ndvi(site["zones"][2]["polygon"], zone_id=3)

    agg = {
        "site_name":       site["name"],
        "report_date":     date.today().isoformat(),
        "zone3_ndvi":      ndvi.get("ndvi_mean"),
        "recent_analyses": analyses[-5:],
        "soil_records":    soil_recs[-3:],
        "risk_scores":     risk,
        "total_area_ha":   site["total_area_ha"],
        "capacity_mwp":    site["capacity_mwp"],
    }
    report = await gemini.generate_esg_report(agg)
    return {"report": report, "generated_at": date.today().isoformat()}

# ── AI Biodiversity Analysis ──────────────────────────────────────────────────
@app.post("/api/ai/biodiversity")
async def ai_biodiversity(site_id: str = DEFAULT_SITE_ID):
    site = ALL_SITES.get(site_id, TSENOVO_SITE)
    records = await gbif.fetch_occurrences(site["lat"], site["lon"], limit=50)
    result = await gemini.analyze_biodiversity_data(records, site["name"])
    return result

# ── File Upload — Photo Monitoring ────────────────────────────────────────────
@app.post("/api/upload/photo")
async def upload_monitoring_photo(
    zone: int = Form(...),
    pin_id: str = Form("manual"),
    notes: str = Form(""),
    file: UploadFile = File(...),
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image")

    content = await file.read()
    save_path = UPLOADS_DIR / f"photo_{zone}_{file.filename}"
    async with aiofiles.open(save_path, "wb") as f:
        await f.write(content)

    analysis = await gemini.analyze_photo_bytes(
        content, file.content_type, context=f"Photo Monitoring — Zone {zone}, pin {pin_id}"
    )
    record = await db.save_upload_record("photo", zone, file.filename, analysis)

    return {
        "message": "Photo uploaded and analyzed successfully",
        "file":    file.filename,
        "zone":    zone,
        "notes":   notes,
        "analysis": analysis,
        "record_id": record["id"],
    }

# ── File Upload — Soil Analysis (manual form or CSV) ─────────────────────────
class SoilLabUpload(BaseModel):
    zone:               int
    field_name:         str    = "Tsenovo Farm"
    sampling_date:      str    = ""
    depth_cm:           float  = 15.0
    som_pct:            float
    bulk_density:       float  = 1.34
    ph:                 Optional[float] = None
    npk_n:              Optional[float] = None
    npk_p:              Optional[float] = None
    npk_k:              Optional[float] = None
    aggregate_stability: Optional[float] = None
    notes:              str    = ""

@app.post("/api/upload/soil")
async def upload_soil_analysis(data: SoilLabUpload):
    carbon_result = carbon.calculate_carbon_stock(
        data.som_pct, data.bulk_density, data.depth_cm
    )
    record_data = {
        "field_name":     data.field_name,
        "sampling_date":  data.sampling_date or date.today().isoformat(),
        "depth_cm":       data.depth_cm,
        "som_pct":        data.som_pct,
        "bulk_density":   data.bulk_density,
        "ph":             data.ph,
        "npk":            {"n": data.npk_n, "p": data.npk_p, "k": data.npk_k},
        "aggregate_stability": data.aggregate_stability,
        "notes":          data.notes,
        **carbon_result,
    }
    record = await db.save_soil_lab(data.zone, record_data)
    return {"message": "Soil analysis saved", "record": record, "carbon": carbon_result}

@app.post("/api/upload/soil-csv")
async def upload_soil_csv(
    zone: int = Form(...),
    file: UploadFile = File(...),
):
    if not (file.filename.endswith(".csv") or file.content_type == "text/csv"):
        raise HTTPException(400, "File must be a CSV")
    content = (await file.read()).decode("utf-8")
    rows = _parse_soil_csv(content)
    saved = []
    for row in rows:
        cr = carbon.calculate_carbon_stock(
            row.get("som_pct", 3.5),
            row.get("bulk_density", 1.34),
            row.get("depth_cm", 15.0),
        )
        rec = await db.save_soil_lab(zone, {**row, **cr})
        saved.append(rec)
    return {"message": f"Imported {len(saved)} rows", "records": saved}

def _parse_soil_csv(content: str) -> List[Dict]:
    import csv, io
    rows = []
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        cleaned = {}
        for k, v in row.items():
            k = k.strip().lower().replace(" ", "_")
            try:
                cleaned[k] = float(v) if v.strip() else None
            except ValueError:
                cleaned[k] = v.strip()
        rows.append(cleaned)
    return rows

# ── Upload — Pollen / Species data (manual) ───────────────────────────────────
class PollenRecord(BaseModel):
    species:   str
    count:     int
    zone:      int
    date:      str = ""
    method:    str = "manual_count"
    notes:     str = ""

@app.post("/api/upload/pollen")
async def upload_pollen(records: list[PollenRecord]):
    import math
    from collections import Counter
    species_counts = Counter({r.species: r.count for r in records})
    total = sum(species_counts.values())
    shannon_h = 0.0
    if total > 0:
        for c in species_counts.values():
            p = c / total
            if p > 0:
                shannon_h -= p * math.log(p)
    saved = []
    for r in records:
        rec = await db.save_upload_record(
            "pollen", r.zone, f"pollen_{r.date}_{r.species}",
            {"species": r.species, "count": r.count, "method": r.method, "notes": r.notes}
        )
        saved.append(rec)
    return {
        "message": f"Saved {len(saved)} pollen records",
        "shannon_h": round(shannon_h, 3),
        "species_richness": len(species_counts),
    }

class BirdRecord(BaseModel):
    species:     str
    common_name: str = ""
    count:       int
    zone:        int
    date:        str = ""
    observer:    str = ""
    notes:       str = ""

@app.post("/api/upload/birds")
async def upload_birds(records: list[BirdRecord]):
    import math
    from collections import Counter
    species_counts = Counter({r.species: r.count for r in records})
    total = sum(species_counts.values())
    shannon_h = 0.0
    if total > 0:
        for c in species_counts.values():
            p = c / total
            if p > 0:
                shannon_h -= p * math.log(p)
    saved = []
    for r in records:
        rec = await db.save_upload_record(
            "bird", r.zone, f"bird_{r.date}_{r.species}",
            {"species": r.species, "common_name": r.common_name, "count": r.count,
             "observer": r.observer, "notes": r.notes}
        )
        saved.append(rec)
    return {
        "message": f"Saved {len(saved)} bird records",
        "shannon_h": round(shannon_h, 3),
        "species_richness": len(species_counts),
    }

# ── Upload history ────────────────────────────────────────────────────────────
@app.get("/api/uploads")
async def list_uploads(upload_type: Optional[str] = None, limit: int = 50):
    return await db.get_uploads(upload_type, limit)

# ── Before/After change detection ─────────────────────────────────────────────
@app.post("/api/ai/change-detection")
async def change_detection(
    before: UploadFile = File(...),
    after:  UploadFile = File(...),
):
    before_bytes = await before.read()
    after_bytes  = await after.read()

    before_path = UPLOADS_DIR / f"before_{before.filename}"
    after_path  = UPLOADS_DIR / f"after_{after.filename}"

    async with aiofiles.open(before_path, "wb") as f: await f.write(before_bytes)
    async with aiofiles.open(after_path,  "wb") as f: await f.write(after_bytes)

    result = await gemini.detect_change(before_path, after_path)
    return result

# ── Timelapse image listing and serving ───────────────────────────────────────
@app.get("/api/timelapse/images")
async def list_timelapse_images(limit: int = 20):
    from config import get_timelapse_path
    folder = get_timelapse_path()
    if not folder.exists():
        return {"images": [], "total": 0, "folder": str(folder)}
    exts = {'.jpg', '.jpeg', '.png', '.bmp'}
    images = sorted(
        [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in exts],
        key=lambda f: f.stat().st_mtime, reverse=True
    )[:limit]
    return {
        "images": [{"filename": f.name, "url": f"/api/timelapse/image/{f.name}", "mtime": f.stat().st_mtime, "size": f.stat().st_size} for f in images],
        "total": len(images),
        "folder": str(folder)
    }

@app.get("/api/timelapse/image/{filename}")
async def serve_timelapse_image(filename: str):
    from config import get_timelapse_path
    folder = get_timelapse_path()
    path = folder / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(str(path), media_type="image/jpeg")

# ── Frontend catch-all (MUST be last — catches everything not matched above) ───
@app.get("/", response_class=FileResponse)
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/{path:path}", include_in_schema=False)
async def serve_frontend(path: str):
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(FRONTEND_DIR / "index.html")
