import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/explain.js';

// edge(from, to, lengthM, attrs) — пара узлов опознаёт ребро, wayId отдельно.
const edge = (from, to, lengthM, attrs = {}) => ({
  from,
  to,
  lengthM,
  attrs: { wayId: attrs.wayId ?? 1, lengthM, ...attrs },
});

const shortest = {
  lengthM: 1000,
  edges: [
    edge(1, 2, 300, { wayId: 1, lit: 'no', highway: 'residential' }),
    edge(2, 3, 200, { wayId: 2, lit: 'yes', highway: 'path', green: true }),
    edge(3, 4, 500, { wayId: 3, lit: 'yes', highway: 'residential' }),
  ],
};

const safest = {
  lengthM: 1340,
  edges: [
    edge(3, 4, 500, { wayId: 3, lit: 'yes', highway: 'residential' }),
    edge(9, 3, 840, { wayId: 4, lit: 'yes', highway: 'footway' }),
  ],
};

test('считает удлинение маршрута', () => {
  assert.equal(explain(shortest, safest).deltaM, 340);
});

test('называет причины обхода, самая длинная первой', () => {
  const { reasons } = explain(shortest, safest);
  assert.equal(reasons.length, 2);
  assert.match(reasons[0].text, /неосвещённ/);
  assert.equal(reasons[0].avoidedM, 300);
  assert.match(reasons[1].text, /парк|пустыр/);
});

test('совпавшие маршруты объяснять нечего', () => {
  const r = explain(shortest, shortest);
  assert.equal(r.deltaM, 0);
  assert.deepEqual(r.reasons, []);
});

test('обход участка той же улицы виден как обойдённый', () => {
  // Один и тот же wayId, но другие рёбра: раньше сравнение по wayId это теряло.
  const direct = {
    lengthM: 500,
    edges: [edge(1, 2, 250, { wayId: 7, lit: 'no' }), edge(2, 3, 250, { wayId: 7, lit: 'no' })],
  };
  const detour = {
    lengthM: 700,
    edges: [edge(1, 8, 350, { wayId: 7, lit: 'yes' }), edge(8, 3, 350, { wayId: 7, lit: 'yes' })],
  };
  const { reasons, deltaM } = explain(direct, detour);
  assert.equal(deltaM, 200);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0].text, /неосвещённ/);
  assert.equal(reasons[0].avoidedM, 500);
});

test('направление ребра не влияет на сравнение', () => {
  const forward = { lengthM: 100, edges: [edge(1, 2, 100, { lit: 'no' })] };
  const backward = { lengthM: 100, edges: [edge(2, 1, 100, { lit: 'no' })] };
  assert.deepEqual(explain(forward, backward).reasons, []);
});

test('не больше трёх причин', () => {
  const many = {
    lengthM: 100,
    edges: [
      edge(1, 2, 10, { lit: 'no', highway: 'residential' }),
      edge(2, 3, 20, { lit: 'yes', highway: 'path', green: true }),
      edge(3, 4, 30, { lit: 'yes', highway: 'footway', tunnel: true }),
      edge(4, 5, 40, { lit: 'unknown', highway: 'residential' }),
      edge(5, 6, 50, { lit: 'yes', highway: 'primary' }),
    ],
  };
  assert.equal(explain(many, { lengthM: 200, edges: [] }).reasons.length, 3);
});

test('отсутствие маршрута не ломает объяснение', () => {
  assert.deepEqual(explain(null, safest), { deltaM: 0, reasons: [] });
});
