const el = (id) => document.getElementById(id);

const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${m} м`);
const fmtDuration = (s) => `${Math.max(1, Math.round(s / 60))} мин`;

export function createPanel({ onBuild, onPick, onFind, onZoneMode, onExport, onImport }) {
  const address = el('address');
  const timeOfDay = el('time-of-day');
  const safety = el('safety');
  const safetyOut = el('safety-out');
  const zoneRadiusInput = el('zone-radius');
  const statusNode = el('status');
  const resultCard = el('result');
  const resultBody = el('result-body');
  const buildButton = el('build');
  const pointLabels = { from: el('point-a'), to: el('point-b') };

  safety.addEventListener('input', () => {
    safetyOut.textContent = safety.value;
  });

  el('pick-a').addEventListener('click', () => onPick('from'));
  el('pick-b').addEventListener('click', () => onPick('to'));
  el('find-a').addEventListener('click', () => onFind('from', address.value.trim()));
  el('find-b').addEventListener('click', () => onFind('to', address.value.trim()));
  el('zone-avoid').addEventListener('click', () => onZoneMode('avoid'));
  el('zone-forbid').addEventListener('click', () => onZoneMode('forbid'));
  el('zones-export').addEventListener('click', onExport);
  el('zones-import').addEventListener('change', (e) => {
    const [file] = e.target.files;
    if (file) onImport(file);
    e.target.value = '';
  });
  buildButton.addEventListener('click', onBuild);

  function swatch(kind) {
    const span = document.createElement('span');
    span.className = `swatch swatch--${kind}`;
    return span;
  }

  return {
    zoneListElement: el('zone-list'),

    readRequest(from, to) {
      return {
        from,
        to,
        timeOfDay: timeOfDay.value,
        safetyWeight: Number(safety.value),
        dangerZones: [],
      };
    },

    zoneRadius() {
      return Math.max(20, Number(zoneRadiusInput.value) || 150);
    },

    setPointLabel(kind, point) {
      const name = kind === 'from' ? 'А' : 'Б';
      pointLabels[kind].textContent = point
        ? `${name}: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
        : `${name}: не задана`;
    },

    setZoneMode(mode) {
      el('zone-avoid').setAttribute('aria-pressed', String(mode === 'avoid'));
      el('zone-forbid').setAttribute('aria-pressed', String(mode === 'forbid'));
    },

    setBusy(busy) {
      buildButton.disabled = busy;
    },

    status(text, isError = false) {
      statusNode.textContent = text;
      statusNode.classList.toggle('status--error', isError && Boolean(text));
    },

    showResult({ routes, explanation }) {
      const shortest = routes.find((r) => r.kind === 'shortest');
      const safest = routes.find((r) => r.kind === 'safest');
      resultCard.hidden = false;
      resultBody.textContent = '';

      const grid = document.createElement('dl');
      grid.className = 'result-grid';
      const rows = [
        ['safest', 'Безопасный', `${fmtDistance(safest.lengthM)} · ${fmtDuration(safest.durationS)}`],
        ['shortest', 'Кратчайший', shortest ? `${fmtDistance(shortest.lengthM)} · ${fmtDuration(shortest.durationS)}` : '—'],
        [null, 'Разница', explanation.deltaM > 0 ? `+${fmtDistance(explanation.deltaM)}` : 'совпадают'],
        [null, 'Риск на метр', safest.riskScore.toFixed(2)],
      ];
      for (const [kind, term, value] of rows) {
        const dt = document.createElement('dt');
        if (kind) dt.append(swatch(kind));
        dt.append(document.createTextNode(term));
        const dd = document.createElement('dd');
        dd.textContent = value;
        grid.append(dt, dd);
      }
      resultBody.append(grid);

      if (safest.violatesForbidden) {
        const flag = document.createElement('p');
        flag.className = 'flag';
        flag.textContent = 'Обойти запретную зону не удалось — маршрут проходит через неё.';
        resultBody.append(flag);
      }

      if (explanation.reasons.length) {
        const list = document.createElement('ul');
        list.className = 'reasons';
        for (const reason of explanation.reasons) {
          const li = document.createElement('li');
          li.textContent = `${reason.text} (${fmtDistance(reason.avoidedM)})`;
          list.append(li);
        }
        resultBody.append(list);
      } else {
        const note = document.createElement('p');
        note.className = 'sb-small';
        note.textContent = 'Безопасный маршрут совпал с кратчайшим.';
        resultBody.append(note);
      }
    },

    hideResult() {
      resultCard.hidden = true;
    },
  };
}
