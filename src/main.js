import { createMap } from './ui/map.js';
import { createPanel } from './ui/panel.js';
import { createZoneStore, exportZones, importZones } from './ui/danger-zones.js';
import { createLocalProvider } from './route-provider/local.js';
import { geocode } from './geocode.js';
import { DEFAULTS } from './config.js';

// Значения по умолчанию ставим до навешивания обработчиков, чтобы перезагрузка
// страницы не оставляла в полях состояние предыдущей сессии.
document.getElementById('safety').value = String(DEFAULTS.safetyWeight);
document.getElementById('safety-out').textContent = String(DEFAULTS.safetyWeight);
document.getElementById('time-of-day').value = DEFAULTS.timeOfDay;
document.getElementById('zone-radius').value = String(DEFAULTS.zoneRadiusM);

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
    if (!query) {
      panel.status('Введи адрес.', true);
      return;
    }
    try {
      panel.status('Ищу адрес…');
      const found = await geocode(query);
      setPoint(kind, found);
      mapApi.map.setView([found.lat, found.lon], 15);
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
    panel.status('Задай обе точки — А и Б.', true);
    return;
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
