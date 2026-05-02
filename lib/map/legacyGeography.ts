import type { GeoPermissibleObjects } from "d3-geo";
import type { Feature } from "geojson";

/**
 * Affine map from legacy DB coordinates (map_x, map_y) to WGS84 lon/lat.
 * Calibrated to Constantinople, Adrianople (Edirne), Thessaloniki.
 */
const CAL = [
  { mx: 660, my: 420, lon: 28.9784, lat: 41.0082 },
  { mx: 580, my: 380, lon: 26.5556, lat: 41.6771 },
  { mx: 460, my: 440, lon: 22.9444, lat: 40.6401 },
] as const;

function invert3x3(m: number[][]): number[][] | null {
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2]) -
    m[0][1] * (m[1][0] * m[2][2] - m[2][0] * m[1][2]) +
    m[0][2] * (m[1][0] * m[2][1] - m[2][0] * m[1][1]);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    [
      (m[1][1] * m[2][2] - m[2][1] * m[1][2]) * invDet,
      (m[0][2] * m[2][1] - m[2][2] * m[0][1]) * invDet,
      (m[0][1] * m[1][2] - m[1][1] * m[0][2]) * invDet,
    ],
    [
      (m[2][0] * m[1][2] - m[1][0] * m[2][2]) * invDet,
      (m[0][0] * m[2][2] - m[2][0] * m[0][2]) * invDet,
      (m[1][0] * m[0][2] - m[0][0] * m[1][2]) * invDet,
    ],
    [
      (m[1][0] * m[2][1] - m[2][0] * m[1][1]) * invDet,
      (m[2][0] * m[0][1] - m[0][0] * m[2][1]) * invDet,
      (m[0][0] * m[1][1] - m[1][0] * m[0][1]) * invDet,
    ],
  ];
}

function mulMatVec(mat: number[][], v: number[]): number[] {
  return mat.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

const M: number[][] = [
  [CAL[0].mx, CAL[0].my, 1],
  [CAL[1].mx, CAL[1].my, 1],
  [CAL[2].mx, CAL[2].my, 1],
];
const inv = invert3x3(M);
if (!inv) throw new Error("legacyGeography: singular calibration matrix");

const ABC = mulMatVec(inv, [CAL[0].lon, CAL[1].lon, CAL[2].lon]);
const DEF = mulMatVec(inv, [CAL[0].lat, CAL[1].lat, CAL[2].lat]);

export function legacyToLonLat(map_x: number, map_y: number): [number, number] {
  const lon = ABC[0]! * map_x + ABC[1]! * map_y + ABC[2]!;
  const lat = DEF[0]! * map_x + DEF[1]! * map_y + DEF[2]!;
  return [lon, lat];
}

/**
 * Inverse of {@link legacyToLonLat}: WGS84 → legacy parchment (map_x, map_y).
 * Uses the same affine coefficients as the forward transform.
 */
export function lonLatToLegacy(lon: number, lat: number): [number, number] {
  const a11 = ABC[0]!;
  const a12 = ABC[1]!;
  const a21 = DEF[0]!;
  const a22 = DEF[1]!;
  const b1 = lon - ABC[2]!;
  const b2 = lat - DEF[2]!;
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-14) {
    throw new Error("lonLatToLegacy: singular calibration");
  }
  const mx = (b1 * a22 - b2 * a12) / det;
  const my = (a11 * b2 - a21 * b1) / det;
  return [mx, my];
}

/** FeatureCollection of node positions in WGS84 — used only to fit the map projection. */
export function mergedFitObject(
  nodeLonLat: [number, number][],
): GeoPermissibleObjects {
  const pointFeatures: Feature[] = nodeLonLat.map(([lon, lat], i) => ({
    type: "Feature",
    id: `node-${i}`,
    properties: {},
    geometry: { type: "Point", coordinates: [lon, lat] },
  }));
  return {
    type: "FeatureCollection",
    features: pointFeatures,
  };
}
