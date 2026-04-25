#!/usr/bin/env python3
"""
========================================================
  SOIL EROSION SENSOR STICK — Raspberry Pi Agent
  Captures images from the camera, sends them to the
  Claude AI API, and reports results to the dashboard.
========================================================

HARDWARE SETUP:
  - Raspberry Pi Zero 2W / Pi 4 / Pi 5
  - Raspberry Pi Camera Module (any version)
  - Optional: LED indicator (GPIO pin 17)
  - Optional: SD card for local image backup

INSTALL DEPENDENCIES:
  pip install anthropic requests picamera2 RPi.GPIO

SET YOUR CONFIG BELOW before running.
Run with:  python3 erosion_sensor.py
Auto-start on boot: add to /etc/rc.local or use systemd
"""

import anthropic
import base64
import json
import time
import os
import logging
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────
#  CONFIGURATION — Edit these values
# ─────────────────────────────────────────────

ANTHROPIC_API_KEY = "sk-ant-YOUR_KEY_HERE"   # Get from console.anthropic.com

ZONE_NAME = "Zone A – North Field"            # Name of THIS stick's zone
ZONE_ID   = "zone_a"                          # Short ID (no spaces)

# How often to take a photo and analyse (seconds)
CAPTURE_INTERVAL_SECONDS = 300                # 300 = every 5 minutes

# Where to POST results (your dashboard backend, or a free service like ntfy.sh)
# Set to None to skip — results will still be printed to the console log
DASHBOARD_WEBHOOK_URL = None
# Example: "https://your-server.com/api/erosion-report"
# Example: "https://ntfy.sh/my-erosion-alerts"   (free push notifications!)

# Save images locally? Useful for backup / audit trail
SAVE_IMAGES_LOCALLY = True
IMAGE_SAVE_DIR = Path("/home/pi/erosion_images")

# GPIO pin for status LED (set to None if no LED)
LED_PIN = 17

# ─────────────────────────────────────────────
#  LOGGING SETUP
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("/home/pi/erosion_sensor.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
#  CAMERA — capture a photo as JPEG bytes
# ─────────────────────────────────────────────

def capture_image() -> bytes:
    """
    Captures a photo using the Raspberry Pi camera.
    Returns raw JPEG bytes.

    HOW IT WORKS:
    The camera module physically sits at the top of
    your sensor stick pointing down at the soil.
    picamera2 triggers the sensor, which writes a
    JPEG image directly into memory (no disk write
    needed unless SAVE_IMAGES_LOCALLY is True).
    """
    try:
        from picamera2 import Picamera2
        cam = Picamera2()
        config = cam.create_still_configuration(
            main={"size": (1920, 1080)},  # Full HD — good detail for erosion
        )
        cam.configure(config)
        cam.start()
        time.sleep(2)  # Let auto-exposure settle

        import io
        buffer = io.BytesIO()
        cam.capture_file(buffer, format="jpeg")
        cam.stop()
        cam.close()

        image_bytes = buffer.getvalue()
        log.info(f"Camera captured {len(image_bytes) // 1024} KB image")
        return image_bytes

    except ImportError:
        # ── DEVELOPMENT MODE ──────────────────────────────────────────────────
        # No camera attached (running on a laptop for testing).
        # Loads a local test image instead so you can test the full pipeline.
        log.warning("picamera2 not found — using test image (dev mode)")
        test_path = Path("test_soil.jpg")
        if test_path.exists():
            return test_path.read_bytes()
        else:
            raise FileNotFoundError(
                "No camera AND no test_soil.jpg found. "
                "Add a test_soil.jpg to the folder to run in dev mode."
            )


# ─────────────────────────────────────────────
#  AI ANALYSIS — send image to Claude API
# ─────────────────────────────────────────────

def analyse_image(image_bytes: bytes) -> dict:
    """
    Sends the image to Claude's vision model and
    gets back a structured erosion risk assessment.

    HOW IT WORKS:
    1. The image bytes are base64-encoded (text-safe binary)
    2. We build a message with both the image and a text prompt
    3. Claude's vision model 'sees' the image and reasons about it
    4. We ask it to reply ONLY in JSON so we can parse it easily
    5. No training database is needed — Claude already understands
       soil science from its training on scientific literature
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Convert image bytes → base64 string (required by the API)
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    prompt = f"""You are an expert soil scientist and erosion specialist.
This image was captured by a ground-level sensor camera mounted on a monitoring
stick planted in the field at: {ZONE_NAME}

Analyze the soil surface for erosion risk. Respond ONLY with a valid JSON object,
no markdown, no explanation outside the JSON:

{{
  "status": "safe|warning|critical",
  "risk_score": <integer 0-100>,
  "erosion_type": "none|sheet|rill|gully|wind|beginning",
  "confidence": <integer 0-100>,
  "summary": "<2-3 sentence plain English summary>",
  "indicators": ["<visual clue 1>", "<visual clue 2>", "<visual clue 3>"],
  "recommendation": "<one concrete remediation action>"
}}

Definitions:
- safe: no signs of erosion, soil surface intact
- warning: early-stage surface disturbance or moderate risk factors
- critical: active erosion visible (rills, gullies, exposed sub-soil, sediment)

risk_score: 0 = pristine, 100 = severe active erosion
Base your assessment ONLY on what is visually present in the image."""

    log.info("Sending image to Claude API for analysis...")

    message = client.messages.create(
        model="claude-opus-4-5",          # Vision-capable model
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_b64,
                            # ── HOW THE IMAGE TRAVELS ────────────────────────
                            # The image bytes are encoded as a base64 string and
                            # embedded directly inside the JSON request body.
                            # This travels over HTTPS to api.anthropic.com.
                            # The image is processed in memory by the model and
                            # is NOT stored or used to retrain Claude.
                            # See: https://www.anthropic.com/privacy
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ],
            }
        ],
    )

    raw_text = message.content[0].text.strip()

    # Strip accidental markdown fences if present
    raw_text = raw_text.replace("```json", "").replace("```", "").strip()

    result = json.loads(raw_text)
    log.info(
        f"Analysis complete → status={result['status']}, "
        f"risk={result['risk_score']}/100, "
        f"confidence={result['confidence']}%"
    )
    return result


# ─────────────────────────────────────────────
#  REPORTING — send results to dashboard
# ─────────────────────────────────────────────

def send_to_dashboard(result: dict, timestamp: str, image_b64: str):
    """
    POSTs the analysis result to your dashboard webhook.
    The dashboard can be:
      - Your own web server (Node.js, Flask, etc.)
      - A free push notification service (ntfy.sh)
      - A Google Sheet via Apps Script
      - A simple JSON file on a shared drive
    """
    if not DASHBOARD_WEBHOOK_URL:
        log.info("No dashboard URL configured — skipping webhook")
        return

    import urllib.request

    payload = {
        "zone_id":    ZONE_ID,
        "zone_name":  ZONE_NAME,
        "timestamp":  timestamp,
        "result":     result,
        # Include thumbnail (resized) so dashboard can show a preview
        # For bandwidth savings, only send if critical/warning
        "image_b64":  image_b64 if result["status"] != "safe" else None,
    }

    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        DASHBOARD_WEBHOOK_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            log.info(f"Dashboard notified → HTTP {resp.status}")
    except Exception as e:
        log.error(f"Dashboard notify failed: {e}")


# ─────────────────────────────────────────────
#  LED INDICATOR — visual status on the stick
# ─────────────────────────────────────────────

def set_led(status: str):
    """
    Blink pattern on the physical LED:
      safe     → 1 slow blink (green if RGB LED)
      warning  → 3 fast blinks
      critical → rapid blink for 5 seconds
    """
    if LED_PIN is None:
        return
    try:
        import RPi.GPIO as GPIO
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(LED_PIN, GPIO.OUT)

        patterns = {
            "safe":     [(0.5, 0.5)] * 1,
            "warning":  [(0.1, 0.1)] * 3,
            "critical": [(0.05, 0.05)] * 20,
        }
        for on_t, off_t in patterns.get(status, []):
            GPIO.output(LED_PIN, GPIO.HIGH)
            time.sleep(on_t)
            GPIO.output(LED_PIN, GPIO.LOW)
            time.sleep(off_t)

        GPIO.cleanup()
    except ImportError:
        pass   # No GPIO on dev machine — skip silently


# ─────────────────────────────────────────────
#  MAIN LOOP
# ─────────────────────────────────────────────

def main():
    log.info("=" * 55)
    log.info(f"  Soil Erosion Sensor Stick starting up")
    log.info(f"  Zone : {ZONE_NAME}")
    log.info(f"  Interval: every {CAPTURE_INTERVAL_SECONDS}s")
    log.info("=" * 55)

    if SAVE_IMAGES_LOCALLY:
        IMAGE_SAVE_DIR.mkdir(parents=True, exist_ok=True)

    while True:
        timestamp = datetime.now().isoformat()
        log.info(f"── Cycle start @ {timestamp}")

        try:
            # 1. Capture image from camera
            image_bytes = capture_image()

            # 2. Optionally save locally
            image_b64 = base64.standard_b64encode(image_bytes).decode()
            if SAVE_IMAGES_LOCALLY:
                fname = IMAGE_SAVE_DIR / f"{ZONE_ID}_{timestamp.replace(':', '-')}.jpg"
                fname.write_bytes(image_bytes)
                log.info(f"Image saved → {fname}")

            # 3. Send to Claude AI for analysis
            result = analyse_image(image_bytes)

            # 4. Blink LED based on result
            set_led(result["status"])

            # 5. Send to dashboard
            send_to_dashboard(result, timestamp, image_b64)

            # 6. Print full result to log
            log.info(f"RESULT for {ZONE_NAME}:")
            log.info(f"  Status      : {result['status'].upper()}")
            log.info(f"  Risk score  : {result['risk_score']}/100")
            log.info(f"  Erosion type: {result['erosion_type']}")
            log.info(f"  Summary     : {result['summary']}")
            log.info(f"  Action      : {result['recommendation']}")

            # Alert loudly in log if critical
            if result["status"] == "critical":
                log.warning("⚠️  CRITICAL EROSION DETECTED — immediate action required!")

        except Exception as e:
            log.error(f"Cycle failed: {e}", exc_info=True)
            set_led("warning")  # Blink to indicate error

        log.info(f"── Sleeping {CAPTURE_INTERVAL_SECONDS}s until next capture\n")
        time.sleep(CAPTURE_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
