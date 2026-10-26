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

      onProgress('Загружаю карту района… первый раз это занимает до минуты.');
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
