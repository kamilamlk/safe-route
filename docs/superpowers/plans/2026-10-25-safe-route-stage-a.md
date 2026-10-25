# Безопасный маршрут, этап A — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Статический сайт, который строит пешеходный маршрут из А в Б, выбирая наименее опасный путь по данным OpenStreetMap и объясняя причину обхода.

**Architecture:** Вся логика в браузере. Граф улиц грузится из Overpass API по участку вокруг А и Б, обогащается признаками (освещение, парки, POI), A* считает два маршрута — кратчайший и безопасный. Роутинг спрятан за интерфейсом `RouteProvider`, чтобы на этапе C подменить его на вызов бэкенда.

**Tech Stack:** Нативные ES-модули без сборки, Leaflet 1.9 с CDN, Overpass API, Nominatim, тесты на встроенном `node --test` (Node 26).

**Спека:** `docs/superpowers/specs/2026-10-25-safe-route-design.md`

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `package.json` | `type: module`, скрипт `test` |
| `index.html` | разметка панели и карты, подключение Leaflet |
| `src/config.js` | веса риска, endpoints, лимиты, скорости — только данные |
| `src/geo.js` | haversine, midpoint, point-in-polygon, bbox — чистая геометрия |
| `src/osm-fetch.js` | запрос к Overpass и кэш; ничего не знает про граф |
| `src/geocode.js` | адрес → координаты через Nominatim |
| `src/graph.js` | элементы OSM → узлы, рёбра, adjacency; `nearestNode` |
| `src/enrich.js` | зелёные полигоны и POI → признаки `green`, `poiCount` на рёбрах |
| `src/risk.js` | `scoreEdge(attrs, ctx)` — чистая функция; `annotate` проставляет риск |
| `src/router.js` | A* с функцией стоимости извне; не знает про OSM-теги |
| `src/explain.js` | два маршрута → причины обхода и дельта длины |
| `src/route-provider/local.js` | реализация `RouteProvider`: собирает всё вышеперечисленное |
| `src/ui/map.js` | Leaflet: слои, маркеры, отрисовка маршрутов и зон (`drawZones`) |
| `src/ui/danger-zones.js` | зоны опасности: хранение, рисование, экспорт/импорт |
| `src/ui/panel.js` | панель управления, состояние формы |
| `src/main.js` | склейка UI и провайдера |
| `src/styles.css` | оформление |

Ключевое решение: два направления одного ребра ссылаются на **один общий объект `attrs`**. Поэтому `enrich` и `annotate` проставляют признаки один раз, а не дважды, и пересчёт риска стоит один проход по `graph.edgeAttrs`.

---

## Task 1: Каркас проекта и геометрия

**Files:**
- Create: `package.json`, `.gitignore`, `src/geo.js`
- Test: `tests/geo.test.js`

- [ ] **Step 1: Инициализировать репозиторий и каркас**

```bash
cd /Users/kamilamva/Documents/personal/tech
git init
mkdir -p src/route-provider src/ui tests
```

`package.json`:

```json
{
  "name": "safe-route",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "serve": "python3 -m http.server 8000"
  }
}
```

`.gitignore`:

```
.DS_Store
node_modules/
```

- [ ] **Step 2: Написать падающий тест геометрии**

`tests/geo.test.js`:

```js
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
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/geo.js'`

- [ ] **Step 4: Реализовать `src/geo.js`**

```js
const EARTH_R = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;
const M_PER_DEG_LAT = 111320;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

// Ray casting. ring — массив {lat, lon}, замыкать вручную не нужно.
export function pointInPolygon(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lon;
    const yj = ring[j].lat, xj = ring[j].lon;
    const crosses =
      yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function bboxAround(points, padM) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLat = padM / M_PER_DEG_LAT;
  const padLon = padM / (M_PER_DEG_LAT * Math.max(0.01, Math.cos(rad(midLat))));
  return {
    south: Math.min(...lats) - padLat,
    west: Math.min(...lons) - padLon,
    north: Math.max(...lats) + padLat,
    east: Math.max(...lons) + padLon,
  };
}

export function bboxAreaKm2(b) {
  const h = haversine({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.west });
  const w = haversine({ lat: b.south, lon: b.west }, { lat: b.south, lon: b.east });
  return (h / 1000) * (w / 1000);
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 6 tests

- [ ] **Step 6: Коммит**

```bash
git add package.json .gitignore src/geo.js tests/geo.test.js
git commit -m "feat: каркас проекта и геометрические примитивы"
```

---

## Task 2: Конфиг весов и модель риска

**Files:**
- Create: `src/config.js`, `src/risk.js`
- Test: `tests/risk.test.js`

- [ ] **Step 1: Создать `src/config.js`**

Это только данные, тестов не требует.

```js
// Индекс 0 — день, индекс 1 — ночь.
export const RISK = {
  base: {
    footway: [0.0, 0.1],
    sidewalk: [0.0, 0.1],
    pedestrian: [0.0, 0.1],
    living_street: [0.0, 0.1],
    residential: [0.1, 0.2],
    service: [0.1, 0.2],
    unclassified: [0.1, 0.2],
    path: [0.1, 0.3],
    track: [0.1, 0.3],
    steps: [0.2, 0.5],
    tertiary: [0.4, 0.6],
    secondary: [0.4, 0.6],
    primary: [0.4, 0.6],
  },
  baseDefault: [0.2, 0.4],
  // Тропа path/track внутри парка, леса или пустыря — заменяет base.
  baseGreenPath: [0.3, 1.2],
  // Туннель или подземный переход — заменяет base, приоритет выше green.
  baseTunnel: [0.8, 2.0],
  lighting: { yes: [0, 0], unknown: [0.15, 0.8], no: [0.3, 1.5] },
  eyes: { many: -0.3, few: -0.15, none: 0 },
  eyesRadiusM: 50,
  eyesManyThreshold: 3,
  dangerZoneAvoid: 3.0,
  min: 0,
  max: 5,
};

export const GREEN_PATH_HIGHWAYS = new Set(['path', 'track', 'footway']);

// Метры в секунду.
export const SPEED = { default: 5000 / 3600, steps: 2000 / 3600 };

export const DEFAULTS = { safetyWeight: 0.6, timeOfDay: 'day', zoneRadiusM: 150 };

export const LIMITS = {
  padM: 500,          // отступ bbox вокруг точек А и Б
  maxAreaKm2: 100,    // выше — отказ с просьбой сузить участок
  warnEdges: 60000,   // выше — предупреждение о скорости
  snapM: 200,         // максимум до ближайшей улицы
};

export const OVERPASS = {
  endpoints: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ],
  timeoutS: 30,
  cacheTtlMs: 7 * 24 * 3600 * 1000,
  cachePrefix: 'safe-route:osm:',
};

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export const ZONES_STORAGE_KEY = 'safe-route:zones';
```

- [ ] **Step 2: Написать падающий тест риска**

`tests/risk.test.js`:

```js
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
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/risk.js'`

- [ ] **Step 4: Реализовать `src/risk.js`**

```js
import { RISK, GREEN_PATH_HIGHWAYS } from './config.js';
import { haversine } from './geo.js';

const slot = (ctx) => (ctx.timeOfDay === 'night' ? 1 : 0);

export function zoneFor(point, zones = []) {
  let found = null;
  for (const z of zones) {
    if (z.type !== 'circle') continue;
    if (haversine(point, z.center) > z.radiusM) continue;
    if (z.mode === 'forbid') return 'forbid';
    found = 'avoid';
  }
  return found;
}

function baseRisk(attrs, i) {
  if (attrs.tunnel) return RISK.baseTunnel[i];
  if (attrs.green && GREEN_PATH_HIGHWAYS.has(attrs.highway)) return RISK.baseGreenPath[i];
  return (RISK.base[attrs.highway] || RISK.baseDefault)[i];
}

function eyesRisk(attrs) {
  if (attrs.poiCount >= RISK.eyesManyThreshold) return RISK.eyes.many;
  if (attrs.poiCount > 0) return RISK.eyes.few;
  return RISK.eyes.none;
}

export function scoreEdge(attrs, ctx) {
  const zone = zoneFor(attrs.mid, ctx.dangerZones);
  if (zone === 'forbid' && !ctx.ignoreForbidden) return Infinity;

  const i = slot(ctx);
  const raw =
    baseRisk(attrs, i) +
    RISK.lighting[attrs.lit || 'unknown'][i] +
    eyesRisk(attrs) +
    (zone ? RISK.dangerZoneAvoid : 0);

  return Math.min(RISK.max, Math.max(RISK.min, raw));
}

// Мутирует общие attrs рёбер: один проход на запрос маршрута.
export function annotate(edgeAttrs, ctx) {
  for (const attrs of edgeAttrs) {
    attrs.inZone = zoneFor(attrs.mid, ctx.dangerZones);
    attrs.risk = scoreEdge(attrs, ctx);
  }
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 17 tests

- [ ] **Step 6: Коммит**

```bash
git add src/config.js src/risk.js tests/risk.test.js
git commit -m "feat: конфиг весов и модель риска ребра"
```

---

## Task 3: A*-роутер

**Files:**
- Create: `src/router.js`
- Test: `tests/router.test.js`

- [ ] **Step 1: Написать падающий тест роутера**

Граф: два пути из `1` в `2`. Короткий через `3` — тропа через парк без освещения (~640 м). Длинный через `4` — освещённая жилая улица (~925 м).

`tests/router.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/router.js'`

- [ ] **Step 3: Реализовать `src/router.js`**

Эвристика — haversine до цели. Она допустима, потому что стоимость ребра всегда не меньше его длины (`risk >= 0`), значит A* не переоценивает остаток.

```js
import { haversine } from './geo.js';

class MinHeap {
  #items = [];

  push(item) {
    const a = this.#items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.#items.length;
  }
}

function buildResult(startId, goalId, prevNode, prevEdge, cost) {
  const nodeIds = [goalId];
  const edges = [];
  let cur = goalId;
  while (cur !== startId) {
    edges.push(prevEdge.get(cur));
    cur = prevNode.get(cur);
    nodeIds.push(cur);
  }
  nodeIds.reverse();
  edges.reverse();
  return {
    nodeIds,
    edges,
    cost,
    lengthM: edges.reduce((s, e) => s + e.lengthM, 0),
  };
}

export function astar(graph, startId, goalId, edgeCost) {
  const goal = graph.nodes.get(goalId);
  const start = graph.nodes.get(startId);
  if (!goal || !start) return null;
  if (startId === goalId) return { nodeIds: [startId], edges: [], cost: 0, lengthM: 0 };

  const g = new Map([[startId, 0]]);
  const prevNode = new Map();
  const prevEdge = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push({ id: startId, f: haversine(start, goal) });

  while (open.size) {
    const cur = open.pop();
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);
    if (cur.id === goalId) return buildResult(startId, goalId, prevNode, prevEdge, g.get(goalId));

    for (const e of graph.adj.get(cur.id) || []) {
      const c = edgeCost(e);
      if (!Number.isFinite(c)) continue;
      const tentative = g.get(cur.id) + c;
      if (tentative < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, tentative);
        prevNode.set(e.to, cur.id);
        prevEdge.set(e.to, e);
        const n = graph.nodes.get(e.to);
        if (n) open.push({ id: e.to, f: tentative + haversine(n, goal) });
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 23 tests

- [ ] **Step 5: Коммит**

```bash
git add src/router.js tests/router.test.js
git commit -m "feat: A*-роутер с внешней функцией стоимости"
```

---

## Task 4: Построение графа из данных OSM

**Files:**
- Create: `src/graph.js`
- Test: `tests/graph.test.js`

- [ ] **Step 1: Написать падающий тест графа**

`tests/graph.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/graph.js'`

- [ ] **Step 3: Реализовать `src/graph.js`**

```js
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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 30 tests

- [ ] **Step 5: Коммит**

```bash
git add src/graph.js tests/graph.test.js
git commit -m "feat: построение графа улиц из элементов OSM"
```

---

## Task 5: Обогащение рёбер — парки и POI

**Files:**
- Create: `src/enrich.js`
- Test: `tests/enrich.test.js`

- [ ] **Step 1: Написать падающий тест**

`tests/enrich.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/enrich.js'`

- [ ] **Step 3: Реализовать `src/enrich.js`**

Пространственный индекс POI — хеш по ячейкам размером в радиус поиска по широте. По долготе ячейка физически меньше, поэтому просматриваем ±2 ячейки: на широте 55° это ±57 м, что покрывает радиус 50 м.

```js
import { pointInPolygon, haversine } from './geo.js';
import { RISK } from './config.js';

const GREEN_LEISURE = new Set(['park', 'garden', 'nature_reserve']);
const GREEN_LANDUSE = new Set(['forest', 'grass', 'meadow', 'village_green']);
const GREEN_NATURAL = new Set(['scrub', 'wood', 'heath']);
const POI_AMENITIES = new Set(['cafe', 'restaurant', 'bar', 'pharmacy', 'school']);

const M_PER_DEG_LAT = 111320;

export function collectGreenPolygons(elements) {
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
  }
  const polygons = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags) continue;
    const t = el.tags;
    const green =
      GREEN_LEISURE.has(t.leisure) || GREEN_LANDUSE.has(t.landuse) || GREEN_NATURAL.has(t.natural);
    if (!green) continue;
    const ring = (el.nodes || []).map((id) => nodes.get(id)).filter(Boolean);
    if (ring.length >= 3) polygons.push(ring);
  }
  return polygons;
}

export function collectPois(elements) {
  const out = [];
  for (const el of elements) {
    if (el.type !== 'node' || !el.tags) continue;
    const t = el.tags;
    if (t.shop || POI_AMENITIES.has(t.amenity) || t.highway === 'bus_stop') {
      out.push({ lat: el.lat, lon: el.lon });
    }
  }
  return out;
}

function buildGrid(pois, radiusM) {
  const cell = radiusM / M_PER_DEG_LAT;
  const map = new Map();
  for (const p of pois) {
    const key = `${Math.floor(p.lat / cell)}:${Math.floor(p.lon / cell)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return { cell, map };
}

function countNear({ cell, map }, point, radiusM) {
  const ci = Math.floor(point.lat / cell);
  const cj = Math.floor(point.lon / cell);
  let n = 0;
  for (let di = -2; di <= 2; di++) {
    for (let dj = -2; dj <= 2; dj++) {
      for (const p of map.get(`${ci + di}:${cj + dj}`) || []) {
        if (haversine(p, point) <= radiusM) n++;
      }
    }
  }
  return n;
}

export function enrichEdges(edgeAttrs, { greenPolygons = [], pois = [] }) {
  const grid = buildGrid(pois, RISK.eyesRadiusM);
  for (const attrs of edgeAttrs) {
    attrs.green = greenPolygons.some((ring) => pointInPolygon(attrs.mid, ring));
    attrs.poiCount = countNear(grid, attrs.mid, RISK.eyesRadiusM);
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 34 tests

- [ ] **Step 5: Коммит**

```bash
git add src/enrich.js tests/enrich.test.js
git commit -m "feat: обогащение ребер признаками парков и POI"
```

---

## Task 6: Объяснение маршрута

**Files:**
- Create: `src/explain.js`
- Test: `tests/explain.test.js`

- [ ] **Step 1: Написать падающий тест**

`tests/explain.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/explain.js'`

- [ ] **Step 3: Реализовать `src/explain.js`**

Порядок правил важен: у ребра может сработать несколько, берём первое — самое весомое.

```js
const RULES = [
  { key: 'zone', test: (a) => Boolean(a.inZone), text: 'обходит отмеченную тобой опасную зону' },
  { key: 'tunnel', test: (a) => a.tunnel, text: 'обходит туннель или подземный переход' },
  {
    key: 'green',
    test: (a) => a.green && ['path', 'track', 'footway'].includes(a.highway),
    text: 'обходит тропу через парк или пустырь',
  },
  { key: 'dark', test: (a) => a.lit === 'no', text: 'обходит неосвещённый участок' },
  { key: 'road', test: (a) => ['primary', 'secondary', 'tertiary'].includes(a.highway), text: 'обходит участок вдоль крупной дороги' },
  { key: 'unknown-light', test: (a) => a.lit === 'unknown', text: 'обходит участок без данных об освещении' },
];

export function explain(shortest, safest) {
  if (!shortest || !safest) return { deltaM: 0, reasons: [] };

  const keptWays = new Set(safest.edges.map((e) => e.attrs.wayId));
  const avoided = shortest.edges.filter((e) => !keptWays.has(e.attrs.wayId));
  const byReason = new Map();

  for (const e of avoided) {
    const rule = RULES.find((r) => r.test(e.attrs));
    if (!rule) continue;
    const prev = byReason.get(rule.key)?.avoidedM || 0;
    byReason.set(rule.key, { text: rule.text, avoidedM: prev + e.lengthM });
  }

  const reasons = [...byReason.values()]
    .sort((a, b) => b.avoidedM - a.avoidedM)
    .slice(0, 3)
    .map((r) => ({ text: r.text, avoidedM: Math.round(r.avoidedM) }));

  return { deltaM: Math.round(safest.lengthM - shortest.lengthM), reasons };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 39 tests

- [ ] **Step 5: Коммит**

```bash
git add src/explain.js tests/explain.test.js
git commit -m "feat: объяснение, почему маршрут проложен в обход"
```

---

## Task 7: Загрузка данных OSM и геокодирование

**Files:**
- Create: `src/osm-fetch.js`, `src/geocode.js`
- Test: `tests/osm-fetch.test.js`

- [ ] **Step 1: Написать падающий тест**

`tests/osm-fetch.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/osm-fetch.js'`

- [ ] **Step 3: Реализовать `src/osm-fetch.js`**

```js
import { OVERPASS } from './config.js';

export function buildQuery(bbox) {
  const b = [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((v) => v.toFixed(6))
    .join(',');
  return `[out:json][timeout:${OVERPASS.timeoutS}];
(
  way["highway"](${b});
  node["shop"](${b});
  node["amenity"~"^(cafe|restaurant|bar|pharmacy|school)$"](${b});
  node["highway"="bus_stop"](${b});
  way["leisure"~"^(park|garden|nature_reserve)$"](${b});
  way["landuse"~"^(forest|grass|meadow|village_green)$"](${b});
  way["natural"~"^(scrub|wood|heath)$"](${b});
);
out body;
>;
out skel qt;`;
}

export function cacheKey(bbox) {
  const r = (v) => v.toFixed(3);
  return `${OVERPASS.cachePrefix}${r(bbox.south)}:${r(bbox.west)}:${r(bbox.north)}:${r(bbox.east)}`;
}

function readCache(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const { at, elements } = JSON.parse(raw);
    if (Date.now() - at > OVERPASS.cacheTtlMs) {
      storage.removeItem(key);
      return null;
    }
    return elements;
  } catch {
    return null;
  }
}

function writeCache(storage, key, elements) {
  try {
    storage?.setItem(key, JSON.stringify({ at: Date.now(), elements }));
  } catch {
    // Квота переполнена — кэш не обязателен, молча продолжаем.
  }
}

export async function fetchOsm(bbox, options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const key = cacheKey(bbox);

  const cached = readCache(storage, key);
  if (cached) return cached;

  let lastError = null;
  for (const url of OVERPASS.endpoints) {
    try {
      const res = await fetchImpl(url, { method: 'POST', body: buildQuery(bbox) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { elements = [] } = await res.json();
      writeCache(storage, key, elements);
      return elements;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Не удалось получить данные OpenStreetMap: ${lastError?.message || 'нет ответа'}. Попробуй ещё раз через минуту.`,
  );
}
```

- [ ] **Step 4: Реализовать `src/geocode.js`**

Проверяется руками в браузере: сеть мокать здесь дороже пользы.

Nominatim требует не больше одного запроса в секунду — держим паузу сами, иначе
сервис начнёт отвечать 429.

```js
import { NOMINATIM } from './config.js';

let lastCallAt = 0;

async function respectRateLimit() {
  const wait = 1000 - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function geocode(query, fetchImpl = globalThis.fetch) {
  await respectRateLimit();
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Поиск адреса недоступен (HTTP ${res.status})`);
  const results = await res.json();
  if (!results.length) throw new Error('Адрес не найден. Поставь точку кликом по карте.');
  return {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
    label: results[0].display_name,
  };
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 45 tests

- [ ] **Step 6: Коммит**

```bash
git add src/osm-fetch.js src/geocode.js tests/osm-fetch.test.js
git commit -m "feat: загрузка данных Overpass с кэшем и геокодирование"
```

---

## Task 8: RouteProvider — локальная реализация

**Files:**
- Create: `src/route-provider/local.js`
- Test: `tests/local-provider.test.js`

- [ ] **Step 1: Написать падающий тест**

Фикстура — минимальный ответ Overpass: два пути из А в Б, короткий через неосвещённую тропу в парке.

`tests/local-provider.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/route-provider/local.js'`

- [ ] **Step 3: Реализовать `src/route-provider/local.js`**

```js
import { bboxAround, bboxAreaKm2 } from '../geo.js';
import { fetchOsm as defaultFetchOsm } from '../osm-fetch.js';
import { buildGraph, nearestNode } from '../graph.js';
import { collectGreenPolygons, collectPois, enrichEdges } from '../enrich.js';
import { annotate } from '../risk.js';
import { astar } from '../router.js';
import { explain } from '../explain.js';
import { LIMITS, SPEED, RISK } from '../config.js';

const byLength = (e) => e.lengthM;

const safeCost = (weight) => (e) =>
  Number.isFinite(e.attrs.risk) ? e.lengthM * (1 + weight * e.attrs.risk) : Infinity;

function durationS(route) {
  return route.edges.reduce((sum, e) => {
    const speed = e.attrs.highway === 'steps' ? SPEED.steps : SPEED.default;
    return sum + e.lengthM / speed;
  }, 0);
}

function riskScore(route) {
  if (!route.lengthM) return 0;
  const weighted = route.edges.reduce((sum, e) => {
    const risk = Number.isFinite(e.attrs.risk) ? e.attrs.risk : RISK.max;
    return sum + risk * e.lengthM;
  }, 0);
  return weighted / route.lengthM;
}

function toRoute(kind, route, graph, extra = {}) {
  return {
    kind,
    geometry: route.nodeIds.map((id) => {
      const n = graph.nodes.get(id);
      return [n.lat, n.lon];
    }),
    lengthM: Math.round(route.lengthM),
    durationS: Math.round(durationS(route)),
    riskScore: Number(riskScore(route).toFixed(3)),
    ...extra,
  };
}

export function createLocalProvider({ fetchOsm = defaultFetchOsm, onProgress = () => {} } = {}) {
  return {
    async route(request) {
      const bbox = bboxAround([request.from, request.to], LIMITS.padM);
      const area = bboxAreaKm2(bbox);
      if (area > LIMITS.maxAreaKm2) {
        throw new Error(
          `Участок слишком большой (${Math.round(area)} км²). Выбери точки ближе друг к другу — пока работает район, а не весь город.`,
        );
      }

      onProgress('Загружаю карту района…');
      const elements = await fetchOsm(bbox);

      onProgress('Строю граф улиц…');
      const graph = buildGraph(elements);
      if (!graph.edgeAttrs.length) {
        throw new Error('В этом районе нет данных о пешеходных путях в OpenStreetMap.');
      }
      if (graph.edgeAttrs.length > LIMITS.warnEdges) {
        onProgress(`Район большой (${graph.edgeAttrs.length} рёбер), расчёт займёт время…`);
      }

      enrichEdges(graph.edgeAttrs, {
        greenPolygons: collectGreenPolygons(elements),
        pois: collectPois(elements),
      });

      const startId = nearestNode(graph, request.from, LIMITS.snapM);
      const goalId = nearestNode(graph, request.to, LIMITS.snapM);
      if (startId === null || goalId === null) {
        throw new Error('Не нашла дорогу рядом с точкой. Переставь её ближе к улице.');
      }

      onProgress('Считаю маршруты…');
      const ctx = { timeOfDay: request.timeOfDay, dangerZones: request.dangerZones || [] };
      annotate(graph.edgeAttrs, ctx);

      const shortest = astar(graph, startId, goalId, byLength);
      let safest = astar(graph, startId, goalId, safeCost(request.safetyWeight));
      let violatesForbidden = false;

      if (!safest) {
        annotate(graph.edgeAttrs, { ...ctx, ignoreForbidden: true });
        safest = astar(graph, startId, goalId, safeCost(request.safetyWeight));
        violatesForbidden = Boolean(safest);
      }

      if (!shortest && !safest) {
        throw new Error('Маршрут между этими точками не найден — они в разных частях графа улиц.');
      }

      const routes = [];
      if (shortest) routes.push(toRoute('shortest', shortest, graph));
      if (safest) routes.push(toRoute('safest', safest, graph, { violatesForbidden }));

      return { routes, explanation: explain(shortest, safest) };
    },
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 52 tests

- [ ] **Step 5: Коммит**

```bash
git add src/route-provider/local.js tests/local-provider.test.js
git commit -m "feat: локальная реализация RouteProvider"
```

---

## Task 9: Разметка, стили и карта

**Files:**
- Create: `index.html`, `src/styles.css`, `src/ui/map.js`

Тестов нет — DOM и Leaflet проверяются руками в Task 12.

- [ ] **Step 1: Создать `index.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Безопасный маршрут</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="src/styles.css">
</head>
<body>
  <aside class="panel">
    <h1>Безопасный маршрут</h1>

    <section class="block">
      <label class="field">
        <span>Адрес</span>
        <input id="address" type="text" placeholder="улица и дом">
      </label>
      <div class="row">
        <button id="find-a" type="button">Найти как А</button>
        <button id="find-b" type="button">Найти как Б</button>
      </div>
      <p class="hint">Или поставь точки кликом по карте.</p>
      <div class="row">
        <button id="pick-a" type="button">Указать А</button>
        <button id="pick-b" type="button">Указать Б</button>
      </div>
      <p class="points"><span id="point-a">А: не задана</span><br><span id="point-b">Б: не задана</span></p>
    </section>

    <section class="block">
      <label class="field">
        <span>Время суток</span>
        <select id="time-of-day">
          <option value="day">День</option>
          <option value="night">Ночь</option>
        </select>
      </label>
      <label class="field">
        <span>Быстрее ↔ безопаснее: <output id="safety-out">0.6</output></span>
        <input id="safety" type="range" min="0" max="1" step="0.1" value="0.6">
      </label>
    </section>

    <section class="block">
      <h2>Опасные зоны</h2>
      <div class="row">
        <button id="zone-avoid" type="button">Обходить</button>
        <button id="zone-forbid" type="button">Не ходить</button>
      </div>
      <label class="field">
        <span>Радиус, м</span>
        <input id="zone-radius" type="number" min="20" max="2000" step="10" value="150">
      </label>
      <ul id="zone-list" class="zones"></ul>
      <div class="row">
        <button id="zones-export" type="button">Выгрузить</button>
        <label class="file-button">
          Загрузить<input id="zones-import" type="file" accept="application/json" hidden>
        </label>
      </div>
    </section>

    <button id="build" class="primary" type="button">Построить маршрут</button>

    <section id="status" class="status" role="status"></section>
    <section id="result" class="result" hidden></section>

    <footer class="disclaimer">
      «Безопасность» здесь — оценка по открытым данным OpenStreetMap. Данные об
      освещении неполные, криминальная статистика не используется. Инструмент
      помогает сравнить варианты, но не гарантирует безопасность и не подходит
      для чрезвычайных ситуаций.
    </footer>
  </aside>

  <main id="map"></main>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать `src/styles.css`**

Сначала подними скилл `soft-brutalist-ui` — спека требует брать оформление
оттуда. Код ниже написан в том же духе и служит отправной точкой: если скилл
задаёт свои переменные, классы или типографику, приведи файл к ним, сохранив
структуру селекторов (разметка в `index.html` на них опирается).

```css
:root {
  --bg: #f4f1ea;
  --ink: #1b1a17;
  --line: #1b1a17;
  --accent: #2f6f4f;
  --warn: #a8452c;
  --muted: #6b665c;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100vh;
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
  background: var(--bg);
}

.panel {
  overflow-y: auto;
  padding: 20px;
  border-right: 2px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 8px; }

.block { border: 2px solid var(--line); padding: 12px; background: #fff; }

.field { display: block; margin-bottom: 10px; }
.field > span { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.field input, .field select { width: 100%; padding: 7px; border: 2px solid var(--line); background: #fff; font: inherit; }

.row { display: flex; gap: 8px; margin-bottom: 8px; }
.row > button, .file-button {
  flex: 1;
  padding: 7px;
  border: 2px solid var(--line);
  background: #fff;
  font: inherit;
  cursor: pointer;
  text-align: center;
}
.row > button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }

.primary {
  padding: 12px;
  border: 2px solid var(--line);
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled { background: var(--muted); cursor: not-allowed; }

.hint, .points { font-size: 13px; color: var(--muted); margin: 4px 0; }

.zones { list-style: none; margin: 8px 0; padding: 0; font-size: 13px; }
.zones li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid #ddd; }
.zones button { border: none; background: none; color: var(--warn); cursor: pointer; font: inherit; }

.status { font-size: 13px; color: var(--muted); min-height: 1.4em; }
.status.error { color: var(--warn); font-weight: 600; }

.result { border: 2px solid var(--line); padding: 12px; background: #fff; font-size: 14px; }
.result dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 10px; }
.result dt { color: var(--muted); }
.result ul { margin: 0; padding-left: 18px; }
.result .flag { color: var(--warn); font-weight: 600; }

.disclaimer { font-size: 12px; color: var(--muted); margin-top: auto; }

#map { height: 100vh; }

@media (max-width: 760px) {
  body { grid-template-columns: 1fr; grid-template-rows: auto 60vh; height: auto; }
  .panel { border-right: none; border-bottom: 2px solid var(--line); }
  #map { height: 60vh; }
}
```

- [ ] **Step 3: Создать `src/ui/map.js`**

```js
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const START_VIEW = [[55.7558, 37.6173], 14];

const STYLES = {
  shortest: { color: '#6b665c', weight: 4, opacity: 0.7, dashArray: '6 6' },
  safest: { color: '#2f6f4f', weight: 6, opacity: 0.95 },
};

export function createMap(elementId) {
  const map = L.map(elementId).setView(...START_VIEW);
  L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const zoneLayer = L.layerGroup().addTo(map);
  const markers = { from: null, to: null };

  function setPoint(kind, point) {
    if (markers[kind]) markerLayer.removeLayer(markers[kind]);
    markers[kind] = L.marker([point.lat, point.lon], { title: kind === 'from' ? 'А' : 'Б' })
      .addTo(markerLayer)
      .bindTooltip(kind === 'from' ? 'А' : 'Б', { permanent: true, direction: 'top' });
  }

  function drawRoutes(routes) {
    routeLayer.clearLayers();
    const order = ['shortest', 'safest'];
    for (const kind of order) {
      const route = routes.find((r) => r.kind === kind);
      if (!route) continue;
      L.polyline(route.geometry, STYLES[kind]).addTo(routeLayer);
    }
    const safest = routes.find((r) => r.kind === 'safest') || routes[0];
    if (safest) map.fitBounds(L.polyline(safest.geometry).getBounds(), { padding: [30, 30] });
  }

  function clearRoutes() {
    routeLayer.clearLayers();
  }

  function onClick(handler) {
    map.on('click', (e) => handler({ lat: e.latlng.lat, lon: e.latlng.lng }));
  }

  function setCursor(active) {
    map.getContainer().style.cursor = active ? 'crosshair' : '';
  }

  return { map, zoneLayer, setPoint, drawRoutes, clearRoutes, onClick, setCursor };
}
```

- [ ] **Step 4: Проверить, что тесты по-прежнему зелёные**

Run: `npm test`
Expected: PASS, 52 tests (новых тестов нет, регрессий тоже)

- [ ] **Step 5: Коммит**

```bash
git add index.html src/styles.css src/ui/map.js
git commit -m "feat: разметка, стили и слой карты"
```

---

## Task 10: Зоны опасности

**Files:**
- Create: `src/ui/danger-zones.js`

Упрощение этапа A: зона задаётся кликом по карте (центр) и значением из поля радиуса. Рисование перетаскиванием не делаем — ценность та же, кода втрое меньше.

Отклонение от первоначального наброска: Leaflet-окружности рисует `map.js`
методом `drawZones(zones)`, а этот модуль только хранит данные и строит список.
Так весь Leaflet остаётся в одном файле, а модуль зон тестируем без карты.

- [ ] **Step 1: Создать `src/ui/danger-zones.js`**

```js
import { ZONES_STORAGE_KEY } from '../config.js';

const FILL = { avoid: '#d08c3c', forbid: '#a8452c' };
const LABEL = { avoid: 'обходить', forbid: 'не ходить' };

export function loadZones() {
  try {
    const raw = localStorage.getItem(ZONES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidZone) : [];
  } catch {
    return [];
  }
}

function isValidZone(z) {
  return (
    z && z.type === 'circle' &&
    Number.isFinite(z?.center?.lat) && Number.isFinite(z?.center?.lon) &&
    Number.isFinite(z.radiusM) && (z.mode === 'avoid' || z.mode === 'forbid')
  );
}

function saveZones(zones) {
  try {
    localStorage.setItem(ZONES_STORAGE_KEY, JSON.stringify(zones));
  } catch {
    // Квота переполнена — зоны останутся только в памяти до перезагрузки.
  }
}

export function createZoneStore({ mapApi, listElement, onChange }) {
  let zones = loadZones();

  function render() {
    mapApi.zoneLayer.clearLayers();
    listElement.textContent = '';

    zones.forEach((zone, index) => {
      L.circle([zone.center.lat, zone.center.lon], {
        radius: zone.radiusM,
        color: FILL[zone.mode],
        fillColor: FILL[zone.mode],
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(mapApi.zoneLayer);

      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${LABEL[zone.mode]} · ${zone.radiusM} м · ${zone.center.lat.toFixed(4)}, ${zone.center.lon.toFixed(4)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'удалить';
      remove.addEventListener('click', () => {
        zones.splice(index, 1);
        saveZones(zones);
        render();
        onChange();
      });
      li.append(text, remove);
      listElement.append(li);
    });
  }

  function add(zone) {
    zones.push(zone);
    saveZones(zones);
    render();
    onChange();
  }

  function replaceAll(next) {
    zones = next.filter(isValidZone);
    saveZones(zones);
    render();
    onChange();
  }

  render();

  return {
    get all() { return zones; },
    add,
    replaceAll,
    render,
  };
}

export function exportZones(zones) {
  const blob = new Blob([JSON.stringify(zones, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'danger-zones.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importZones(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Ожидался JSON-массив зон.');
  return parsed;
}
```

- [ ] **Step 2: Проверить, что тесты зелёные**

Run: `npm test`
Expected: PASS, 52 tests

- [ ] **Step 3: Коммит**

```bash
git add src/ui/danger-zones.js
git commit -m "feat: зоны опасности с хранением и экспортом"
```

---

## Task 11: Панель управления и склейка

**Files:**
- Create: `src/ui/panel.js`, `src/main.js`

- [ ] **Step 1: Создать `src/ui/panel.js`**

```js
const el = (id) => document.getElementById(id);

const FIELDS = {
  address: 'address',
  timeOfDay: 'time-of-day',
  safety: 'safety',
  safetyOut: 'safety-out',
  zoneRadius: 'zone-radius',
  zoneList: 'zone-list',
  status: 'status',
  result: 'result',
  build: 'build',
  pointA: 'point-a',
  pointB: 'point-b',
};

const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${m} м`);
const fmtDuration = (s) => `${Math.max(1, Math.round(s / 60))} мин`;

export function createPanel({ onBuild, onPick, onFind, onZoneMode, onExport, onImport }) {
  const nodes = Object.fromEntries(Object.entries(FIELDS).map(([k, id]) => [k, el(id)]));

  nodes.safety.addEventListener('input', () => {
    nodes.safetyOut.textContent = nodes.safety.value;
  });

  el('pick-a').addEventListener('click', () => onPick('from'));
  el('pick-b').addEventListener('click', () => onPick('to'));
  el('find-a').addEventListener('click', () => onFind('from', nodes.address.value.trim()));
  el('find-b').addEventListener('click', () => onFind('to', nodes.address.value.trim()));
  el('zone-avoid').addEventListener('click', () => onZoneMode('avoid'));
  el('zone-forbid').addEventListener('click', () => onZoneMode('forbid'));
  el('zones-export').addEventListener('click', onExport);
  el('zones-import').addEventListener('change', (e) => {
    const [file] = e.target.files;
    if (file) onImport(file);
    e.target.value = '';
  });
  nodes.build.addEventListener('click', onBuild);

  return {
    zoneListElement: nodes.zoneList,

    readRequest(from, to) {
      return {
        from,
        to,
        timeOfDay: nodes.timeOfDay.value,
        safetyWeight: Number(nodes.safety.value),
        dangerZones: [],
      };
    },

    zoneRadius() {
      return Math.max(20, Number(nodes.zoneRadius.value) || 150);
    },

    setPointLabel(kind, point) {
      const target = kind === 'from' ? nodes.pointA : nodes.pointB;
      const name = kind === 'from' ? 'А' : 'Б';
      target.textContent = point
        ? `${name}: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
        : `${name}: не задана`;
    },

    setZoneMode(mode) {
      for (const [id, value] of [['zone-avoid', 'avoid'], ['zone-forbid', 'forbid']]) {
        el(id).setAttribute('aria-pressed', String(mode === value));
      }
    },

    setBusy(busy) {
      nodes.build.disabled = busy;
    },

    status(text, isError = false) {
      nodes.status.textContent = text;
      nodes.status.classList.toggle('error', isError);
    },

    showResult({ routes, explanation }) {
      const shortest = routes.find((r) => r.kind === 'shortest');
      const safest = routes.find((r) => r.kind === 'safest');
      nodes.result.hidden = false;
      nodes.result.textContent = '';

      const dl = document.createElement('dl');
      const rows = [
        ['Безопасный', `${fmtDistance(safest.lengthM)} · ${fmtDuration(safest.durationS)}`],
        ['Кратчайший', shortest ? `${fmtDistance(shortest.lengthM)} · ${fmtDuration(shortest.durationS)}` : '—'],
        ['Разница', explanation.deltaM > 0 ? `+${fmtDistance(explanation.deltaM)}` : 'совпадают'],
        ['Риск на метр', safest.riskScore.toFixed(2)],
      ];
      for (const [term, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.append(dt, dd);
      }
      nodes.result.append(dl);

      if (safest.violatesForbidden) {
        const flag = document.createElement('p');
        flag.className = 'flag';
        flag.textContent = 'Обойти запретную зону не удалось — маршрут проходит через неё.';
        nodes.result.append(flag);
      }

      if (explanation.reasons.length) {
        const ul = document.createElement('ul');
        for (const r of explanation.reasons) {
          const li = document.createElement('li');
          li.textContent = `${r.text} (${fmtDistance(r.avoidedM)})`;
          ul.append(li);
        }
        nodes.result.append(ul);
      } else {
        const p = document.createElement('p');
        p.textContent = 'Безопасный маршрут совпал с кратчайшим.';
        nodes.result.append(p);
      }
    },

    hideResult() {
      nodes.result.hidden = true;
    },
  };
}
```

- [ ] **Step 2: Создать `src/main.js`**

```js
import { createMap } from './ui/map.js';
import { createPanel } from './ui/panel.js';
import { createZoneStore, exportZones, importZones } from './ui/danger-zones.js';
import { createLocalProvider } from './route-provider/local.js';
import { geocode } from './geocode.js';
import { DEFAULTS } from './config.js';

const points = { from: null, to: null };
let pickTarget = null;
let zoneMode = null;

const mapApi = createMap('map');

const panel = createPanel({
  onBuild: build,
  onPick: (kind) => {
    pickTarget = kind;
    zoneMode = null;
    panel.setZoneMode(null);
    mapApi.setCursor(true);
    panel.status(`Кликни по карте, чтобы поставить точку ${kind === 'from' ? 'А' : 'Б'}.`);
  },
  onFind: async (kind, query) => {
    if (!query) return panel.status('Введи адрес.', true);
    try {
      panel.status('Ищу адрес…');
      const found = await geocode(query);
      setPoint(kind, found);
      panel.status(found.label);
    } catch (err) {
      panel.status(err.message, true);
    }
  },
  onZoneMode: (mode) => {
    zoneMode = zoneMode === mode ? null : mode;
    pickTarget = null;
    panel.setZoneMode(zoneMode);
    mapApi.setCursor(Boolean(zoneMode));
    panel.status(zoneMode ? 'Кликни по карте — там будет центр зоны.' : '');
  },
  onExport: () => exportZones(zones.all),
  onImport: async (file) => {
    try {
      zones.replaceAll(await importZones(file));
      panel.status('Зоны загружены.');
    } catch (err) {
      panel.status(`Не смогла прочитать файл: ${err.message}`, true);
    }
  },
});

const zones = createZoneStore({
  mapApi,
  listElement: panel.zoneListElement,
  onChange: () => {
    mapApi.clearRoutes();
    panel.hideResult();
  },
});

const provider = createLocalProvider({ onProgress: (text) => panel.status(text) });

function setPoint(kind, point) {
  points[kind] = point;
  mapApi.setPoint(kind, point);
  panel.setPointLabel(kind, point);
  mapApi.clearRoutes();
  panel.hideResult();
}

mapApi.onClick((point) => {
  if (pickTarget) {
    setPoint(pickTarget, point);
    pickTarget = null;
    mapApi.setCursor(false);
    panel.status('');
    return;
  }
  if (zoneMode) {
    zones.add({
      type: 'circle',
      center: point,
      radiusM: panel.zoneRadius(),
      mode: zoneMode,
    });
    panel.status('Зона добавлена.');
  }
});

async function build() {
  if (!points.from || !points.to) {
    return panel.status('Задай обе точки — А и Б.', true);
  }
  const request = { ...panel.readRequest(points.from, points.to), dangerZones: zones.all };
  panel.setBusy(true);
  panel.hideResult();
  try {
    const result = await provider.route(request);
    mapApi.drawRoutes(result.routes);
    panel.showResult(result);
    panel.status('');
  } catch (err) {
    panel.status(err.message, true);
    mapApi.clearRoutes();
  } finally {
    panel.setBusy(false);
  }
}

panel.setPointLabel('from', null);
panel.setPointLabel('to', null);
panel.setZoneMode(null);
document.getElementById('safety').value = String(DEFAULTS.safetyWeight);
document.getElementById('safety-out').textContent = String(DEFAULTS.safetyWeight);
document.getElementById('time-of-day').value = DEFAULTS.timeOfDay;
document.getElementById('zone-radius').value = String(DEFAULTS.zoneRadiusM);
```

- [ ] **Step 3: Проверить тесты и запустить сайт**

```bash
npm test
npm run serve
```

Expected: тесты PASS (52), сервер слушает `http://localhost:8000`

- [ ] **Step 4: Коммит**

```bash
git add src/ui/panel.js src/main.js
git commit -m "feat: панель управления и склейка интерфейса"
```

---

## Task 12: Приёмка по критериям готовности

**Files:** правки по итогам проверки — в уже созданных файлах.

- [ ] **Step 1: Запустить сайт**

```bash
npm run serve
```

Открыть `http://localhost:8000`. Открывать файл напрямую через `file://` нельзя — ES-модули и запросы к Overpass заблокирует браузер.

- [ ] **Step 2: Пройти критерии из спеки**

Критерии автоматизированы в `scripts/acceptance.mjs` (`npm run acceptance`):
Playwright перехватывает Overpass и отдаёт сгенерированную под bbox сетку улиц
с диагональными тропами через парк, поэтому проверки не зависят от доступности
внешнего API. Отдельно гоняется контраст-чекер дизайн-системы.

Ручной проход для контроля глазами:

1. Поставить А и Б в пределах района (1–2 км) — появляются два маршрута на карте.
2. Передвинуть ползунок на 0 и на 1, построить заново — геометрия безопасного маршрута меняется.
3. Переключить «день → ночь» в районе с парком или неосвещёнными улицами — маршрут меняется.
4. Нарисовать зону «не ходить» прямо на безопасном маршруте, построить заново — маршрут идёт в обход.
5. Карточка результата называет конкретную причину обхода и дельту длины.
6. Выгрузить зоны в файл, перезагрузить страницу, загрузить файл — зоны вернулись.
7. Поставить точку в поле далеко от дорог — сообщение «Не нашла дорогу рядом с точкой».
8. Поставить А в одном городе, Б в другом — сообщение «Участок слишком большой».
9. Оговорка про эвристику видна внизу панели.

- [ ] **Step 3: Проверить тесты и зафиксировать итог**

Run: `npm test`
Expected: PASS, 52 tests

- [ ] **Step 4: Коммит**

```bash
git add -A
git commit -m "chore: приемка этапа A"
```

---

## Что остаётся на этап C

Не делать сейчас, но и не мешать потом:

- `src/route-provider/remote.js` с тем же контрактом и `POST /api/route`
- перенос `config.js` → серверный конфиг весов
- граф города целиком вместо bbox вокруг точек
- общая база зон опасности вместо localStorage
- внешние источники риска (открытые данные о происшествиях, статистика)
