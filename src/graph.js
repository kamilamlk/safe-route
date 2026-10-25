import { haversine, midpoint } from './geo.js';

const EXCLUDED_HIGHWAYS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'construction', 'proposed', 'raceway', 'bus_guideway',
]);

function isWalkable(tags) {
  if (EXCLUDED_HIGHWAYS.has(tags.highway)) return false;
  if (tags.foot === 'no' || tags.access === 'private' || tags.access === 'no') return false;
  return true;
}

function parseLit(value) {
  if (value === 'yes' || value === '24/7') return 'yes';
  if (value === 'no') return 'no';
  return 'unknown';
}

function isTunnel(tags) {
  if (tags.tunnel && tags.tunnel !== 'no') return true;
  return Number(tags.layer) < 0;
}

export function buildGraph(elements) {
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
  }

  const adj = new Map();
  const edgeAttrs = [];

  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.highway || !isWalkable(el.tags)) continue;
    const seq = el.nodes || [];
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i], b = seq[i + 1];
      const na = nodes.get(a), nb = nodes.get(b);
      if (!na || !nb) continue;
      const lengthM = haversine(na, nb);
      if (lengthM === 0) continue;

      const attrs = {
        wayId: el.id,
        highway: el.tags.highway,
        lit: parseLit(el.tags.lit),
        tunnel: isTunnel(el.tags),
        lengthM,
        mid: midpoint(na, nb),
        green: false,
        poiCount: 0,
        inZone: null,
        risk: 0,
      };
      edgeAttrs.push(attrs);

      for (const [from, to] of [[a, b], [b, a]]) {
        if (!adj.has(from)) adj.set(from, []);
        adj.get(from).push({ from, to, lengthM, attrs });
      }
    }
  }

  return { nodes, adj, edgeAttrs };
}

export function nearestNode(graph, point, maxM) {
  let bestId = null;
  let bestD = Infinity;
  for (const id of graph.adj.keys()) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    const d = haversine(n, point);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  return bestD <= maxM ? bestId : null;
}
