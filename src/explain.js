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

// Ребро опознаём по паре узлов, а не по wayId: длинная улица в OSM — один way,
// и обход её участка иначе не отличить от прохода по ней.
const edgeKey = (e) => `${Math.min(e.from, e.to)}:${Math.max(e.from, e.to)}`;

export function explain(shortest, safest) {
  if (!shortest || !safest) return { deltaM: 0, reasons: [] };

  const kept = new Set(safest.edges.map(edgeKey));
  const avoided = shortest.edges.filter((e) => !kept.has(edgeKey(e)));
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
