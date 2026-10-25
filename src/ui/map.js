const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const START_VIEW = [[55.7558, 37.6173], 14];

// Цвета берём из токенов дизайн-системы, а не хардкодом.
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function routeStyles() {
  return {
    shortest: { color: token('--sb-muted'), weight: 4, opacity: 0.8, dashArray: '6 6' },
    safest: { color: token('--sb-accent-4'), weight: 7, opacity: 1 },
  };
}

function zoneColor(mode) {
  return mode === 'forbid' ? token('--sb-danger') : token('--sb-accent-3');
}

export function createMap(elementId) {
  const map = L.map(elementId).setView(...START_VIEW);
  L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const zoneLayer = L.layerGroup().addTo(map);
  const markers = { from: null, to: null };

  function setPoint(kind, point) {
    if (markers[kind]) markerLayer.removeLayer(markers[kind]);
    const label = kind === 'from' ? 'А' : 'Б';
    markers[kind] = L.marker([point.lat, point.lon], { title: label })
      .addTo(markerLayer)
      .bindTooltip(label, { permanent: true, direction: 'top' });
  }

  function drawRoutes(routes) {
    routeLayer.clearLayers();
    const styles = routeStyles();
    // Кратчайший рисуем первым, чтобы безопасный лежал поверх него.
    for (const kind of ['shortest', 'safest']) {
      const route = routes.find((r) => r.kind === kind);
      if (!route) continue;
      L.polyline(route.geometry, styles[kind]).addTo(routeLayer);
    }
    const main = routes.find((r) => r.kind === 'safest') || routes[0];
    if (main) map.fitBounds(L.polyline(main.geometry).getBounds(), { padding: [40, 40] });
  }

  function clearRoutes() {
    routeLayer.clearLayers();
  }

  function drawZones(zones) {
    zoneLayer.clearLayers();
    for (const zone of zones) {
      L.circle([zone.center.lat, zone.center.lon], {
        radius: zone.radiusM,
        color: token('--sb-border'),
        weight: 2,
        fillColor: zoneColor(zone.mode),
        fillOpacity: 0.35,
      }).addTo(zoneLayer);
    }
  }

  function onClick(handler) {
    map.on('click', (e) => handler({ lat: e.latlng.lat, lon: e.latlng.lng }));
  }

  function setCursor(active) {
    map.getContainer().style.cursor = active ? 'crosshair' : '';
  }

  return { map, setPoint, drawRoutes, clearRoutes, drawZones, onClick, setCursor };
}
