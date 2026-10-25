import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProvider } from '../src/route-provider/local.js';

const A = { lat: 55.000, lon: 37.000 };
const B = { lat: 55.000, lon: 37.010 };

const ELEMENTS = [
  { type: 'node', id: 1, lat: 55.000, lon: 37.000 },
  { type: 'node', id: 2, lat: 55.000, lon: 37.010 },
  { type: 'node', id: 3, lat: 55.000, lon: 37.005 },
  { type: 'node', id: 4, lat: 55.004, lon: 37.005 },
  { type: 'way', id: 100, nodes: [1, 3, 2], tags: { highway: 'path', lit: 'no' } },
  { type: 'way', id: 101, nodes: [1, 4, 2], tags: { highway: 'residential', lit: 'yes' } },
  { type: 'node', id: 50, lat: 54.998, lon: 36.998 },
  { type: 'node', id: 51, lat: 54.998, lon: 37.012 },
  { type: 'node', id: 52, lat: 55.001, lon: 37.012 },
  { type: 'node', id: 53, lat: 55.001, lon: 36.998 },
  { type: 'way', id: 200, nodes: [50, 51, 52, 53, 50], tags: { leisure: 'park' } },
];

// Парк накрывает только путь через узел 3 (середины его рёбер на широте 55.000).
// Рёбра жилой улицы идут через 55.002 — заведомо снаружи полигона, без
// попадания на границу.

const provider = createLocalProvider({ fetchOsm: async () => ELEMENTS });

const request = (over = {}) => ({
  from: A, to: B, timeOfDay: 'night', safetyWeight: 1, dangerZones: [], ...over,
});

test('возвращает кратчайший и безопасный маршруты', async () => {
  const res = await provider.route(request());
  const shortest = res.routes.find((r) => r.kind === 'shortest');
  const safest = res.routes.find((r) => r.kind === 'safest');
  assert.ok(shortest && safest);
  assert.ok(safest.lengthM > shortest.lengthM);
  assert.ok(shortest.geometry.length >= 2);
  assert.ok(safest.durationS > 0);
});

test('ночью безопасный маршрут обходит неосвещённую тропу в парке', async () => {
  const res = await provider.route(request());
  const { reasons } = res.explanation;
  assert.ok(reasons.length > 0);
  assert.ok(res.explanation.deltaM > 0);
});

test('при safetyWeight=0 маршруты совпадают', async () => {
  const res = await provider.route(request({ safetyWeight: 0 }));
  const [a, b] = res.routes;
  assert.equal(a.lengthM, b.lengthM);
  assert.deepEqual(res.explanation.reasons, []);
});

test('зона forbid на коротком пути уводит маршрут в обход', async () => {
  // Радиус 200 м: середины рёбер короткого пути в 160 м от центра зоны,
  // середины рёбер жилой улицы — в 274 м, то есть снаружи.
  const res = await provider.route(request({
    safetyWeight: 0,
    dangerZones: [{ type: 'circle', center: { lat: 55.0, lon: 37.005 }, radiusM: 200, mode: 'forbid' }],
  }));
  const safest = res.routes.find((r) => r.kind === 'safest');
  assert.ok(safest.lengthM > 900, `получили ${safest.lengthM}`);
  assert.ok(!safest.violatesForbidden);
});

test('если обойти запрет нельзя, маршрут помечается флагом', async () => {
  const res = await provider.route(request({
    dangerZones: [{ type: 'circle', center: { lat: 55.002, lon: 37.005 }, radiusM: 3000, mode: 'forbid' }],
  }));
  const safest = res.routes.find((r) => r.kind === 'safest');
  assert.equal(safest.violatesForbidden, true);
});

test('точка далеко от улиц даёт понятную ошибку', async () => {
  // 668 м до ближайшего узла графа — дальше лимита snapM, но bbox остаётся
  // маленьким, поэтому срабатывает именно проверка привязки.
  await assert.rejects(
    () => provider.route(request({ from: { lat: 55.006, lon: 37.000 } })),
    /дорогу рядом/,
  );
});

test('слишком большой участок отклоняется до запроса данных', async () => {
  const strict = createLocalProvider({
    fetchOsm: async () => { throw new Error('не должно вызываться'); },
  });
  await assert.rejects(
    () => strict.route(request({ to: { lat: 59.9, lon: 30.3 } })),
    /слишком большой/,
  );
});
