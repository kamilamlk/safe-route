import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, midpoint, pointInPolygon, bboxAround, bboxAreaKm2 } from '../src/geo.js';

const MOSCOW = { lat: 55.7558, lon: 37.6173 };
const SPB = { lat: 59.9343, lon: 30.3351 };

test('haversine считает расстояние Москва — Петербург', () => {
  const d = haversine(MOSCOW, SPB);
  assert.ok(Math.abs(d - 634000) < 6000, `получили ${d}`);
});

test('haversine одной точки с собой равен нулю', () => {
  assert.equal(haversine(MOSCOW, MOSCOW), 0);
});

test('midpoint лежит посередине', () => {
  const m = midpoint({ lat: 0, lon: 0 }, { lat: 2, lon: 4 });
  assert.deepEqual(m, { lat: 1, lon: 2 });
});

test('pointInPolygon различает внутри и снаружи', () => {
  const square = [
    { lat: 0, lon: 0 }, { lat: 0, lon: 2 },
    { lat: 2, lon: 2 }, { lat: 2, lon: 0 },
  ];
  assert.equal(pointInPolygon({ lat: 1, lon: 1 }, square), true);
  assert.equal(pointInPolygon({ lat: 3, lon: 1 }, square), false);
});

test('bboxAround охватывает точки с отступом', () => {
  const b = bboxAround([{ lat: 55.0, lon: 37.0 }, { lat: 55.01, lon: 37.01 }], 500);
  assert.ok(b.south < 55.0 && b.north > 55.01);
  assert.ok(b.west < 37.0 && b.east > 37.01);
});

test('bboxAreaKm2 считает площадь квадрата примерно верно', () => {
  const b = { south: 55.0, west: 37.0, north: 55.009, east: 37.0157 };
  const area = bboxAreaKm2(b);
  assert.ok(area > 0.8 && area < 1.3, `получили ${area}`);
});
