/** Great-circle geometry. Flight times come from real distances, which is why
 *  Moscow→Washington lands near the ~26 minutes the scenario literature cites. */

export interface LatLon {
  lat: number;
  lon: number;
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la = toRad(a.lat);
  const lb = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point at fraction `f` along the great circle from a to b. */
export function interpolate(a: LatLon, b: LatLon, f: number): LatLon {
  const d = distanceKm(a, b) / R_KM;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const sd = Math.sin(d);
  const A = Math.sin((1 - f) * d) / sd;
  const B = Math.sin(f * d) / sd;
  const la = toRad(a.lat);
  const lo = toRad(a.lon);
  const lb = toRad(b.lat);
  const lo2 = toRad(b.lon);
  const x = A * Math.cos(la) * Math.cos(lo) + B * Math.cos(lb) * Math.cos(lo2);
  const y = A * Math.cos(la) * Math.sin(lo) + B * Math.cos(lb) * Math.sin(lo2);
  const z = A * Math.sin(la) + B * Math.sin(lb);
  return {
    lat: (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

/** Shortest distance from `p` to the great-circle path a→b (cross-track distance). */
export function distanceToPathKm(p: LatLon, a: LatLon, b: LatLon): number {
  const d13 = distanceKm(a, p) / R_KM;
  const b13 = bearing(a, p);
  const b12 = bearing(a, b);
  const xt = Math.asin(Math.sin(d13) * Math.sin(toRad(b13 - b12)));
  const alongTrack = Math.acos(Math.cos(d13) / Math.cos(xt));
  const d12 = distanceKm(a, b) / R_KM;
  // Past either endpoint the nearest point on the segment is that endpoint.
  if (alongTrack > d12) return distanceKm(p, b);
  if (Math.cos(b13 - b12) < 0) return distanceKm(p, a);
  return Math.abs(xt) * R_KM;
}

function bearing(a: LatLon, b: LatLon): number {
  const la = toRad(a.lat);
  const lb = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export const SPEED_KM_PER_TICK = { ICBM: 350, SLBM: 300 } as const;

/** One tick is one minute of scenario time. Minimum two ticks: nothing is instant. */
export function flightTicks(from: LatLon, to: LatLon, kind: 'ICBM' | 'SLBM'): number {
  return Math.max(2, Math.round(distanceKm(from, to) / SPEED_KM_PER_TICK[kind]));
}
