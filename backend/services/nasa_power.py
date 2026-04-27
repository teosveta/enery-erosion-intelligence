"""
NASA POWER (Prediction Of Worldwide Energy Resources) — Data Service
Free, no-key API providing hourly/daily solar radiation and meteorological data.

Docs: https://power.larc.nasa.gov/docs/services/api/
"""
import logging
from datetime import datetime, date, timedelta
from typing import Optional

import httpx

import db

log = logging.getLogger(__name__)

# NASA POWER API base
_BASE = "https://power.larc.nasa.gov/api/temporal"

# Parameters we fetch:
# PRECTOTCORR  — precipitation corrected (mm/hr)
# T2M          — temperature at 2m (°C)
# WS10M        — wind speed at 10m (m/s)
# ALLSKY_SFC_SW_DWN — all-sky surface shortwave downward irradiance (W/m²)
# RH2M         — relative humidity at 2m (%)
_HOURLY_PARAMS   = "PRECTOTCORR,T2M,WS10M,ALLSKY_SFC_SW_DWN,RH2M"
_DAILY_PARAMS    = "PRECTOTCORR,T2M_MAX,T2M_MIN,WS10M,ALLSKY_SFC_SW_DWN,RH2M"
_COMMUNITY       = "RE"          # Renewable Energy community dataset


async def fetch_power_data(lat: float, lon: float, days_back: int = 30) -> dict:
    """
    Fetch daily NASA POWER data for the given location.
    Returns dict with daily time series for precipitation, temperature,
    wind speed, solar irradiance, and relative humidity.
    Results are cached for 6 hours.
    """
    cache_key = f"nasa_power_{lat}_{lon}_{days_back}"
    cached = await db.cache_get(cache_key, max_age_secs=21600)
    if cached:
        log.info("NASA POWER: cache hit for %s,%s (%d days)", lat, lon, days_back)
        return cached

    end_dt   = date.today() - timedelta(days=1)   # yesterday (today not available)
    start_dt = end_dt - timedelta(days=days_back)

    url = (
        f"{_BASE}/daily/point"
        f"?parameters={_DAILY_PARAMS}"
        f"&community={_COMMUNITY}"
        f"&longitude={lon}&latitude={lat}"
        f"&start={start_dt.strftime('%Y%m%d')}&end={end_dt.strftime('%Y%m%d')}"
        f"&format=JSON"
    )

    log.info("NASA POWER: fetching %s to %s", start_dt, end_dt)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        raw = resp.json()

    props = raw.get("properties", {})
    params_data = props.get("parameter", {})
    header = raw.get("header", {})

    # Extract time series — POWER returns dicts keyed by "YYYYMMDD"
    prec_raw   = params_data.get("PRECTOTCORR", {})
    t2m_max    = params_data.get("T2M_MAX", {})
    t2m_min    = params_data.get("T2M_MIN", {})
    ws10m_raw  = params_data.get("WS10M", {})
    irr_raw    = params_data.get("ALLSKY_SFC_SW_DWN", {})
    rh_raw     = params_data.get("RH2M", {})

    # Sort by date key and build lists
    dates = sorted(prec_raw.keys())

    def _clean(d: dict, key_date: str) -> Optional[float]:
        val = d.get(key_date)
        return None if val is None or val == -999.0 else round(float(val), 3)

    daily = []
    for dk in dates:
        iso = f"{dk[:4]}-{dk[4:6]}-{dk[6:8]}"
        daily.append({
            "date":            iso,
            "precip_mm":       _clean(prec_raw,  dk),
            "t2m_max_c":       _clean(t2m_max,   dk),
            "t2m_min_c":       _clean(t2m_min,   dk),
            "wind_ms":         _clean(ws10m_raw,  dk),
            "solar_wm2":       _clean(irr_raw,    dk),
            "humidity_pct":    _clean(rh_raw,     dk),
        })

    # Summary statistics
    precip_vals = [d["precip_mm"] for d in daily if d["precip_mm"] is not None]
    solar_vals  = [d["solar_wm2"] for d in daily if d["solar_wm2"]  is not None]
    temp_maxes  = [d["t2m_max_c"] for d in daily if d["t2m_max_c"] is not None]

    summary = {
        "period_days":        len(daily),
        "total_precip_mm":    round(sum(precip_vals), 1) if precip_vals else None,
        "max_daily_precip_mm": max(precip_vals) if precip_vals else None,
        "avg_solar_wm2":      round(sum(solar_vals) / len(solar_vals), 1) if solar_vals else None,
        "avg_temp_max_c":     round(sum(temp_maxes) / len(temp_maxes), 1) if temp_maxes else None,
        "high_rain_days":     sum(1 for v in precip_vals if v > 10),
        "drought_days":       sum(1 for v in precip_vals if v < 1),
    }

    result = {
        "source":   "NASA POWER",
        "lat": lat, "lon": lon,
        "start": daily[0]["date"] if daily else None,
        "end":   daily[-1]["date"] if daily else None,
        "summary": summary,
        "daily":   daily,
    }

    await db.cache_set(cache_key, result)
    log.info("NASA POWER: cached %d daily records for %s,%s", len(daily), lat, lon)
    return result


async def fetch_power_summary(lat: float, lon: float) -> dict:
    """
    Fetch a lightweight 30-day summary suitable for dashboard widgets.
    Includes erosion-relevant metrics: total rainfall, solar energy density,
    high-intensity rain event count.
    """
    data = await fetch_power_data(lat, lon, days_back=30)
    summary = data.get("summary", {})
    daily = data.get("daily", [])

    # Erosion-relevant: identify high-intensity rain days (>15 mm/day)
    high_risk_days = [
        d for d in daily
        if d.get("precip_mm") is not None and d["precip_mm"] > 15
    ]

    # Last 7 days rainfall
    recent = daily[-7:] if len(daily) >= 7 else daily
    recent_precip = sum(d["precip_mm"] for d in recent if d.get("precip_mm") is not None)

    return {
        **summary,
        "recent_7d_precip_mm":  round(recent_precip, 1),
        "high_risk_rain_events": high_risk_days,
        "solar_energy_kwh_m2_day": round(summary["avg_solar_wm2"] * 24 / 1000, 2)
            if summary.get("avg_solar_wm2") else None,
        "source": "NASA POWER",
    }
