#!/usr/bin/env python3
"""
========================================================
  SOIL EROSION MONITORING — Backend Server
  Receives reports from all sensor sticks in the field,
  stores them, and serves a REST API for the dashboard.
========================================================

INSTALL:
  pip install flask flask-cors anthropic

RUN:
  python3 server.py

The server listens on port 5050.
Your dashboard points to http://YOUR-SERVER-IP:5050

ARCHITECTURE:
  [Stick Pi A] ──┐
  [Stick Pi B] ──┤──► POST /api/report ──► server.py ──► stores in reports.json
  [Stick Pi C] ──┘                                    └──► GET  /api/reports  ──► dashboard
"""

import json
import base64
import os
import anthropic
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ──────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "sk-ant-YOUR_KEY_HERE")
DATA_FILE   = Path("reports.json")      # Flat-file DB — no SQL needed for a demo
IMAGE_DIR   = Path("saved_images")
PORT        = 5050

app  = Flask(__name__, static_folder="static")
CORS(app)                               # Allow the dashboard (any origin) to call us

IMAGE_DIR.mkdir(exist_ok=True)

# ──────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────

def load_reports() -> list:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return []

def save_reports(reports: list):
    DATA_FILE.write_text(json.dumps(reports, indent=2))

def analyse_image_bytes(image_b64: str, zone_name: str) -> dict:
    """
    Called when a sensor stick POSTs a raw image (no pre-analysis).
    The server does the AI call centrally — saves API quota per stick.
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""You are an expert soil scientist and erosion specialist.
This image was captured by a ground-level sensor camera at: {zone_name}

Respond ONLY with a valid JSON object, no markdown:
{{
  "status": "safe|warning|critical",
  "risk_score": <integer 0-100>,
  "erosion_type": "none|sheet|rill|gully|wind|beginning",
  "confidence": <integer 0-100>,
  "summary": "<2-3 sentence plain English summary>",
  "indicators": ["<clue 1>", "<clue 2>", "<clue 3>"],
  "recommendation": "<one concrete remediation action>"
}}"""

    msg = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}},
                {"type": "text", "text": prompt}
            ]
        }]
    )
    raw = msg.content[0].text.strip().replace("```json","").replace("```","").strip()
    return json.loads(raw)


# ──────────────────────────────────────────────
#  ENDPOINTS
# ──────────────────────────────────────────────

@app.route("/api/report", methods=["POST"])
def receive_report():
    """
    Called by each Raspberry Pi sensor stick.

    Accepts two modes:
      Mode A — stick already ran AI analysis (erosion_sensor.py default):
        { zone_id, zone_name, timestamp, result: {...}, image_b64 }

      Mode B — stick just sends raw image, server does AI:
        { zone_id, zone_name, timestamp, image_b64, raw_only: true }
    """
    body = request.get_json(force=True)

    zone_id   = body.get("zone_id", "unknown")
    zone_name = body.get("zone_name", "Unknown Zone")
    timestamp = body.get("timestamp", datetime.now().isoformat())
    image_b64 = body.get("image_b64")

    # Mode B: server-side analysis
    if body.get("raw_only") and image_b64:
        try:
            result = analyse_image_bytes(image_b64, zone_name)
        except Exception as e:
            return jsonify({"error": f"AI analysis failed: {e}"}), 500
    else:
        result = body.get("result", {})

    # Save image to disk (only critical/warning to save space)
    image_filename = None
    if image_b64 and result.get("status") in ("critical", "warning"):
        safe_ts = timestamp.replace(":", "-").replace(".", "-")
        image_filename = f"{zone_id}_{safe_ts}.jpg"
        image_path = IMAGE_DIR / image_filename
        image_path.write_bytes(base64.b64decode(image_b64))

    # Build record
    record = {
        "id":             f"{zone_id}_{timestamp}",
        "zone_id":        zone_id,
        "zone_name":      zone_name,
        "timestamp":      timestamp,
        "result":         result,
        "image_filename": image_filename,
        # Thumbnail embedded for dashboard (small, only on alerts)
        "thumb_b64":      image_b64[:5000] if image_b64 and result.get("status") != "safe" else None,
    }

    reports = load_reports()
    reports.insert(0, record)
    reports = reports[:500]             # Keep last 500 records
    save_reports(reports)

    print(f"[{timestamp}] {zone_name} → {result.get('status','?')} (risk {result.get('risk_score','?')}/100)")
    return jsonify({"ok": True, "record_id": record["id"]}), 200


@app.route("/api/reports", methods=["GET"])
def get_reports():
    """Returns all stored reports, newest first."""
    reports = load_reports()
    zone_filter = request.args.get("zone_id")
    if zone_filter:
        reports = [r for r in reports if r["zone_id"] == zone_filter]
    limit = int(request.args.get("limit", 200))
    return jsonify(reports[:limit])


@app.route("/api/zones/summary", methods=["GET"])
def zones_summary():
    """
    Returns the LATEST status for each zone — what the dashboard
    map/grid shows at a glance.
    """
    reports = load_reports()
    seen    = {}
    for r in reports:
        zid = r["zone_id"]
        if zid not in seen:
            seen[zid] = r
    return jsonify(list(seen.values()))


@app.route("/api/analyse", methods=["POST"])
def analyse_endpoint():
    """
    Standalone endpoint: POST a base64 image + zone_name,
    get back AI analysis. Used by the web dashboard directly.
    """
    body      = request.get_json(force=True)
    image_b64 = body.get("image_b64", "")
    zone_name = body.get("zone_name", "Test Zone")
    if not image_b64:
        return jsonify({"error": "image_b64 required"}), 400
    try:
        result = analyse_image_bytes(image_b64, zone_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    reports = load_reports()
    return jsonify({
        "status":        "ok",
        "total_reports": len(reports),
        "server_time":   datetime.now().isoformat(),
    })


@app.route("/images/<filename>")
def serve_image(filename):
    return send_from_directory(IMAGE_DIR, filename)


# ──────────────────────────────────────────────
#  ENTRY POINT
# ──────────────────────────────────────────────

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════╗
║  Erosion Monitor Server  — port {PORT}    ║
║  Dashboard → http://localhost:{PORT}      ║
║  Health    → /api/health                 ║
╚══════════════════════════════════════════╝
""")
    app.run(host="0.0.0.0", port=PORT, debug=False)
