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
