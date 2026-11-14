/**
 * MitiWatch — Forest loss detection for Mabira Central Forest Reserve, Uganda
 * ---------------------------------------------------------------------------
 * HOW TO RUN
 *   1. Open https://code.earthengine.google.com (sign in with your Earth Engine account)
 *   2. New script -> paste this whole file -> click "Run"
 *   3. Drag the slider in the middle of the map: LEFT = before, RIGHT = after + red loss patches
 *   4. Console (right side) shows forest area, loss area and patch count
 *   5. Tasks tab -> run "mitiwatch_patches" to export the loss patches as GeoJSON to Google Drive
 *
 * METHOD (MVP)
 *   Sentinel-2 (10 m) -> Cloud Score+ cloud masking -> dry-season median composites
 *   -> NDVI before/after -> flag pixels that were forest and lost a lot of greenness
 *   -> remove tiny specks -> convert to polygons with area in hectares.
 */

// ============================ 1. SETTINGS ===================================
var CONFIG = {
  reserveName: 'Mabira',                    // name searched in the WDPA protected-areas dataset
  before: ['2024-12-01', '2025-02-28'],     // dry season, year 1
  after:  ['2025-12-01', '2026-02-28'],     // dry season, year 2 (same months = fair comparison)
  cloudScoreMin: 0.60,                      // Cloud Score+ cs_cdf: 1 = clear, 0 = cloudy
  forestNdviMin: 0.60,                      // pixel counted as forest "before" if NDVI >= this
  ndviDropMax: -0.25,                       // change in NDVI must be <= this (a big drop)
  afterNdviMax: 0.45,                       // and the pixel must no longer look like forest
  minPatchPixels: 25,                       // 25 px x 100 m2 = 0.25 ha minimum patch
  scale: 10                                 // Sentinel-2 resolution in metres
};

// ============================ 2. AREA OF INTEREST ===========================
// Rough box around Mabira, used only if the reserve is not found in WDPA.
var fallbackBox = ee.Geometry.Rectangle([32.85, 0.33, 33.08, 0.52]);

var wdpaMatch = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filter(ee.Filter.eq('ISO3', 'UGA'))
  .filter(ee.Filter.stringContains('NAME', CONFIG.reserveName));

var aoi = ee.Geometry(ee.Algorithms.If(
  wdpaMatch.size().gt(0), wdpaMatch.geometry(), fallbackBox));

print('WDPA matches for "' + CONFIG.reserveName + '" (0 = using fallback box):', wdpaMatch.size());

// ============================ 3. CLEAN COMPOSITES ===========================
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

function cleanComposite(range) {
  var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(range[0], range[1])
    .linkCollection(csPlus, ['cs_cdf'])
    .map(function (img) {
      var clear = img.select('cs_cdf').gte(CONFIG.cloudScoreMin);
      return img.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
        .divide(10000)
        .updateMask(clear);
    });
  print('Images used ' + range[0] + ' to ' + range[1] + ':', col.size());
  return col.median().clip(aoi);
}

function addNdvi(img) {
  return img.addBands(img.normalizedDifference(['B8', 'B4']).rename('NDVI'));
}

var before = addNdvi(cleanComposite(CONFIG.before));
var after  = addNdvi(cleanComposite(CONFIG.after));

// ============================ 4. CHANGE DETECTION ===========================
var ndviBefore = before.select('NDVI');
var ndviAfter  = after.select('NDVI');
var dNdvi = ndviAfter.subtract(ndviBefore).rename('dNDVI');

var forestBefore = ndviBefore.gte(CONFIG.forestNdviMin);

var rawLoss = forestBefore
  .and(dNdvi.lte(CONFIG.ndviDropMax))
  .and(ndviAfter.lt(CONFIG.afterNdviMax))
  .selfMask();

// Drop specks smaller than the minimum patch size (noise, single bad pixels)
var patchSize = rawLoss.connectedPixelCount(256, true);
var loss = rawLoss.updateMask(patchSize.gte(CONFIG.minPatchPixels)).rename('loss');

// ============================ 5. STATISTICS =================================
function areaHa(mask) {
  return ee.Number(mask.multiply(ee.Image.pixelArea()).divide(10000)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: CONFIG.scale,
      maxPixels: 1e10,
      bestEffort: true
    }).values().get(0));
}

var forestHa = areaHa(forestBefore.selfMask());
var lossHa   = areaHa(loss);

// ============================ 6. LOSS PATCHES (polygons) ====================
var patches = loss.toInt().reduceToVectors({
  geometry: aoi,
  scale: CONFIG.scale,
  geometryType: 'polygon',
  eightConnected: true,
  labelProperty: 'loss',
  maxPixels: 1e10,
  bestEffort: true
}).map(function (f) {
  var c = f.geometry().centroid(1).coordinates();
  return f.set({
    area_ha: f.geometry().area(1).divide(10000),
    lon: c.get(0),
    lat: c.get(1),
    period_before: CONFIG.before.join(' to '),
    period_after: CONFIG.after.join(' to ')
  });
});

print('Forest area before (ha):', forestHa);
print('New loss detected (ha):', lossHa);
print('Number of loss patches:', patches.size());
print('5 largest patches:', patches.sort('area_ha', false).limit(5));

Export.table.toDrive({
  collection: patches,
  description: 'mitiwatch_patches',
  folder: 'MitiWatch',
  fileFormat: 'GeoJSON'
});

// ============================ 7. SPLIT-SCREEN MAP ===========================
var rgbVis  = {bands: ['B4', 'B3', 'B2'], min: 0.0, max: 0.15, gamma: 1.2};
var ndviVis = {min: 0, max: 0.9, palette: ['#a6611a', '#dfc27d', '#f5f5f5', '#80cdc1', '#018571']};
var dVis    = {min: -0.5, max: 0.5, palette: ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641']};

// Validation layer: Hansen Global Forest Change, loss in 2020-2023
var hansen = ee.Image('UMD/hansen/global_forest_change_2023_v1_11');
var hansenRecent = hansen.select('lossyear').gte(20).selfMask().clip(aoi);

var outline = ee.Image().byte().paint({featureCollection: ee.FeatureCollection([ee.Feature(aoi)]), color: 1, width: 2});

var leftMap = ui.Map();
var rightMap = ui.Map();
leftMap.setOptions('HYBRID');
rightMap.setOptions('HYBRID');

leftMap.addLayer(before, rgbVis, 'Before: true colour');
leftMap.addLayer(ndviBefore, ndviVis, 'Before: NDVI', false);
leftMap.addLayer(outline, {palette: ['#ffff00']}, 'Reserve boundary');

rightMap.addLayer(after, rgbVis, 'After: true colour');
rightMap.addLayer(ndviAfter, ndviVis, 'After: NDVI', false);
rightMap.addLayer(dNdvi, dVis, 'NDVI change', false);
rightMap.addLayer(hansenRecent, {palette: ['#ff00ff']}, 'Hansen loss 2020-23 (validation)', false);
rightMap.addLayer(loss, {palette: ['#ff0000']}, 'MitiWatch: NEW forest loss');
rightMap.addLayer(outline, {palette: ['#ffff00']}, 'Reserve boundary');

ui.Map.Linker([leftMap, rightMap]);

var split = ui.SplitPanel({
  firstPanel: leftMap,
  secondPanel: rightMap,
  wipe: true,
  style: {stretch: 'both'}
});
ui.root.widgets().reset([split]);
leftMap.centerObject(aoi, 12);

// Title + live stats card
var title = ui.Label('MitiWatch: ' + CONFIG.reserveName + ' forest loss',
  {fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0'});
var periods = ui.Label('Left: ' + CONFIG.before.join(' to ') + '   |   Right: ' + CONFIG.after.join(' to '),
  {fontSize: '11px', color: '#555'});
var statsLabel = ui.Label('Calculating...', {fontSize: '12px'});
var legend = ui.Label('Red = new clearing detected', {color: '#d00', fontSize: '12px'});

rightMap.add(ui.Panel([title, periods, statsLabel, legend], null,
  {position: 'bottom-right', padding: '8px', width: '300px'}));

ee.Dictionary({forest: forestHa, loss: lossHa, n: patches.size()}).evaluate(function (s) {
  if (!s) { statsLabel.setValue('Could not compute stats - check the Console.'); return; }
  var pct = s.forest > 0 ? (100 * s.loss / s.forest).toFixed(2) : '0';
  statsLabel.setValue(
    'Forest before: ' + Math.round(s.forest).toLocaleString() + ' ha\n' +
    'New loss: ' + s.loss.toFixed(1) + ' ha (' + pct + '%)\n' +
    'Loss patches: ' + s.n);
  statsLabel.style().set('whiteSpace', 'pre');
});
