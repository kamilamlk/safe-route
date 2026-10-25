import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGreenPolygons, collectPois, enrichEdges } from '../src/enrich.js';

const park = [
  { type: 'node', id: 10, lat: 55.000, lon: 37.000 },
  { type: 'node', id: 11, lat: 55.000, lon: 37.010 },
  { type: 'node', id: 12, lat: 55.010, lon: 37.010 },
  { type: 'node', id: 13, lat: 55.010, lon: 37.000 },
  { type: 'way', id: 200, nodes: [10, 11, 12, 13, 10], tags: { leisure: 'park' } },
];

const pois = [
  { type: 'node', id: 20, lat: 55.0050, lon: 37.0050, tags: { shop: 'bakery' } },
  { type: 'node', id: 21, lat: 55.0051, lon: 37.0050, tags: { amenity: 'cafe' } },
  { type: 'node', id: 22, lat: 55.0049, lon: 37.0051, tags: { highway: 'bus_stop' } },
  { type: 'node', id: 23, lat: 55.9000, lon: 37.9000, tags: { amenity: 'cafe' } },
  { type: 'node', id: 24, lat: 55.0050, lon: 37.0050, tags: { amenity: 'bench' } },
];

test('собирает зелёные полигоны', () => {
  const polys = collectGreenPolygons(park);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].length, 5);
});

test('полигон меньше трёх точек игнорируется', () => {
  const polys = collectGreenPolygons([
    { type: 'node', id: 1, lat: 55.0, lon: 37.0 },
    { type: 'way', id: 1, nodes: [1], tags: { landuse: 'forest' } },
  ]);
  assert.equal(polys.length, 0);
});

test('собирает только интересующие POI', () => {
  const found = collectPois(pois);
  assert.equal(found.length, 4);
});

test('ребро внутри парка помечается green, POI рядом считаются', () => {
  const attrs = [
    { mid: { lat: 55.005, lon: 37.005 }, green: false, poiCount: 0 },
    { mid: { lat: 55.500, lon: 37.500 }, green: false, poiCount: 0 },
  ];
  enrichEdges(attrs, {
    greenPolygons: collectGreenPolygons(park),
    pois: collectPois(pois),
  });
  assert.equal(attrs[0].green, true);
  assert.equal(attrs[0].poiCount, 3);
  assert.equal(attrs[1].green, false);
  assert.equal(attrs[1].poiCount, 0);
});
