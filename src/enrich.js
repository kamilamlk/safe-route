import { pointInPolygon, haversine } from './geo.js';
import { RISK } from './config.js';

const GREEN_LEISURE = new Set(['park', 'garden', 'nature_reserve']);
const GREEN_LANDUSE = new Set(['forest', 'grass', 'meadow', 'village_green']);
const GREEN_NATURAL = new Set(['scrub', 'wood', 'heath']);
const POI_AMENITIES = new Set(['cafe', 'restaurant', 'bar', 'pharmacy', 'school']);

const M_PER_DEG_LAT = 111320;

export function collectGreenPolygons(elements) {
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
  }
  const polygons = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags) continue;
    const t = el.tags;
    const green =
      GREEN_LEISURE.has(t.leisure) || GREEN_LANDUSE.has(t.landuse) || GREEN_NATURAL.has(t.natural);
    if (!green) continue;
    const ring = (el.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
    if (ring.length >= 3) polygons.push(ring);
  }
  return polygons;
}

export function collectPois(elements) {
  const out = [];
  for (const el of elements) {
    if (el.type !== 'node' || !el.tags) continue;
    const t = el.tags;
    if (t.shop || POI_AMENITIES.has(t.amenity) || t.highway === 'bus_stop') {
      out.push({ lat: el.lat, lon: el.lon });
    }
  }
  return out;
}

function buildGrid(pois, radiusM) {
  const cell = radiusM / M_PER_DEG_LAT;
  const map = new Map();
  for (const p of pois) {
    const key = `${Math.floor(p.lat / cell)}:${Math.floor(p.lon / cell)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return { cell, map };
}

function countNear({ cell, map }, point, radiusM) {
  const ci = Math.floor(point.lat / cell);
  const cj = Math.floor(point.lon / cell);
  let n = 0;
  for (let di = -2; di <= 2; di++) {
    for (let dj = -2; dj <= 2; dj++) {
      for (const p of map.get(`${ci + di}:${cj + dj}`) || []) {
        if (haversine(p, point) <= radiusM) n++;
      }
    }
  }
  return n;
}

export function enrichEdges(edgeAttrs, { greenPolygons = [], pois = [] }) {
  const grid = buildGrid(pois, RISK.eyesRadiusM);
  for (const attrs of edgeAttrs) {
    attrs.green = greenPolygons.some((ring) => pointInPolygon(attrs.mid, ring));
    attrs.poiCount = countNear(grid, attrs.mid, RISK.eyesRadiusM);
  }
}
