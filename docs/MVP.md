# MitiWatch: MVP Definition

## 1. Problem statement
Uganda's forests are shrinking fast, mostly from farmland expansion and charcoal production. Clearing inside forest reserves is usually discovered late, through foot patrols or public reports, when the trees are already gone. There's little local, up-to-date information on where and when clearing happens.

## 2. Target users
- Forest managers and rangers (e.g. National Forestry Authority staff)
- Conservation NGOs and community forest monitors
- Researchers and journalists covering deforestation

## 3. MVP goal
Prove that free satellite data can **automatically detect new forest clearing** in one reserve (Mabira CFR) and show it clearly on a map.

## 4. MVP features (in scope)
| # | Feature | Where |
|---|---|---|
| 1 | Load the reserve boundary (WDPA) | all versions |
| 2 | Cloud-masked Sentinel-2 "before" and "after" composites | `detection.py`, `mitiwatch.js` |
| 3 | NDVI change detection with forest rules | `detection.py` |
| 4 | Remove noise patches smaller than 0.25 ha | `detection.py` |
| 5 | Loss statistics: forest area, loss area, % loss, patch count | dashboard + console |
| 6 | Loss patches as polygons with area and coordinates (GeoJSON) | `run_detection.py` |
| 7 | Web dashboard: map, patch popups, largest clearings list, Google Maps link | `app/` |
| 8 | Before/after split-screen view | Code Editor + Colab |

## 5. Out of scope (next versions)
AI false-alarm filter, SMS alerts, multiple reserves, user accounts, ranger mobile app.

## 6. How the MVP is tested
1. **Visual check:** patches line up with clearings visible in the before/after imagery.
2. **Reference check:** compare with the Hansen Global Forest Change loss layer / Global Forest Watch.
3. **Spot check:** open 10 random patches in Google Maps satellite view and record how many are real clearings (gives a simple precision estimate).
4. **Software tests:** `pytest` checks the dashboard API.

## 7. Success criteria
- Runs end-to-end for Mabira in under 5 minutes.
- At least 7 of 10 spot-checked patches are real clearing.
- A non-technical user can find the largest clearing and its location in under 1 minute.
