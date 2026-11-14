// MitiWatch dashboard: loads results from the Flask API and draws them with Leaflet.
const map = L.map('map').setView([0.43, 32.96], 12);

const satellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Imagery © Esri', maxZoom: 18 }).addTo(map);
const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution: '© OpenStreetMap', maxZoom: 19 });

const baseLayers = { 'Satellite (Esri)': satellite, 'Streets': streets };
const overlays = {};
const control = L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);

const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const $ = (id) => document.getElementById(id);

function notice(text) {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function loadStats() {
  const s = await getJSON('/api/stats');
  if (!s.generated_at) {
    notice('No results yet. Run: python scripts/run_detection.py');
    return;
  }
  $('forest').textContent = fmt(s.forest_before_ha) + ' ha';
  $('loss').textContent = fmt(s.loss_ha, 1) + ' ha';
  $('count').textContent = fmt(s.patch_count);
  $('reserve').textContent = s.config.reserve_name;
  $('periods').textContent =
    `Before: ${s.config.before_start} → ${s.config.before_end} · ` +
    `After: ${s.config.after_start} → ${s.config.after_end} · ` +
    `Run: ${s.generated_at.slice(0, 10)}`;
}

async function loadAoi() {
  const fc = await getJSON('/api/aoi');
  if (!fc.features.length) return;
  const layer = L.geoJSON(fc, { style: { color: '#ffd400', weight: 2, fill: false } }).addTo(map);
  control.addOverlay(layer, 'Reserve boundary');
  map.fitBounds(layer.getBounds());
}

async function loadPatches() {
  const fc = await getJSON('/api/patches');
  const list = $('list');
  list.innerHTML = '';
  if (!fc.features.length) {
    list.innerHTML = '<li class="muted">No loss patches yet.</li>';
    return;
  }
  const layer = L.geoJSON(fc, {
    style: { color: '#ff1744', weight: 1, fillColor: '#ff1744', fillOpacity: 0.55 },
    onEachFeature: (f, l) => {
      const p = f.properties;
      const gmaps = `https://www.google.com/maps?q=${p.lat},${p.lon}`;
      l.bindPopup(
        `<b>Forest clearing</b><br>Area: ${fmt(p.area_ha, 2)} ha<br>` +
        `Location: ${Number(p.lat).toFixed(5)}, ${Number(p.lon).toFixed(5)}<br>` +
        `Detected between<br>${p.period_before} and ${p.period_after}<br>` +
        `<a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a>`);
    }
  }).addTo(map);
  control.addOverlay(layer, 'New forest loss');

  const top = [...layer.getLayers()]
    .sort((a, b) => b.feature.properties.area_ha - a.feature.properties.area_ha)
    .slice(0, 10);
  top.forEach((l) => {
    const p = l.feature.properties;
    const li = document.createElement('li');
    li.textContent = `${fmt(p.area_ha, 2)} ha — ${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}`;
    li.onclick = () => { map.fitBounds(l.getBounds(), { maxZoom: 16 }); l.openPopup(); };
    list.appendChild(li);
  });
}

async function loadTiles() {
  const t = await getJSON('/api/tiles');
  if (t.error) {
    console.info('Live Earth Engine layers off:', t.error);
    return;
  }
  const add = (url, name, show) => {
    const layer = L.tileLayer(url, { maxZoom: 18, attribution: 'Sentinel-2 / Google Earth Engine' });
    control.addOverlay(layer, name);
    if (show) layer.addTo(map);
  };
  add(t.before, 'Sentinel-2 BEFORE', false);
  add(t.after, 'Sentinel-2 AFTER', false);
  add(t.dndvi, 'NDVI change', false);
}

loadStats();
loadAoi().then(loadPatches);
loadTiles();
