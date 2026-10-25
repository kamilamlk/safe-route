import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/explain.js';

const edge = (wayId, lengthM, attrs) => ({ lengthM, attrs: { wayId, lengthM, ...attrs } });

const shortest = {
  lengthM: 1000,
  edges: [
    edge(1, 300, { lit: 'no', highway: 'residential' }),
    edge(2, 200, { lit: 'yes', highway: 'path', green: true }),
    edge(3, 500, { lit: 'yes', highway: 'residential' }),
  ],
};

const safest = {
  lengthM: 1340,
  edges: [edge(3, 500, { lit: 'yes', highway: 'residential' }), edge(4, 840, { lit: 'yes', highway: 'footway' })],
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

test('не больше трёх причин', () => {
  const many = {
    lengthM: 100,
    edges: [
      edge(1, 10, { lit: 'no', highway: 'residential' }),
      edge(2, 20, { lit: 'yes', highway: 'path', green: true }),
      edge(3, 30, { lit: 'yes', highway: 'footway', tunnel: true }),
      edge(4, 40, { lit: 'unknown', highway: 'residential' }),
      edge(5, 50, { lit: 'yes', highway: 'primary' }),
    ],
  };
  assert.equal(explain(many, { lengthM: 200, edges: [] }).reasons.length, 3);
});

test('отсутствие маршрута не ломает объяснение', () => {
  assert.deepEqual(explain(null, safest), { deltaM: 0, reasons: [] });
});
