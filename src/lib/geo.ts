/**
 * Place a job on the map without a paid geocoder.
 * Known Lexington streets used by the demo sit on those blocks.
 * Any other address is dropped near the city named in it, or Lexington when
 * the address doesn't name one, with a stable offset so two jobs don't stack.
 */

export type LatLng = { lat: number; lng: number };

/** RCL's home region. The dispatch map opens here. */
export const REGION: LatLng & { label: string } = {
  lat: 38.0406,
  lng: -84.5037,
  label: "Lexington, KY",
};

const KNOWN_STREETS: Record<string, LatLng> = {
  "418 whitaker ln, lexington, ky": { lat: 38.0172, lng: -84.4588 },
  "1510 oak st, lexington, ky": { lat: 38.0514, lng: -84.5086 },
  "820 euclid ave, lexington, ky": { lat: 38.0298, lng: -84.4904 },
};

/** City centroids. Longer keys are matched first so "lexington" doesn't steal a longer name. */
const CITIES: [string, LatLng][] = [
  ["nicholasville, ky", { lat: 37.8806, lng: -84.573 }],
  ["georgetown, ky", { lat: 38.2098, lng: -84.5588 }],
  ["louisville, ky", { lat: 38.2527, lng: -85.7585 }],
  ["lexington, ky", { lat: 38.0406, lng: -84.5037 }],
  ["richmond, ky", { lat: 37.7479, lng: -84.2947 }],
  ["winchester, ky", { lat: 37.9901, lng: -84.1797 }],
  ["frankfort, ky", { lat: 38.2009, lng: -84.8733 }],
  ["cincinnati, oh", { lat: 39.1031, lng: -84.512 }],
  ["paris, ky", { lat: 38.2098, lng: -84.2529 }],
];

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Stable jitter of about a kilometer so jobs in one city don't share a pin. */
function jitter(center: LatLng, seed: string): LatLng {
  const h = hash(seed);
  const lat = center.lat + ((h % 1000) / 1000 - 0.5) * 0.02;
  const lng = center.lng + (((h >>> 10) % 1000) / 1000 - 0.5) * 0.02;
  return { lat: round5(lat), lng: round5(lng) };
}

function cityOf(address: string): LatLng | null {
  for (const [key, point] of CITIES) {
    if (address.includes(key)) return point;
  }
  return null;
}

/**
 * Coordinates for a job address. Always returns a point: a known street, the
 * city written in the address, or the Lexington region.
 */
export function geocodeAddress(address: string): LatLng {
  const normalized = normalizeAddress(address);
  if (!normalized) return jitter(REGION, "job");
  const known = KNOWN_STREETS[normalized];
  if (known) return known;
  for (const [key, point] of Object.entries(KNOWN_STREETS)) {
    const street = key.split(",")[0] ?? "";
    if (street && normalized.includes(street)) return point;
  }
  const city = cityOf(normalized);
  if (city) return jitter(city, normalized);
  return jitter(REGION, normalized);
}
