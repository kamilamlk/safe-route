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
  // Лимит счёта на стороне Overpass.
  timeoutS: 30,
  // Клиентский таймаут: реальный запрос на район ~1,5 км измеренно занимает
  // около 45 с вместе с очередью, поэтому 30 с обрывали бы живые запросы.
  clientTimeoutS: 90,
  cacheTtlMs: 7 * 24 * 3600 * 1000,
  cachePrefix: 'safe-route:osm:',
};

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export const ZONES_STORAGE_KEY = 'safe-route:zones';
