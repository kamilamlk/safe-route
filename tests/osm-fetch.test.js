import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, cacheKey, fetchOsm } from '../src/osm-fetch.js';

const BBOX = { south: 55.0, west: 37.0, north: 55.01, east: 37.01 };

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    get size() { return data.size; },
  };
}

const ok = (elements) => ({ ok: true, status: 200, json: async () => ({ elements }) });

test('запрос содержит bbox и нужные слои', () => {
  const q = buildQuery(BBOX);
  assert.match(q, /55\.000000,37\.000000,55\.010000,37\.010000/);
  assert.match(q, /way\["highway"\]/);
  assert.match(q, /node\["highway"="bus_stop"\]/);
  assert.match(q, /way\["leisure"/);
});

test('ключ кэша стабилен и зависит от bbox', () => {
  assert.equal(cacheKey(BBOX), cacheKey({ ...BBOX }));
  assert.notEqual(cacheKey(BBOX), cacheKey({ ...BBOX, north: 55.5 }));
});

test('успешный ответ кэшируется и второй запрос идёт без сети', async () => {
  const storage = fakeStorage();
  let calls = 0;
  const fetchImpl = async () => { calls++; return ok([{ type: 'node', id: 1 }]); };

  const first = await fetchOsm(BBOX, { storage, fetchImpl });
  const second = await fetchOsm(BBOX, { storage, fetchImpl });

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
});

test('при отказе первого endpoint используется резервный', async () => {
  const storage = fakeStorage();
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (seen.length === 1) throw new Error('504');
    return ok([{ type: 'node', id: 2 }]);
  };

  const elements = await fetchOsm(BBOX, { storage, fetchImpl });
  assert.equal(seen.length, 2);
  assert.equal(elements[0].id, 2);
});

test('если все endpoint-ы упали, бросается понятная ошибка', async () => {
  const storage = fakeStorage();
  const fetchImpl = async () => { throw new Error('offline'); };
  await assert.rejects(
    () => fetchOsm(BBOX, { storage, fetchImpl }),
    /OpenStreetMap/,
  );
});

test('просроченный кэш игнорируется', async () => {
  const storage = fakeStorage();
  storage.setItem(cacheKey(BBOX), JSON.stringify({ at: 0, elements: [{ type: 'node', id: 7 }] }));
  const fetchImpl = async () => ok([{ type: 'node', id: 8 }]);
  const elements = await fetchOsm(BBOX, { storage, fetchImpl });
  assert.equal(elements[0].id, 8);
});
