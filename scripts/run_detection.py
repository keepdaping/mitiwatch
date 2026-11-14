"""Run MitiWatch detection and save results for the dashboard.

Usage:
    export EE_PROJECT=your-cloud-project-id
    python scripts/run_detection.py
    python scripts/run_detection.py --after-start 2026-06-01 --after-end 2026-08-31
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from mitiwatch.config import Config  # noqa: E402
from mitiwatch import detection as det  # noqa: E402


def main() -> None:
    cfg = Config()
    p = argparse.ArgumentParser(description="Detect forest loss with Sentinel-2.")
    p.add_argument("--project", default=cfg.ee_project, help="Google Cloud project id")
    p.add_argument("--reserve", default=cfg.reserve_name)
    for name in ("before_start", "before_end", "after_start", "after_end"):
        p.add_argument("--" + name.replace("_", "-"), default=getattr(cfg, name))
    p.add_argument("--out", default=str(ROOT / "data"))
    args = p.parse_args()

    cfg.ee_project, cfg.reserve_name = args.project, args.reserve
    for name in ("before_start", "before_end", "after_start", "after_end"):
        setattr(cfg, name, getattr(args, name))

    det.init_ee(cfg.ee_project)
    print(f"Running MitiWatch for {cfg.reserve_name}: "
          f"{cfg.before_start}..{cfg.before_end} vs {cfg.after_start}..{cfg.after_end}")

    r = det.detect(cfg)
    patches = det.loss_patches(r["loss"], r["aoi"], cfg).limit(cfg.max_patches)

    stats = {
        "forest_before_ha": det.area_ha(r["forest_before"].selfMask(), r["aoi"], cfg.scale),
        "loss_ha": det.area_ha(r["loss"], r["aoi"], cfg.scale),
        "patch_count": patches.size(),
        "aoi": r["aoi"],
    }
    s = ee_info(stats)
    geojson = patches.getInfo()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "patches.geojson").write_text(json.dumps(geojson))
    (out / "aoi.geojson").write_text(json.dumps(
        {"type": "FeatureCollection",
         "features": [{"type": "Feature", "properties": {"name": cfg.reserve_name},
                       "geometry": s.pop("aoi")}]}))
    forest = s["forest_before_ha"] or 0
    s.update({
        "loss_pct": round(100 * s["loss_ha"] / forest, 3) if forest else 0,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": cfg.to_dict(),
    })
    (out / "stats.json").write_text(json.dumps(s, indent=2))

    print(f"Forest before: {forest:,.0f} ha | New loss: {s['loss_ha']:.1f} ha "
          f"({s['loss_pct']}%) | Patches: {s['patch_count']}")
    print(f"Saved results to {out}")


def ee_info(d: dict) -> dict:
    import ee
    return ee.Dictionary(d).getInfo()


if __name__ == "__main__":
    main()
