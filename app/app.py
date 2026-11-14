"""MitiWatch dashboard (Flask + Leaflet).

    python scripts/run_detection.py   # creates data/*.json first
    python app/app.py                 # open http://127.0.0.1:5000
"""
import json
import os
import sys
import time
from pathlib import Path

from flask import Flask, jsonify, render_template

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

EMPTY_FC = {"type": "FeatureCollection", "features": []}
TILE_TTL_SECONDS = 2 * 60 * 60


def create_app(data_dir: Path | None = None) -> Flask:
    app = Flask(__name__)
    data = Path(data_dir or os.getenv("MITIWATCH_DATA_DIR", ROOT / "data"))
    cache = {"tiles": None, "at": 0.0}

    def load(name, default):
        path = data / name
        if not path.exists():
            return default
        return json.loads(path.read_text())

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/stats")
    def stats():
        return jsonify(load("stats.json", {}))

    @app.route("/api/patches")
    def patches():
        return jsonify(load("patches.geojson", EMPTY_FC))

    @app.route("/api/aoi")
    def aoi():
        return jsonify(load("aoi.geojson", EMPTY_FC))

    @app.route("/api/tiles")
    def tiles():
        """Live satellite layers from Earth Engine (optional; needs EE_PROJECT)."""
        if cache["tiles"] and time.time() - cache["at"] < TILE_TTL_SECONDS:
            return jsonify(cache["tiles"])
        try:
            from mitiwatch.config import Config
            from mitiwatch import detection as det

            cfg = Config()
            saved = load("stats.json", {}).get("config", {})
            for key in ("reserve_name", "before_start", "before_end", "after_start", "after_end"):
                if key in saved:
                    setattr(cfg, key, saved[key])
            det.init_ee(cfg.ee_project)
            cache["tiles"] = det.tile_urls(det.detect(cfg))
            cache["at"] = time.time()
            return jsonify(cache["tiles"])
        except BaseException as exc:  # SystemExit if EE_PROJECT is missing
            return jsonify({"error": str(exc)}), 200

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
