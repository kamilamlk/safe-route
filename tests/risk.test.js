import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEdge, zoneFor, annotate } from '../src/risk.js';

const edge = (over = {}) => ({
  highway: 'residential',
  lit: 'yes',
  tunnel: false,
  green: false,
  poiCount: 0,
  mid: { lat: 55.0, lon: 37.0 },
  ...over,
});

const day = { timeOfDay: 'day', dangerZones: [] };
const night = { timeOfDay: 'night', dangerZones: [] };

test('освещённая жилая улица: минимальный риск', () => {
  assert.equal(scoreEdge(edge(), day), 0.1);
  assert.equal(scoreEdge(edge(), night), 0.2);
});

test('неосвещённая улица ночью дороже, чем днём', () => {
  assert.ok(scoreEdge(edge({ lit: 'no' }), night) > scoreEdge(edge({ lit: 'no' }), day));
});

test('отсутствие тега lit дешевле явного lit=no', () => {
  assert.ok(scoreEdge(edge({ lit: 'unknown' }), night) < scoreEdge(edge({ lit: 'no' }), night));
});

test('тропа через парк ночью заметно дороже жилой улицы', () => {
  const trail = scoreEdge(edge({ highway: 'path', green: true, lit: 'no' }), night);
  assert.ok(trail > 2.5, `получили ${trail}`);
});

test('туннель перебивает базовый тип дороги', () => {
  assert.equal(scoreEdge(edge({ highway: 'footway', tunnel: true, lit: 'yes' }), night), 2.0);
});

test('POI рядом снижают риск', () => {
  const alone = scoreEdge(edge({ lit: 'no' }), night);
  const crowded = scoreEdge(edge({ lit: 'no', poiCount: 4 }), night);
  assert.ok(crowded < alone);
  assert.equal(Number((alone - crowded).toFixed(4)), 0.3);
});

test('риск не уходит ниже нуля и выше максимума', () => {
  assert.equal(scoreEdge(edge({ highway: 'footway', lit: 'yes', poiCount: 9 }), day), 0);
  const worst = scoreEdge(
    edge({ highway: 'path', green: true, tunnel: true, lit: 'no' }),
    night,
  );
  assert.ok(worst <= 5);
});

test('zoneFor определяет попадание в круг', () => {
  const zones = [
    { type: 'circle', center: { lat: 55.0, lon: 37.0 }, radiusM: 100, mode: 'forbid' },
  ];
  assert.equal(zoneFor({ lat: 55.0, lon: 37.0 }, zones), 'forbid');
  assert.equal(zoneFor({ lat: 55.1, lon: 37.0 }, zones), null);
});

test('forbid-зона даёт бесконечный риск, avoid — штраф', () => {
  const zone = (mode) => ({
    timeOfDay: 'day',
    dangerZones: [{ type: 'circle', center: { lat: 55.0, lon: 37.0 }, radiusM: 100, mode }],
  });
  assert.equal(scoreEdge(edge(), zone('forbid')), Infinity);
  assert.ok(scoreEdge(edge(), zone('avoid')) >= 3.0);
});

test('ignoreForbidden превращает запрет в штраф', () => {
  const ctx = {
    timeOfDay: 'day',
    ignoreForbidden: true,
    dangerZones: [
      { type: 'circle', center: { lat: 55.0, lon: 37.0 }, radiusM: 100, mode: 'forbid' },
    ],
  };
  const score = scoreEdge(edge(), ctx);
  assert.ok(Number.isFinite(score) && score >= 3.0);
});

test('annotate проставляет risk и inZone на рёбрах', () => {
  const attrs = [edge(), edge({ mid: { lat: 55.5, lon: 37.5 } })];
  annotate(attrs, {
    timeOfDay: 'day',
    dangerZones: [
      { type: 'circle', center: { lat: 55.0, lon: 37.0 }, radiusM: 100, mode: 'avoid' },
    ],
  });
  assert.equal(attrs[0].inZone, 'avoid');
  assert.ok(attrs[0].risk >= 3.0);
  assert.equal(attrs[1].inZone, null);
  assert.equal(attrs[1].risk, 0.1);
});
