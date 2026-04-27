"""
SoilGrids ISRIC REST API — soil property data.
Returns clay/silt/sand %, SOC, bulk density, pH.
Free, no key required. May have intermittent availability.
"""
import logging

import httpx

from config import SOILGRIDS_URL
import db

log = logging.getLogger(__name__)

PROPERTIES = ["clay", "silt", "sand", "soc", "bdod", "phh2o", "cec"]
DEPTHS     = ["0-5cm", "5-15cm", "15-30cm"]

# Known-good fallback values for Zone 3 Tsenovo (from geotechnical reports)
TSENOVO_FALLBACK = {
    "clay_pct":          23.0,   # 19-27%
    "silt_pct":          63.0,   # 60-66%
    "sand_pct":          14.0,
    "soil_organic_carbon_g_per_kg": 22.8,  # → ~3.9% SOM
    "bulk_density_cg_per_cm3":     134,    # 1.34 g/cm³
    "ph":                7.1,
    "cec_cmol_per_kg":   28.0,
    "source":            "geotechnical_report_fallback",
}

async def fetch_soil_properties(lat: float, lon: float, zone_id: int = 0) -> dict:
    """Fetch soil properties for a coordinate pair."""
    cache_key = f"soilgrids_{lat}_{lon}"
    cached = await db.cache_get(cache_key, max_age_secs=24 * 3600)  # 24h cache
    if cached:
        return cached

    params = {
        "lat":      lat,
        "lon":      lon,
        "property": PROPERTIES,
        "depth":    DEPTHS,
        "value":    "mean",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(SOILGRIDS_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        result = _parse_soilgrids(data)
        result["source"] = "soilgrids-isric"
        await db.cache_set(cache_key, result)
        return result

    except Exception as exc:
        log.warning("SoilGrids failed for zone %s: %s — using fallback", zone_id, exc)
        return TSENOVO_FALLBACK.copy()

def _parse_soilgrids(data: dict) -> dict:
    """Extract mean values from SoilGrids response."""
    props = data.get("properties", {}).get("layers", [])
    result: dict = {}
    for layer in props:
        name = layer.get("name", "")
        unit = layer.get("unit_measure", {})
        depths = layer.get("depths", [])
        if depths:
            mean_val = depths[0].get("values", {}).get("mean")
            if mean_val is not None:
                result[name] = mean_val
    return result

def compute_soil_health_score(soil: dict) -> dict:
    """
    Derive a simple 0-100 soil health score from soil properties.
    Higher SOM, optimal pH, lower bulk density = better.
    """
    score = 50  # baseline

    soc = soil.get("soc", soil.get("soil_organic_carbon_g_per_kg", 20))
    # SOC g/kg: >25 excellent, 15-25 good, 5-15 moderate, <5 poor
    if soc > 25:    score += 20
    elif soc > 15:  score += 10
    elif soc < 5:   score -= 15

    ph = soil.get("phh2o", soil.get("ph", 7.0))
    # pH 6.5-7.5 is ideal for Chernozem
    if 6.5 <= ph <= 7.5:  score += 10
    elif ph < 5.5 or ph > 8.5: score -= 15

    bd = soil.get("bdod", soil.get("bulk_density_cg_per_cm3", 130)) / 100  # convert cg to g
    # Bulk density g/cm³: <1.2 excellent, 1.2-1.4 good, 1.4-1.6 moderate, >1.6 poor
    if bd < 1.2:    score += 10
    elif bd < 1.4:  score += 5
    elif bd > 1.6:  score -= 10

    clay = soil.get("clay", 23)
    # Silty clay loam (Chernozem): 20-30% clay is normal
    if 20 <= clay <= 30: score += 5

    return {"soil_health_score": max(0, min(100, score)), "raw": soil}
