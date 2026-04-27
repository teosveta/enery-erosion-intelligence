"""
Lightweight JSON-based data store.
No database dependency — all data persists as JSON files under data/.
"""
import json
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import aiofiles

from config import ANALYSIS_DIR, CACHE_DIR, UPLOADS_DIR, DATA_DIR

# Ensure directories exist
for _d in (ANALYSIS_DIR, CACHE_DIR, UPLOADS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

async def _read_json(path: Path, default: Any = None) -> Any:
    try:
        async with aiofiles.open(path, "r", encoding="utf-8") as f:
            return json.loads(await f.read())
    except (FileNotFoundError, json.JSONDecodeError):
        return default

async def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(data, indent=2, ensure_ascii=False, default=str))

# ── Photo Analysis Store ──────────────────────────────────────────────────────

ANALYSIS_INDEX = ANALYSIS_DIR / "index.json"

async def save_analysis(pin_id: str, filename: str, result: dict) -> dict:
    record = {
        "id":        f"{pin_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "pin_id":    pin_id,
        "filename":  filename,
        "timestamp": _now(),
        **result,
    }
    # Append to index
    index = await _read_json(ANALYSIS_INDEX, [])
    index.append(record)
    # Keep last 500 records in index
    index = index[-500:]
    await _write_json(ANALYSIS_INDEX, index)
    # Also write individual record
    await _write_json(ANALYSIS_DIR / f"{record['id']}.json", record)
    return record

async def get_latest_analysis(pin_id: Optional[str] = None) -> Optional[dict]:
    index = await _read_json(ANALYSIS_INDEX, [])
    if not index:
        return None
    if pin_id:
        filtered = [r for r in index if r.get("pin_id") == pin_id]
        return filtered[-1] if filtered else None
    return index[-1]

async def get_analysis_history(pin_id: Optional[str] = None, limit: int = 50) -> list:
    index = await _read_json(ANALYSIS_INDEX, [])
    if pin_id:
        index = [r for r in index if r.get("pin_id") == pin_id]
    return index[-limit:]

# ── Cache Store ──────────────────────────────────────────────────────────────

async def cache_get(key: str, max_age_secs: int = 3600) -> Optional[Any]:
    path = CACHE_DIR / f"{key}.json"
    data = await _read_json(path)
    if not data:
        return None
    cached_at = data.get("_cached_at", "")
    if cached_at:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached_at)).total_seconds()
            if age > max_age_secs:
                return None
        except Exception:
            return None
    return data.get("payload")

async def cache_set(key: str, payload: Any) -> None:
    await _write_json(CACHE_DIR / f"{key}.json", {"_cached_at": _now(), "payload": payload})

# ── Manual Upload Store ──────────────────────────────────────────────────────

UPLOADS_INDEX = UPLOADS_DIR / "index.json"

async def save_upload_record(upload_type: str, zone: int, filename: str, analysis: Optional[dict] = None) -> dict:
    record = {
        "id":          f"{upload_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "type":        upload_type,   # "photo" | "soil" | "pollen" | "bird"
        "zone":        zone,
        "filename":    filename,
        "timestamp":   _now(),
        "analysis":    analysis,
    }
    index = await _read_json(UPLOADS_INDEX, [])
    index.append(record)
    await _write_json(UPLOADS_INDEX, index)
    return record

async def get_uploads(upload_type: Optional[str] = None, limit: int = 50) -> list:
    index = await _read_json(UPLOADS_INDEX, [])
    if upload_type:
        index = [r for r in index if r.get("type") == upload_type]
    return index[-limit:]

# ── Soil Analysis Lab Store ──────────────────────────────────────────────────

SOIL_LAB_FILE = DATA_DIR / "soil_lab.json"

async def save_soil_lab(zone: int, data: dict) -> dict:
    record = {"zone": zone, "timestamp": _now(), **data}
    existing = await _read_json(SOIL_LAB_FILE, [])
    existing.append(record)
    await _write_json(SOIL_LAB_FILE, existing)
    return record

async def get_soil_lab(zone: Optional[int] = None) -> list:
    records = await _read_json(SOIL_LAB_FILE, [])
    if zone is not None:
        records = [r for r in records if r.get("zone") == zone]
    return records

# ── Risk Score Store ─────────────────────────────────────────────────────────

RISK_FILE = DATA_DIR / "risk_scores.json"

async def save_risk_score(zone: int, score_data: dict) -> dict:
    record = {"zone": zone, "timestamp": _now(), **score_data}
    existing = await _read_json(RISK_FILE, [])
    existing.append(record)
    existing = existing[-200:]
    await _write_json(RISK_FILE, existing)
    return record

async def get_latest_risk(zone: Optional[int] = None) -> Optional[Union[dict, list]]:
    records = await _read_json(RISK_FILE, [])
    if zone is not None:
        filtered = [r for r in records if r.get("zone") == zone]
        return filtered[-1] if filtered else None
    # Return latest per zone
    latest: dict[int, dict] = {}
    for r in records:
        latest[r.get("zone", 0)] = r
    return list(latest.values())
