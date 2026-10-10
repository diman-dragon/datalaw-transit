/** Проекция Web Mercator для слайд-карт (плитки 256 px). */
export const TILE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

export interface LatLon {
  lat: number;
  lon: number;
}

const MAX_LAT = 85.0511287798;

export function worldSize(z: number): number {
  return TILE * Math.pow(2, z);
}

/** Координаты в пикселях «мира» на заданном (дробном) уровне масштаба. */
export function project(lat: number, lon: number, z: number): { x: number; y: number } {
  const s = worldSize(z);
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * (Math.PI / 180);
  return {
    x: ((lon + 180) / 360) * s,
    y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * s,
  };
}

export function unproject(x: number, y: number, z: number): LatLon {
  const s = worldSize(z);
  const n = Math.PI - (2 * Math.PI * y) / s;
  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lon: (x / s) * 360 - 180,
  };
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function boundsOf(points: LatLon[]): Bounds | null {
  if (!points.length) return null;
  const b: Bounds = { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 };
  for (const p of points) {
    if (p.lat < b.minLat) b.minLat = p.lat;
    if (p.lat > b.maxLat) b.maxLat = p.lat;
    if (p.lon < b.minLon) b.minLon = p.lon;
    if (p.lon > b.maxLon) b.maxLon = p.lon;
  }
  return b;
}

/** Центр и масштаб, при которых границы целиком помещаются в окно w×h с отступом pad. */
export function fitView(b: Bounds, w: number, h: number, pad = 40, maxZoom = 17): { center: LatLon; zoom: number } {
  const center = { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
  const a = project(b.maxLat, b.minLon, 0);
  const c = project(b.minLat, b.maxLon, 0);
  const spanX = Math.max(c.x - a.x, 1e-9);
  const spanY = Math.max(c.y - a.y, 1e-9);
  const zx = Math.log2(Math.max(w - 2 * pad, 50) / spanX);
  const zy = Math.log2(Math.max(h - 2 * pad, 50) / spanY);
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.min(zx, zy)));
  return { center, zoom };
}

/** Расстояние по прямой, метры. */
export function haversine(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
