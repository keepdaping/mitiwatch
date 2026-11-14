"""Core Earth Engine logic: same method as gee/mitiwatch.js, in Python."""
import ee

from .config import Config

S2 = "COPERNICUS/S2_SR_HARMONIZED"
CS_PLUS = "GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"
WDPA = "WCMC/WDPA/current/polygons"
BANDS = ["B2", "B3", "B4", "B8", "B11", "B12"]


def init_ee(project: str) -> None:
    """Initialise Earth Engine; runs the browser login once if needed."""
    if not project:
        raise SystemExit("Set EE_PROJECT to your Google Cloud project id (see README).")
    try:
        ee.Initialize(project=project)
    except Exception:
        ee.Authenticate()
        ee.Initialize(project=project)


def get_aoi(cfg: Config) -> ee.Geometry:
    match = (ee.FeatureCollection(WDPA)
             .filter(ee.Filter.eq("ISO3", "UGA"))
             .filter(ee.Filter.stringContains("NAME", cfg.reserve_name)))
    fallback = ee.Geometry.Rectangle(list(cfg.fallback_bbox))
    return ee.Geometry(ee.Algorithms.If(match.size().gt(0), match.geometry(), fallback))


def clean_composite(aoi: ee.Geometry, start: str, end: str, cfg: Config) -> ee.Image:
    def mask(img):
        clear = img.select("cs_cdf").gte(cfg.cloud_score_min)
        return img.select(BANDS).divide(10000).updateMask(clear)

    col = (ee.ImageCollection(S2)
           .filterBounds(aoi)
           .filterDate(start, end)
           .linkCollection(ee.ImageCollection(CS_PLUS), ["cs_cdf"])
           .map(mask))
    img = col.median().clip(aoi)
    return img.addBands(img.normalizedDifference(["B8", "B4"]).rename("NDVI"))


def detect(cfg: Config) -> dict:
    """Return all the EE objects needed for maps, stats and export."""
    aoi = get_aoi(cfg)
    before = clean_composite(aoi, cfg.before_start, cfg.before_end, cfg)
    after = clean_composite(aoi, cfg.after_start, cfg.after_end, cfg)

    ndvi_b, ndvi_a = before.select("NDVI"), after.select("NDVI")
    d_ndvi = ndvi_a.subtract(ndvi_b).rename("dNDVI")
    forest_before = ndvi_b.gte(cfg.forest_ndvi_min)

    raw = (forest_before
           .And(d_ndvi.lte(cfg.ndvi_drop_max))
           .And(ndvi_a.lt(cfg.after_ndvi_max))
           .selfMask())
    size = raw.connectedPixelCount(256, True)
    loss = raw.updateMask(size.gte(cfg.min_patch_pixels)).rename("loss")

    return {"aoi": aoi, "before": before, "after": after, "d_ndvi": d_ndvi,
            "forest_before": forest_before, "loss": loss}


def area_ha(mask: ee.Image, aoi: ee.Geometry, scale: int) -> ee.Number:
    total = (mask.multiply(ee.Image.pixelArea()).divide(10000)
             .reduceRegion(reducer=ee.Reducer.sum(), geometry=aoi, scale=scale,
                           maxPixels=1e10, bestEffort=True))
    return ee.Number(total.values().get(0))


def loss_patches(loss: ee.Image, aoi: ee.Geometry, cfg: Config) -> ee.FeatureCollection:
    def describe(f):
        c = f.geometry().centroid(1).coordinates()
        return f.set({
            "area_ha": f.geometry().area(1).divide(10000),
            "lon": c.get(0),
            "lat": c.get(1),
            "period_before": f"{cfg.before_start} to {cfg.before_end}",
            "period_after": f"{cfg.after_start} to {cfg.after_end}",
        })

    vectors = loss.toInt().reduceToVectors(
        geometry=aoi, scale=cfg.scale, geometryType="polygon", eightConnected=True,
        labelProperty="loss", maxPixels=1e10, bestEffort=True)
    return vectors.map(describe).sort("area_ha", False)


RGB_VIS = {"bands": ["B4", "B3", "B2"], "min": 0.0, "max": 0.15, "gamma": 1.2}
DNDVI_VIS = {"min": -0.5, "max": 0.5,
             "palette": ["d7191c", "fdae61", "ffffbf", "a6d96a", "1a9641"]}


def tile_urls(result: dict) -> dict:
    """XYZ tile URLs for Leaflet. They expire after a few hours, so fetch fresh ones."""
    def url(img, vis):
        return img.getMapId(vis)["tile_fetcher"].url_format

    return {
        "before": url(result["before"], RGB_VIS),
        "after": url(result["after"], RGB_VIS),
        "dndvi": url(result["d_ndvi"], DNDVI_VIS),
        "loss": url(result["loss"], {"palette": ["ff0000"]}),
    }
