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
