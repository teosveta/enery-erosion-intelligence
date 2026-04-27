"""
PVGIS (Photovoltaic Geographical Information System) — EU JRC Solar Resource API
Free, no-key API providing monthly solar radiation and PV output estimates.

Docs: https://joint-research-centre.ec.europa.eu/pvgis-photovoltaic-geographical-information-system/getting-started-pvgis/api-non-interactive-service_en
"""
import logging

import httpx

import db

log = logging.getLogger(__name__)

_BASE = "https://re.jrc.ec.europa.eu/api/v5_2"


async def fetch_pv_output(
    lat: float,
    lon: float,
    peakpower_kwp: float = 63010.0,   # Tsenovo: 63.01 MWp → kWp
    system_loss_pct: float = 14.0,
    mounting_type: str = "free",      # "free" = free-standing
    angle_deg: float = 25.0,          # typical tilt for Bulgaria
    aspect_deg: float = 0.0,          # 0 = south
) -> dict:
    """
    Estimate annual PV energy output from PVGIS.
    Returns monthly + yearly energy output and solar resource statistics.
    Results cached for 24 hours (data rarely changes).
    """
    cache_key = f"pvgis_pvcalc_{lat}_{lon}_{peakpower_kwp}"
    cached = await db.cache_get(cache_key, max_age_secs=86400)
    if cached:
        log.info("PVGIS PVcalc: cache hit")
        return cached

    params = {
        "lat":         lat,
        "lon":         lon,
        "peakpower":   peakpower_kwp / 1000,   # API takes MW? No — kWp. Send as-is in kWp
        "loss":        system_loss_pct,
        "mountingplace": mounting_type,
        "angle":       angle_deg,
        "aspect":      aspect_deg,
        "outputformat": "json",
        "browser":     0,
    }

    log.info("PVGIS: fetching PV output for %.4f, %.4f, %.1f kWp", lat, lon, peakpower_kwp)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{_BASE}/PVcalc", params=params)
        resp.raise_for_status()
        raw = resp.json()

    outputs = raw.get("outputs", {})
    monthly_raw = outputs.get("monthly", {}).get("fixed", [])
    totals_raw  = outputs.get("totals",  {}).get("fixed", {})
    meta = raw.get("meta", {})

    months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ]
    monthly = []
    for i, m in enumerate(monthly_raw):
        monthly.append({
            "month":        months[i],
            "month_num":    i + 1,
            "energy_kwh":   m.get("E_m"),        # Monthly PV energy output (kWh)
            "irr_kwh_m2":   m.get("H(i)_m"),     # Monthly in-plane irradiance (kWh/m²)
            "sd_kwh":       m.get("SD_m"),        # Std deviation (kWh)
        })

    result = {
        "source":         "PVGIS (EU JRC)",
        "lat": lat, "lon": lon,
        "peakpower_kwp":  peakpower_kwp,
        "system_loss_pct": system_loss_pct,
        "annual_energy_kwh":  totals_raw.get("E_y"),
        "annual_irr_kwh_m2":  totals_raw.get("H(i)_y"),
        "performance_ratio":  totals_raw.get("PR"),
        "monthly":           monthly,
        "metadata":          meta,
    }

    await db.cache_set(cache_key, result)
    log.info("PVGIS: cached — annual %.0f kWh, PR=%.2f",
             result.get("annual_energy_kwh") or 0,
             result.get("performance_ratio") or 0)
    return result


async def fetch_monthly_radiation(lat: float, lon: float) -> dict:
    """
    Fetch monthly horizontal irradiance (no PV system — just solar resource).
    Useful for correlating solar intensity with NDVI/vegetation health.
    Results cached for 24 hours.
    """
    cache_key = f"pvgis_radiation_{lat}_{lon}"
    cached = await db.cache_get(cache_key, max_age_secs=86400)
    if cached:
        return cached

    params = {
        "lat":          lat,
        "lon":          lon,
        "outputformat": "json",
        "browser":      0,
        "startyear":    2015,
        "endyear":      2023,
    }

    log.info("PVGIS: fetching monthly radiation for %.4f, %.4f", lat, lon)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{_BASE}/MRcalc", params=params)
        resp.raise_for_status()
        raw = resp.json()

    outputs = raw.get("outputs", {})
    monthly_raw = outputs.get("monthly", [])

    months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ]
    monthly = []
    for i, m in enumerate(monthly_raw):
        monthly.append({
            "month":         months[i % 12],
            "month_num":     (i % 12) + 1,
            "Hh_kwh_m2":     m.get("Hh"),    # Horizontal irradiance kWh/m²
            "H_diffuse":     m.get("Hd"),    # Diffuse horizontal
            "H_direct":      m.get("Hbn"),   # Direct normal irradiance
            "T2m_avg":       m.get("T2m"),   # Average temperature
        })

    result = {
        "source":  "PVGIS (EU JRC)",
        "lat": lat, "lon": lon,
        "monthly": monthly,
    }
    await db.cache_set(cache_key, result)
    return result
