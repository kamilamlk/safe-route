const EARTH_R = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;
const M_PER_DEG_LAT = 111320;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

// Ray casting. ring — массив {lat, lon}, замыкать вручную не нужно.
export function pointInPolygon(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lon;
    const yj = ring[j].lat, xj = ring[j].lon;
    const crosses =
      yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function bboxAround(points, padM) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLat = padM / M_PER_DEG_LAT;
  const padLon = padM / (M_PER_DEG_LAT * Math.max(0.01, Math.cos(rad(midLat))));
  return {
    south: Math.min(...lats) - padLat,
    west: Math.min(...lons) - padLon,
    north: Math.max(...lats) + padLat,
    east: Math.max(...lons) + padLon,
  };
}

export function bboxAreaKm2(b) {
  const h = haversine({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.west });
  const w = haversine({ lat: b.south, lon: b.west }, { lat: b.south, lon: b.east });
  return (h / 1000) * (w / 1000);
}
