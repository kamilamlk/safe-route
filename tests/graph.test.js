import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nearestNode } from '../src/graph.js';

const elements = [
  { type: 'node', id: 1, lat: 55.000, lon: 37.000 },
  { type: 'node', id: 2, lat: 55.000, lon: 37.001 },
  { type: 'node', id: 3, lat: 55.000, lon: 37.002 },
  { type: 'node', id: 9, lat: 55.100, lon: 37.100 },
  {
    type: 'way', id: 100, nodes: [1, 2, 3],
    tags: { highway: 'residential', lit: 'yes' },
  },
  {
    type: 'way', id: 101, nodes: [1, 9],
    tags: { highway: 'motorway' },
  },
  {
    type: 'way', id: 102, nodes: [2, 9],
    tags: { highway: 'footway', foot: 'no' },
  },
];

test('строит узлы и двусторонние рёбра проходимых дорог', () => {
  const g = buildGraph(elements);
  assert.equal(g.edgeAttrs.length, 2);
  assert.equal(g.adj.get(1).length, 1);
  assert.equal(g.adj.get(2).length, 2);
  assert.equal(g.adj.get(3).length, 1);
});

test('оба направления ребра ссылаются на один объект attrs', () => {
  const g = buildGraph(elements);
  const forward = g.adj.get(1).find((e) => e.to === 2);
  const backward = g.adj.get(2).find((e) => e.to === 1);
  assert.equal(forward.attrs, backward.attrs);
});

test('непроходимые дороги отброшены', () => {
  const g = buildGraph(elements);
  assert.equal(g.adj.has(9), false);
});

test('теги разобраны в признаки ребра', () => {
  const g = buildGraph(elements);
  const attrs = g.edgeAttrs[0];
  assert.equal(attrs.highway, 'residential');
  assert.equal(attrs.lit, 'yes');
  assert.equal(attrs.tunnel, false);
  assert.equal(attrs.wayId, 100);
  assert.ok(attrs.lengthM > 50 && attrs.lengthM < 90, `получили ${attrs.lengthM}`);
  assert.ok(attrs.mid.lat === 55.0);
});

test('отсутствующий тег lit даёт unknown, layer<0 даёт туннель', () => {
  const g = buildGraph([
    { type: 'node', id: 1, lat: 55.0, lon: 37.0 },
    { type: 'node', id: 2, lat: 55.0, lon: 37.001 },
    { type: 'way', id: 1, nodes: [1, 2], tags: { highway: 'footway', layer: '-1' } },
  ]);
  assert.equal(g.edgeAttrs[0].lit, 'unknown');
  assert.equal(g.edgeAttrs[0].tunnel, true);
});

test('nearestNode находит ближайший узел с рёбрами', () => {
  const g = buildGraph(elements);
  assert.equal(nearestNode(g, { lat: 55.0001, lon: 37.0019 }, 200), 3);
});

test('nearestNode отказывает, если улица слишком далеко', () => {
  const g = buildGraph(elements);
  assert.equal(nearestNode(g, { lat: 56.0, lon: 38.0 }, 200), null);
});
