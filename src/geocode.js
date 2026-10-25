import { NOMINATIM } from './config.js';

let lastCallAt = 0;

// Nominatim требует не больше одного запроса в секунду.
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
