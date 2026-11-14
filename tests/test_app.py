import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
from app import create_app  # noqa: E402


def client(tmp_path):
    return create_app(tmp_path).test_client()


def test_index_loads(tmp_path):
    r = client(tmp_path).get("/")
    assert r.status_code == 200
    assert b"MitiWatch" in r.data


def test_empty_data_returns_empty_collections(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/patches").get_json() == {"type": "FeatureCollection", "features": []}
    assert c.get("/api/aoi").get_json()["features"] == []
    assert c.get("/api/stats").get_json() == {}


def test_reads_saved_results(tmp_path):
    fc = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [32.96, 0.43]},
        "properties": {"area_ha": 1.5, "lat": 0.43, "lon": 32.96}}]}
    (tmp_path / "patches.geojson").write_text(json.dumps(fc))
    (tmp_path / "stats.json").write_text(json.dumps({"loss_ha": 1.5}))
    c = client(tmp_path)
    assert c.get("/api/patches").get_json()["features"][0]["properties"]["area_ha"] == 1.5
    assert c.get("/api/stats").get_json()["loss_ha"] == 1.5


def test_tiles_without_earth_engine_does_not_crash(tmp_path, monkeypatch):
    monkeypatch.delenv("EE_PROJECT", raising=False)
    r = client(tmp_path).get("/api/tiles")
    assert r.status_code == 200
    assert "error" in r.get_json()
