"""
Smart Erosion Pin — Timelapse Folder Watcher.
Monitors the WSL/local timelapse folder for new photos every 60 seconds,
sends each new photo to Gemini AI, stores results in db.
"""
import asyncio
import logging
from pathlib import Path
from datetime import datetime

from config import get_timelapse_path, TSENOVO_SITE
import db
from services.gemini import analyze_photo

log = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
_seen_files: set[str] = set()
_watcher_running = False


def _find_new_images(folder: Path) -> list[Path]:
    """Return image files not yet processed, sorted oldest-first."""
    if not folder.exists():
        return []
    images = [
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
        and f.name not in _seen_files
    ]
    return sorted(images, key=lambda f: f.stat().st_mtime)


def _guess_pin_id(filename: str) -> str:
    """
    Try to extract a pin ID from the filename.
    Filename patterns: P04_20260427_094532.jpg  or  img_2026042709.jpg
    Falls back to 'P04' (primary Zone 3 pin).
    """
    import re
    m = re.search(r"(P\d{2,3})", filename, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return "P04"   # Default: primary Zone 3 pin


async def _process_image(image_path: Path) -> None:
    """Send a single image to Gemini and store the result."""
    pin_id = _guess_pin_id(image_path.name)
    log.info("Processing new timelapse image: %s (pin=%s)", image_path.name, pin_id)

    try:
        analysis = await analyze_photo(image_path, context=f"Smart Erosion Pin {pin_id}, Zone 3, Tsenovo Solar Park")

        # Tag with metadata
        analysis["pin_id"]    = pin_id
        analysis["zone"]      = 3
        analysis["filename"]  = image_path.name
        analysis["file_path"] = str(image_path)
        analysis["file_size"] = image_path.stat().st_size
        analysis["captured_at"] = datetime.fromtimestamp(
            image_path.stat().st_mtime
        ).isoformat()

        record = await db.save_analysis(pin_id, image_path.name, analysis)
        log.info(
            "Analysis saved: pin=%s severity=%s veg=%s%% confidence=%.2f",
            pin_id,
            analysis.get("erosion_severity"),
            analysis.get("vegetation_cover_percent"),
            analysis.get("confidence", 0),
        )
        return record
    except Exception as exc:
        log.error("Failed to analyze %s: %s", image_path.name, exc)
        return None


async def run_watcher(poll_interval_secs: int = 60) -> None:
    """
    Background task: poll the timelapse folder every `poll_interval_secs`,
    process any new images found.
    """
    global _watcher_running, _seen_files
    _watcher_running = True

    timelapse_path = get_timelapse_path()
    log.info("Timelapse watcher started — watching: %s (poll every %ds)", timelapse_path, poll_interval_secs)

    # Seed _seen_files with existing files so we don't re-process on restart
    if timelapse_path.exists():
        _seen_files = {f.name for f in timelapse_path.iterdir() if f.is_file()}
        log.info("Pre-seeded %d existing files (will not re-process)", len(_seen_files))
    else:
        log.warning("Timelapse path does not exist yet: %s", timelapse_path)

    while _watcher_running:
        try:
            new_images = _find_new_images(timelapse_path)
            if new_images:
                log.info("Found %d new image(s) to process", len(new_images))
                for img in new_images:
                    _seen_files.add(img.name)
                    await _process_image(img)
                    await asyncio.sleep(2)   # Brief pause between Gemini calls
        except Exception as exc:
            log.error("Watcher loop error: %s", exc)

        await asyncio.sleep(poll_interval_secs)

    log.info("Timelapse watcher stopped.")


def stop_watcher() -> None:
    global _watcher_running
    _watcher_running = False


def watcher_status() -> dict:
    timelapse_path = get_timelapse_path()
    image_count = 0
    if timelapse_path.exists():
        image_count = sum(
            1 for f in timelapse_path.iterdir()
            if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
        )
    return {
        "running":        _watcher_running,
        "timelapse_path": str(timelapse_path),
        "path_exists":    timelapse_path.exists(),
        "images_in_folder": image_count,
        "processed_count":  len(_seen_files),
    }
