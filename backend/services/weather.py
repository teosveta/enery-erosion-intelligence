"""
Open-Meteo Historical + Forecast Weather Service.
Free, no API key required.
"""
import logging
from datetime import date, timedelta
from typing import Optional

import httpx

from config import WEATHER_BASE_URL, FORECAST_BASE_URL, RAINFALL_ALERT_MM
import db

log = logging.getLogger(__name__)

# ── Historical weather (archive API) ─────────────────────────────────────────

async def get_historical(
    lat: float,
    lon: float,
    start: Optional[str] = None,
    end: Optional[str] = None,
    days_back: int = 58,
) -> dict:
    """Fetch historical hourly weather. Defaults to the last ~2 months."""
    today = date.today()
    # Archive API has ~5-day lag
    end_date   = (today - timedelta(days=5)).isoformat()
    start_date = start or (today - timedelta(days=days_back + 5)).isoformat()
    end_date   = end or end_date

    cache_key = f"weather_{lat}_{lon}_{start_date}_{end_date}"
    cached = await db.cache_get(cache_key, max_age_secs=3600)
    if cached:
        return cached

    params = {
        "latitude":  lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date":   end_date,
        "hourly": "precipitation,temperature_2m,windspeed_10m,cloudcover",
        "daily":  "precipitation_sum,temperature_2m_max,temperature_2m_min,windspeed_10m_max",
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(WEATHER_BASE_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
        await db.cache_set(cache_key, data)
        return data
    except Exception as exc:
        log.warning("Open-Meteo historical failed: %s", exc)
        return {}

# ── 3-day forecast ────────────────────────────────────────────────────────────

async def get_forecast(lat: float, lon: float) -> dict:
    cache_key = f"forecast_{lat}_{lon}"
    cached = await db.cache_get(cache_key, max_age_secs=1800)
    if cached:
        return cached

    params = {
        "latitude":  lat,
        "longitude": lon,
        "hourly":    "precipitation,precipitation_probability,temperature_2m,windspeed_10m",
        "daily":     "precipitation_sum,precipitation_probability_max,temperature_2m_max",
        "forecast_days": 4,
        "timezone":  "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(FORECAST_BASE_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
        await db.cache_set(cache_key, data)
        return data
    except Exception as exc:
        log.warning("Open-Meteo forecast failed: %s", exc)
        return {}

# ── Rainfall Alert Detection ──────────────────────────────────────────────────

def detect_rainfall_alerts(weather_data: dict, threshold_mm: float = RAINFALL_ALERT_MM) -> list[dict]:
    """Return list of hour-level alert dicts where precipitation exceeds threshold."""
    alerts = []
    hourly = weather_data.get("hourly", {})
    times  = hourly.get("time", [])
    precip = hourly.get("precipitation", [])

    for t, p in zip(times, precip):
        if p is not None and p >= threshold_mm:
            alerts.append({
                "time":      t,
                "precipitation_mm": p,
                "severity":  "critical" if p >= 25 else "high",
                "message":   f"High rainfall {p:.1f}mm/hr — Zone 3 erosion risk elevated",
            })
    return alerts[-10:]  # return last 10

# ── Summary stats ─────────────────────────────────────────────────────────────

def summarize_weather(historical: dict, forecast: dict) -> dict:
    """Build a concise weather summary for the dashboard."""
    hourly   = historical.get("hourly", {})
    precip_h = [p for p in hourly.get("precipitation", []) if p is not None]
    temp_h   = [t for t in hourly.get("temperature_2m", []) if t is not None]
    wind_h   = [w for w in hourly.get("windspeed_10m", []) if w is not None]

    # Forecast next rain
    fc_daily   = forecast.get("daily", {})
    fc_dates   = fc_daily.get("time", [])
    fc_precip  = fc_daily.get("precipitation_sum", [])
    next_rain  = None
    next_rain_mm = 0.0
    for d, p in zip(fc_dates, fc_precip):
        if p and p > 1:
            next_rain    = d
            next_rain_mm = p
            break

    return {
        "total_precipitation_mm": round(sum(precip_h), 1),
        "max_hourly_precipitation_mm": round(max(precip_h, default=0), 1),
        "avg_temperature_c": round(sum(temp_h) / len(temp_h), 1) if temp_h else None,
        "avg_windspeed_kmh": round(sum(wind_h) / len(wind_h), 1) if wind_h else None,
        "next_rain_date": next_rain,
        "next_rain_mm":   round(next_rain_mm, 1),
        "forecast_days":  list(zip(fc_dates, fc_precip or [])),
        "rainfall_alerts": detect_rainfall_alerts(historical),
    }
