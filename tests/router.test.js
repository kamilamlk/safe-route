import { test } from 'node:test';
import assert from 'node:assert/strict';
import { astar } from '../src/router.js';
import { annotate } from '../src/risk.js';
import { haversine, midpoint } from '../src/geo.js';

const NODES = new Map([
  [1, { lat: 55.000, lon: 37.000 }],
  [2, { lat: 55.000, lon: 37.010 }],
  [3, { lat: 55.000, lon: 37.005 }],
  [4, { lat: 55.003, lon: 37.005 }],
]);

function link(adj, attrsList, a, b, tags) {
  const na = NODES.get(a), nb = NODES.get(b);
  const attrs = {
    lit: 'unknown', tunnel: false, green: false, poiCount: 0,
    mid: midpoint(na, nb), ...tags,
  };
  attrsList.push(attrs);
  const lengthM = haversine(na, nb);
  for (const [from, to] of [[a, b], [b, a]]) {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ from, to, lengthM, attrs });
  }
}

function buildTestGraph() {
  const adj = new Map();
  const edgeAttrs = [];
  link(adj, edgeAttrs, 1, 3, { highway: 'path', green: true, lit: 'no' });
  link(adj, edgeAttrs, 3, 2, { highway: 'path', green: true, lit: 'no' });
  link(adj, edgeAttrs, 1, 4, { highway: 'residential', lit: 'yes' });
  link(adj, edgeAttrs, 4, 2, { highway: 'residential', lit: 'yes' });
  return { nodes: NODES, adj, edgeAttrs };
}

const costFn = (w) => (e) =>
  Number.isFinite(e.attrs.risk) ? e.lengthM * (1 + w * e.attrs.risk) : Infinity;

test('при safetyWeight=0 выбирается кратчайший путь через тропу', () => {
  const g = buildTestGraph();
  annotate(g.edgeAttrs, { timeOfDay: 'night', dangerZones: [] });
  const r = astar(g, 1, 2, costFn(0));
  assert.deepEqual(r.nodeIds, [1, 3, 2]);
});

test('при safetyWeight=1 ночью маршрут уходит на освещённую улицу', () => {
  const g = buildTestGraph();
  annotate(g.edgeAttrs, { timeOfDay: 'night', dangerZones: [] });
  const r = astar(g, 1, 2, costFn(1));
  assert.deepEqual(r.nodeIds, [1, 4, 2]);
  assert.ok(r.lengthM > 900);
});

test('forbid-зона на коротком пути уводит маршрут в обход', () => {
  const g = buildTestGraph();
  annotate(g.edgeAttrs, {
    timeOfDay: 'day',
    dangerZones: [
      { type: 'circle', center: NODES.get(3), radiusM: 200, mode: 'forbid' },
    ],
  });
  const r = astar(g, 1, 2, costFn(0));
  assert.deepEqual(r.nodeIds, [1, 4, 2]);
});

test('если все пути запрещены, маршрут не найден', () => {
  const g = buildTestGraph();
  annotate(g.edgeAttrs, {
    timeOfDay: 'day',
    dangerZones: [
      { type: 'circle', center: { lat: 55.0015, lon: 37.005 }, radiusM: 5000, mode: 'forbid' },
    ],
  });
  assert.equal(astar(g, 1, 2, costFn(0)), null);
});

test('роутер возвращает сумму длин и список рёбер', () => {
  const g = buildTestGraph();
  annotate(g.edgeAttrs, { timeOfDay: 'day', dangerZones: [] });
  const r = astar(g, 1, 2, costFn(0));
  assert.equal(r.edges.length, 2);
  assert.ok(Math.abs(r.lengthM - r.edges.reduce((s, e) => s + e.lengthM, 0)) < 1e-6);
});

test('неизвестный узел даёт null', () => {
  const g = buildTestGraph();
  annotate(g.edgeAttrs, { timeOfDay: 'day', dangerZones: [] });
  assert.equal(astar(g, 1, 999, costFn(0)), null);
});
