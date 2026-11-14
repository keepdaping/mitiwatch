"""MitiWatch settings. Change dates/thresholds here or via environment variables."""
from dataclasses import dataclass, field, asdict
import os


@dataclass
class Config:
    ee_project: str = field(default_factory=lambda: os.getenv("EE_PROJECT", ""))
    reserve_name: str = "Mabira"
    # Rough box around Mabira (lon_min, lat_min, lon_max, lat_max), used if WDPA has no match
    fallback_bbox: tuple = (32.85, 0.33, 33.08, 0.52)
    before_start: str = "2024-12-01"
    before_end: str = "2025-02-28"
    after_start: str = "2025-12-01"
    after_end: str = "2026-02-28"
    cloud_score_min: float = 0.60
    forest_ndvi_min: float = 0.60
    ndvi_drop_max: float = -0.25
    after_ndvi_max: float = 0.45
    min_patch_pixels: int = 25          # 25 px x 100 m2 = 0.25 ha
    scale: int = 10
    max_patches: int = 5000

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("ee_project", None)
        return d
