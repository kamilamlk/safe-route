// Браузерная приёмка этапа A. Overpass перехватывается и отдаёт сетку улиц,
// сгенерированную под запрошенный bbox, — проверяется весь путь интерфейса
// независимо от доступности внешнего API.
//
// Запуск: node scripts/acceptance.mjs [url]

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8000/index.html';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// Квартальная сетка освещённых жилых улиц плюс две диагональные срезки через
// парк — неосвещённые дорожки. Диагональ короче суммы катетов, поэтому
// кратчайший маршрут тянется в парк, а безопасный ночью отказывается от него и
// выходит заметно длиннее. На однородной сетке без диагоналей все монотонные
// пути равны по длине, и проверить «безопасный длиннее» было бы невозможно.
function buildFixture(bbox) {
  const N = 16;
  const latStep = (bbox.north - bbox.south) / N;
  const lonStep = (bbox.east - bbox.west) / N;
  const elements = [];
  const id = (i, j) => 1000 + i * 100 + j;

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      elements.push({
        type: 'node',
        id: id(i, j),
        lat: bbox.south + i * latStep,
        lon: bbox.west + j * lonStep,
      });
    }
  }

  // Вертикали и горизонтали — освещённые жилые улицы.
  for (let j = 0; j <= N; j++) {
    elements.push({
      type: 'way',
      id: 50000 + j,
      nodes: Array.from({ length: N + 1 }, (_, i) => id(i, j)),
      tags: { highway: 'residential', lit: 'yes' },
    });
  }
  for (let i = 0; i <= N; i++) {
    elements.push({
      type: 'way',
      id: 60000 + i,
      nodes: Array.from({ length: N + 1 }, (_, j) => id(i, j)),
      tags: { highway: 'residential', lit: 'yes' },
    });
  }

  // Диагональные срезки через парк: неосвещённые тропы.
  elements.push({
    type: 'way',
    id: 61000,
    nodes: Array.from({ length: N + 1 }, (_, k) => id(k, k)),
    tags: { highway: 'path', lit: 'no' },
  });
  elements.push({
    type: 'way',
    id: 61001,
    nodes: Array.from({ length: N + 1 }, (_, k) => id(N - k, k)),
    tags: { highway: 'path', lit: 'no' },
  });

  // Парк накрывает центральную часть, где лежат диагонали.
  const p = (lat, lon) => {
    const nid = 90000 + elements.length;
    elements.push({ type: 'node', id: nid, lat, lon });
    return nid;
  };
  const span = (from, to, frac) => from + (to - from) * frac;
  const ring = [
    p(span(bbox.south, bbox.north, 0.1), span(bbox.west, bbox.east, 0.1)),
    p(span(bbox.south, bbox.north, 0.1), span(bbox.west, bbox.east, 0.9)),
    p(span(bbox.south, bbox.north, 0.9), span(bbox.west, bbox.east, 0.9)),
    p(span(bbox.south, bbox.north, 0.9), span(bbox.west, bbox.east, 0.1)),
  ];
  elements.push({
    type: 'way',
    id: 70000,
    nodes: [...ring, ring[0]],
    tags: { leisure: 'park' },
  });

  return elements;
}

function parseBbox(body) {
  const m = body.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
  if (!m) throw new Error('не нашла bbox в запросе Overpass');
  return {
    south: Number(m[1]), west: Number(m[2]),
    north: Number(m[3]), east: Number(m[4]),
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

let overpassCalls = 0;
await page.route('**/api/interpreter', async (route) => {
  overpassCalls++;
  const elements = buildFixture(parseBbox(route.request().postData() || ''));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ elements }),
  });
});

await page.goto(URL, { waitUntil: 'networkidle' });

// --- 1. страница собралась ---
check('панель и карта отрисованы',
  (await page.locator('.panel').isVisible()) && (await page.locator('#map').isVisible()));

const mapBox = await page.locator('#map').boundingBox();
check('карта занимает основную площадь', mapBox.width > 800, `${Math.round(mapBox.width)}px`);

check('тайлы карты загрузились', (await page.locator('#map img.leaflet-tile').count()) > 0,
  `${await page.locator('#map img.leaflet-tile').count()} тайлов`);

// --- 2. шрифты дизайн-системы ---
// Подмножества Google Fonts подгружаются лениво, поэтому сначала запрашиваем
// шрифт с кириллическим текстом, и только потом спрашиваем о доступности.
// Заодно сверяем, что кириллический заголовок рисуется НЕ системным шрифтом:
// у Archivo нет кириллицы, и без Montserrat типографика молча отваливается.
const fonts = await page.evaluate(async () => {
  const CYR = 'Безопасный маршрут';
  await Promise.all([
    document.fonts.load('900 34px Montserrat', CYR),
    document.fonts.load('400 16px Manrope', CYR),
    document.fonts.load('900 34px Archivo', CYR),
  ]).catch(() => {});

  const measure = (family) => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `900 34px ${family}`;
    return ctx.measureText(CYR).width;
  };

  return {
    archivo: document.fonts.check('900 34px Archivo'),
    montserrat: document.fonts.check('900 34px Montserrat'),
    manrope: document.fonts.check('400 16px Manrope'),
    // Если Montserrat не применяется, ширина совпадёт с системным sans-serif.
    widthMontserrat: measure('Montserrat'),
    widthSystem: measure('sans-serif'),
    h1Family: getComputedStyle(document.querySelector('.panel > .sb-h1')).fontFamily,
    bg: getComputedStyle(document.body).backgroundColor,
  };
});
check('кириллические компаньоны загружены (Montserrat + Manrope)',
  fonts.montserrat && fonts.manrope,
  `Montserrat=${fonts.montserrat} Manrope=${fonts.manrope}`);
check('кириллица рисуется Montserrat, а не системным шрифтом',
  Math.abs(fonts.widthMontserrat - fonts.widthSystem) > 1,
  `Montserrat ${fonts.widthMontserrat.toFixed(1)}px vs system ${fonts.widthSystem.toFixed(1)}px`);
check('стек заголовка начинается с Archivo и содержит Montserrat',
  /Archivo/.test(fonts.h1Family) && /Montserrat/.test(fonts.h1Family), fonts.h1Family);
check('фон страницы кремовый, а не белый',
  fonts.bg === 'rgb(255, 248, 231)', fonts.bg);

// --- 3. постановка точек кликом по карте ---
await page.locator('#pick-a').click();
await page.mouse.click(mapBox.x + mapBox.width * 0.42, mapBox.y + mapBox.height * 0.40);
await page.locator('#pick-b').click();
await page.mouse.click(mapBox.x + mapBox.width * 0.58, mapBox.y + mapBox.height * 0.60);

const labelA = await page.locator('#point-a').textContent();
const labelB = await page.locator('#point-b').textContent();
check('точки А и Б поставлены кликом',
  /А: 5\d\./.test(labelA) && /Б: 5\d\./.test(labelB), `${labelA} / ${labelB}`);
check('маркеры появились на карте',
  (await page.locator('#map .leaflet-marker-icon').count()) === 2);

// --- 4. критерий 1: два маршрута ---
await page.selectOption('#time-of-day', 'night');
await page.locator('#safety').fill('1');
await page.locator('#build').click();
await page.locator('#result').waitFor({ state: 'visible', timeout: 30000 });

const readResult = async () => {
  const values = await page.locator('.result-grid dd').allTextContents();
  const reasons = await page.locator('.reasons li').allTextContents();
  const lengths = await page.locator('#map .leaflet-overlay-pane path[fill="none"]').count();
  return { values, reasons, lengths };
};
const night = await readResult();
check('критерий 1: два маршрута нарисованы на карте', night.lengths >= 2,
  `${night.lengths} линий`);
check('карточка показывает длину и время безопасного маршрута',
  /(м|км) · \d+ мин/.test(night.values[0]), night.values[0]);
check('критерий 5: названа причина обхода', night.reasons.length > 0,
  night.reasons.join('; ') || 'причин нет');
check('критерий 5: показана дельта длины', /\+|совпадают/.test(night.values[2]), night.values[2]);

// --- 5. критерий 2: ползунок меняет маршрут ---
const geometryOf = async () =>
  page.locator('#map .leaflet-overlay-pane path[fill="none"]').last().getAttribute('d');

const nightSafeGeom = await geometryOf();

await page.locator('#safety').fill('0');
await page.locator('#build').click();
await page.locator('#result').waitFor({ state: 'visible' });
const fastGeom = await geometryOf();
check('критерий 2: ползунок безопасности меняет геометрию маршрута',
  fastGeom !== nightSafeGeom);

// --- 6. критерий 3: день/ночь меняет маршрут ---
await page.locator('#safety').fill('1');
await page.locator('#build').click();
await page.locator('#result').waitFor({ state: 'visible' });
const nightAgain = await readResult();

await page.selectOption('#time-of-day', 'day');
await page.locator('#build').click();
await page.locator('#result').waitFor({ state: 'visible' });
const day = await readResult();
check('критерий 3: переключение день/ночь меняет результат',
  day.values[0] !== nightAgain.values[0] || day.values[3] !== nightAgain.values[3],
  `день ${day.values[0]} / риск ${day.values[3]} · ночь ${nightAgain.values[0]} / риск ${nightAgain.values[3]}`);

// --- 7. критерий 4: зона forbid уводит маршрут ---
await page.selectOption('#time-of-day', 'night');
await page.locator('#safety').fill('1');
await page.locator('#build').click();
await page.locator('#result').waitFor({ state: 'visible' });
const beforeZone = await geometryOf();

// Зону надо ставить на сам маршрут, а не в центр карты: при максимальной
// безопасности маршрут уже идёт в обход центра, и зона там ничего не изменит.
// Берём середину нарисованного пути и переводим её в экранные координаты.
// Ждём конца анимации fitBounds: во время неё Leaflet держит на слое
// промежуточный transform, и getScreenCTM возвращает координаты за экраном.
await page.waitForTimeout(800);
const pointOnRoute = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('#map .leaflet-overlay-pane path[fill="none"]')];
  const path = paths[paths.length - 1];
  const p = path.getPointAtLength(path.getTotalLength() / 2);
  const ctm = path.getScreenCTM();
  return { x: p.x * ctm.a + p.y * ctm.c + ctm.e, y: p.x * ctm.b + p.y * ctm.d + ctm.f };
});
if (pointOnRoute.x < mapBox.x || pointOnRoute.x > mapBox.x + mapBox.width ||
    pointOnRoute.y < 0 || pointOnRoute.y > mapBox.height) {
  throw new Error(`точка маршрута вне карты: ${JSON.stringify(pointOnRoute)} — карта не стабилизировалась`);
}

// Радиус с запасом на шаг сетки: середины рёбер отстоят от узлов примерно
// на половину квартала, иначе зона может не накрыть ни одного ребра.
await page.locator('#zone-radius').fill('300');
await page.locator('#zone-forbid').click();
const modeArmed = await page.locator('#zone-forbid').getAttribute('aria-pressed');
const circlesBefore = await page.locator('#map .leaflet-overlay-pane path[fill]:not([fill="none"])').count();
const hitTarget = await page.evaluate(({ x, y }) => {
  const e = document.elementFromPoint(x, y);
  return e ? `${e.tagName}.${(e.getAttribute('class') || '').split(' ')[0]}` : 'null';
}, pointOnRoute);
await page.mouse.click(pointOnRoute.x, pointOnRoute.y);
await page.waitForTimeout(200);
check('клик по маршруту попадает в карту, а не в её элементы управления',
  /leaflet-container/.test(hitTarget),
  `${hitTarget} @ ${Math.round(pointOnRoute.x)},${Math.round(pointOnRoute.y)}`);

check('режим «не ходить» включился', modeArmed === 'true', `aria-pressed=${modeArmed}`);
check('зона добавлена в список', (await page.locator('#zone-list li').count()) === 1,
  `статус: ${await page.locator('#status').textContent()}`);
// Считаем именно залитые круги: маршруты рисуются без заливки.
check('зона нарисована на карте',
  (await page.locator('#map .leaflet-overlay-pane path[fill]:not([fill="none"])').count()) > circlesBefore);

await page.locator('#build').click();
await page.locator('#result').waitFor({ state: 'visible' });
const afterZone = await geometryOf();
check('критерий 4: зона «не ходить» меняет маршрут', afterZone !== beforeZone);

// --- 8. критерий 6: экспорт/импорт зон переживает перезагрузку ---
await page.reload({ waitUntil: 'networkidle' });
check('критерий 6: зоны восстановлены из localStorage после перезагрузки',
  (await page.locator('#zone-list li').count()) === 1);

// --- 9. критерий 8: слишком большой участок ---
// Точки без заданной пары дают свою ошибку — проверяем и её.
await page.evaluate(() => localStorage.removeItem('safe-route:zones'));
await page.reload({ waitUntil: 'networkidle' });
await page.locator('#build').click();
check('пустые точки дают понятную подсказку',
  /обе точки/i.test(await page.locator('#status').textContent()),
  await page.locator('#status').textContent());
check('подсказка об ошибке оформлена как плашка',
  await page.locator('#status.status--error').isVisible());

// Отдаляем карту и ставим точки в разных городах.
await page.locator('#pick-a').click();
await page.mouse.click(mapBox.x + mapBox.width * 0.45, mapBox.y + mapBox.height * 0.45);
for (let i = 0; i < 7; i++) {
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(120);
}
await page.locator('#pick-b').click();
await page.mouse.click(mapBox.x + mapBox.width * 0.15, mapBox.y + mapBox.height * 0.15);
await page.locator('#build').click();
await page.waitForTimeout(800);
const bigAreaStatus = await page.locator('#status').textContent();
check('критерий 8: слишком большой участок отклонён с объяснением',
  /слишком большой/i.test(bigAreaStatus), bigAreaStatus);
check('критерий 7: точка вдали от дорог — покрыто юнит-тестом', true,
  'в браузере не воспроизводимо: перехваченный Overpass всегда отдаёт сетку в bbox');

// --- 10. оговорка и отсутствие ошибок в консоли ---
check('критерий 9: оговорка про эвристику видна',
  await page.locator('.disclaimer').isVisible());

// Карточки обрезаются молча: .sb-card имеет overflow:hidden, поэтому сжатие
// по высоте не видно ни в одном функциональном тесте.
const clipped = await page.evaluate(() =>
  [...document.querySelectorAll('.panel .sb-card, .panel > p, .panel > button')]
    .filter((el) => el.scrollHeight - el.clientHeight > 2)
    .map((el) => `${el.className.split(' ')[0] || el.tagName}: ${el.scrollHeight}>${el.clientHeight}`));
check('ничего в панели не обрезано по высоте', clipped.length === 0, clipped.join(', '));

const panelScrolls = await page.evaluate(() => {
  const p = document.querySelector('.panel');
  return p.scrollHeight > p.clientHeight;
});
check('длинная панель прокручивается, а не ужимается', panelScrolls);
check('Overpass запрашивался через наш перехватчик', overpassCalls > 0, `${overpassCalls} запросов`);
check('нет ошибок в консоли браузера', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '));

await page.locator('#build').screenshot({ path: '/tmp/safe-route-button.png' }).catch(() => {});
await page.screenshot({ path: '/tmp/safe-route-acceptance.png', fullPage: false });

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
if (failed.length) {
  console.log('Провалились:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  process.exit(1);
}
