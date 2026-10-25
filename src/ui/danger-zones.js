import { ZONES_STORAGE_KEY } from '../config.js';

const LABEL = { avoid: 'обходить', forbid: 'не ходить' };

function isValidZone(z) {
  return (
    z && z.type === 'circle' &&
    Number.isFinite(z?.center?.lat) && Number.isFinite(z?.center?.lon) &&
    Number.isFinite(z.radiusM) && (z.mode === 'avoid' || z.mode === 'forbid')
  );
}

export function loadZones() {
  try {
    const raw = localStorage.getItem(ZONES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidZone) : [];
  } catch {
    return [];
  }
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
    mapApi.drawZones(zones);
    listElement.textContent = '';

    zones.forEach((zone, index) => {
      const li = document.createElement('li');

      const text = document.createElement('span');
      text.textContent = `${LABEL[zone.mode]} · ${zone.radiusM} м · ${zone.center.lat.toFixed(4)}, ${zone.center.lon.toFixed(4)}`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'убрать';
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

  render();

  return {
    get all() { return zones; },

    add(zone) {
      zones.push(zone);
      saveZones(zones);
      render();
      onChange();
    },

    replaceAll(next) {
      zones = next.filter(isValidZone);
      saveZones(zones);
      render();
      onChange();
    },
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
  const parsed = JSON.parse(await file.text());
  if (!Array.isArray(parsed)) throw new Error('Ожидался JSON-массив зон.');
  return parsed;
}
