"""
Copernicus Sentinel Hub — NDVI satellite data service.
Uses OAuth2 client credentials → Process API.
"""
import logging
from datetime import date, timedelta

import httpx

from config import (
    COPERNICUS_CLIENT_ID, COPERNICUS_CLIENT_SECRET,
    COPERNICUS_TOKEN_URL, COPERNICUS_PROCESS_URL,
)
import db

log = logging.getLogger(__name__)

# ── Token caching ─────────────────────────────────────────────────────────────
_token_cache: dict = {}

async def _get_token() -> str:
    """Fetch (or reuse cached) OAuth2 access token."""
    import time
    if _token_cache.get("token") and _token_cache.get("expires_at", 0) > time.time() + 60:
        return _token_cache["token"]

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            COPERNICUS_TOKEN_URL,
            data={
                "grant_type":    "client_credentials",
                "client_id":     COPERNICUS_CLIENT_ID,
                "client_secret": COPERNICUS_CLIENT_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        token_data = resp.json()

    import time as _time
    _token_cache["token"]      = token_data["access_token"]
    _token_cache["expires_at"] = _time.time() + token_data.get("expires_in", 3600)
    log.info("Copernicus token acquired, expires in %ss", token_data.get("expires_in"))
    return _token_cache["token"]

# ── NDVI Evalscript ────────────────────────────────────────────────────────────
NDVI_EVALSCRIPT = """
//VERSION=3
function setup() {
  return {
    input:  [{ bands: ["B04", "B08", "dataMask"] }],
    output: { bands: 2, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [-9999, 0];
  var ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04 + 1e-10);
  return [ndvi, sample.dataMask];
}
"""

# ── Bounding box helpers ──────────────────────────────────────────────────────

def _zone_bbox(polygon: list[list[float]]) -> tuple[float, float, float, float]:
    """Return (min_lon, min_lat, max_lon, max_lat) for a polygon."""
    lats = [p[0] for p in polygon]
    lons = [p[1] for p in polygon]
    return min(lons), min(lats), max(lons), max(lats)

# ── Fetch NDVI ────────────────────────────────────────────────────────────────

async def fetch_ndvi(
    polygon: list[list[float]],
    zone_id: int,
    days_back: int = 15,
) -> dict:
    """Fetch mean NDVI value for a zone polygon over the last `days_back` days."""
    cache_key = f"ndvi_z{zone_id}"
    cached = await db.cache_get(cache_key, max_age_secs=6 * 3600)  # 6-hour cache
    if cached:
        return cached

    end_date   = date.today().isoformat()
    start_date = (date.today() - timedelta(days=days_back)).isoformat()
    bbox       = _zone_bbox(polygon)

    request_body = {
        "input": {
            "bounds": {
                "bbox": list(bbox),
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {"from": f"{start_date}T00:00:00Z", "to": f"{end_date}T23:59:59Z"},
                    "maxCloudCoverage": 30,
                    "mosaickingOrder": "leastCC",
                },
            }],
        },
        "evalscript": NDVI_EVALSCRIPT,
        "output": {
            "width":  32,
            "height": 32,
            "responses": [{"identifier": "default", "format": {"type": "application/json"}}],
        },
        "aggregation": {
            "timeRange":     {"from": f"{start_date}T00:00:00Z", "to": f"{end_date}T23:59:59Z"},
            "aggregationInterval": {"of": f"P{days_back}D"},
        },
    }

    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                COPERNICUS_PROCESS_URL,
                json=request_body,
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code == 200:
            # The process API returns binary TIFF — for JSON stats we use the statistics endpoint
            # For a hackathon, we use a simpler statistics endpoint instead
            result = await _fetch_ndvi_statistics(polygon, zone_id, start_date, end_date)
        else:
            log.warning("Copernicus Process API returned %s, using stats endpoint", resp.status_code)
            result = await _fetch_ndvi_statistics(polygon, zone_id, start_date, end_date)

        await db.cache_set(cache_key, result)
        return result

    except Exception as exc:
        log.warning("Copernicus NDVI failed for zone %s: %s", zone_id, exc)
        return {"ndvi_mean": None, "ndvi_min": None, "ndvi_max": None, "error": str(exc), "source": "error"}

async def _fetch_ndvi_statistics(
    polygon: list[list[float]],
    zone_id: int,
    start_date: str,
    end_date: str,
) -> dict:
    """Use Sentinel Hub Statistics API for mean NDVI (more practical for hackathon)."""
    bbox = _zone_bbox(polygon)

    stats_script = """
//VERSION=3
function setup() {
  return { input: [{ bands: ["B04","B08","dataMask"] }], output: [{ id:"ndvi", bands:1 }] };
}
function evaluatePixel(s) {
  return [s.dataMask === 1 ? (s.B08-s.B04)/(s.B08+s.B04+1e-9) : NaN];
}
"""
    stats_body = {
        "input": {
            "bounds": {
                "bbox":       list(bbox),
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange":        {"from": f"{start_date}T00:00:00Z", "to": f"{end_date}T23:59:59Z"},
                    "maxCloudCoverage": 30,
                },
            }],
        },
        "aggregation": {
            "timeRange": {"from": f"{start_date}T00:00:00Z", "to": f"{end_date}T23:59:59Z"},
            "aggregationInterval": {"of": "P5D"},
            "width": 32, "height": 32,
            "evalscript": stats_script,
        },
        "calculations": {"ndvi": {"histograms": {}, "statistics": {"default": {"percentiles": {"k": [25,50,75]}}}}},
    }

    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://sh.dataspace.copernicus.eu/api/v1/statistics",
                json=stats_body,
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code == 200:
            data = resp.json()
            # Extract latest interval stats
            intervals = data.get("data", [])
            if intervals:
                last = intervals[-1]
                outputs = last.get("outputs", {})
                ndvi_stats = outputs.get("ndvi", {}).get("bands", {}).get("B0", {}).get("stats", {})
                return {
                    "ndvi_mean": round(ndvi_stats.get("mean", 0), 4),
                    "ndvi_min":  round(ndvi_stats.get("min", 0), 4),
                    "ndvi_max":  round(ndvi_stats.get("max", 0), 4),
                    "ndvi_p50":  round(ndvi_stats.get("percentiles", {}).get("50.0", 0), 4),
                    "date_from": last.get("interval", {}).get("from", ""),
                    "date_to":   last.get("interval", {}).get("to", ""),
                    "source":    "sentinel-2-statistics",
                    "history": [
                        {
                            "date": iv.get("interval", {}).get("from", "")[:10],
                            "ndvi": round(iv.get("outputs", {}).get("ndvi", {}).get("bands", {})
                                         .get("B0", {}).get("stats", {}).get("mean", 0), 4)
                        }
                        for iv in intervals[-12:]
                    ],
                }
    except Exception as exc:
        log.warning("Statistics API also failed for zone %s: %s", zone_id, exc)

    # Final fallback — return None values
    return {"ndvi_mean": None, "ndvi_min": None, "ndvi_max": None, "source": "unavailable", "history": []}
