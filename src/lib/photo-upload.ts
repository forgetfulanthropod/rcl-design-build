/**
 * Photo upload helpers (pure; unit-tested in photo-upload.test.ts): the size limit, HEIC
 * detection, the JPEG compression ladder, and the EXIF "taken at" time.
 */

/** Largest file we'll try to read on a phone. Bigger files are refused before decoding. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
/** The server's limit for the stored (downscaled) photo; see reports.server MAX_PHOTO_BYTES. */
export const MAX_STORED_BYTES = 3 * 1024 * 1024;
/** Stored photos are at most this many pixels on the long side, then these JPEG qualities in turn. */
export const STORED_MAX_SIDE = 1600;
export const QUALITY_LADDER = [0.82, 0.72, 0.6, 0.5] as const;

export function tooLargeMessage(size: number): string | null {
  if (size <= MAX_UPLOAD_BYTES) return null;
  return `That photo is ${Math.round(size / 1024 / 1024)} MB. Photos up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB can be added.`;
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** HEIC/HEIF (iPhone photos): by type, by extension, or by the "ftyp" brand in the first bytes. */
export function isHeic(file: { type?: string; name?: string }, head?: Uint8Array): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  if (/\.(heic|heif)$/i.test(file.name ?? "")) return true;
  if (head && head.length >= 12) {
    const box = String.fromCharCode(...head.subarray(4, 8));
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (box === "ftyp" && HEIF_BRANDS.has(brand)) return true;
  }
  return false;
}

/** Bytes of a data: URL's payload (base64), without decoding it. */
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Encode with each quality in turn until it fits the stored-size limit (e.g. a very detailed
 * 1600 px photo at 0.82). Returns the first that fits, or null if none does.
 */
export function firstThatFits<T extends { url: string }>(encode: (quality: number) => T, max = MAX_STORED_BYTES): T | null {
  for (const q of QUALITY_LADDER) {
    const out = encode(q);
    if (dataUrlBytes(out.url) <= max) return out;
  }
  return null;
}

// ---------- EXIF ----------

export type ExifTime = { local: string; offset: string | null };

/**
 * DateTimeOriginal (or DateTimeDigitized) from a JPEG's EXIF block, with OffsetTimeOriginal
 * when the camera wrote one. `local` is "YYYY-MM-DDTHH:MM:SS" (camera wall-clock time).
 */
export function exifTakenAt(bytes: Uint8Array): ExifTime | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(i + 4, i + 10)) === "Exif\0\0") {
      return readTiff(bytes.subarray(i + 10, Math.min(bytes.length, i + 2 + len)));
    }
    i += 2 + len;
  }
  return null;
}

function readTiff(t: Uint8Array): ExifTime | null {
  if (t.length < 8) return null;
  const little = t[0] === 0x49 && t[1] === 0x49;
  if (!little && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (o: number) => (o + 2 > t.length ? -1 : little ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) =>
    o + 4 > t.length ? -1 : little ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 0x1000000 : t[o] * 0x1000000 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]);
  const tags = (ifd: number) => {
    const out = new Map<number, number>();
    const n = u16(ifd);
    if (n < 0 || n > 500) return out;
    for (let k = 0; k < n; k += 1) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) break;
      out.set(u16(e), e);
    }
    return out;
  };
  const ascii = (entry: number | undefined) => {
    if (entry == null) return null;
    const count = u32(entry + 4);
    if (count <= 0 || count > 64) return null;
    const at = count <= 4 ? entry + 8 : u32(entry + 8);
    if (at < 0 || at + count > t.length) return null;
    return String.fromCharCode(...t.subarray(at, at + count)).replace(/\0+$/, "").trim();
  };
  const ifd0 = tags(u32(4));
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr == null) return null;
  const sub = tags(u32(exifPtr + 8));
  const raw = ascii(sub.get(0x9003)) ?? ascii(sub.get(0x9004));
  const m = raw ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw) : null;
  if (!m || m[1] === "0000") return null;
  const offsetRaw = ascii(sub.get(0x9011)) ?? ascii(sub.get(0x9012));
  const offset = offsetRaw && /^[+-]\d{2}:\d{2}$/.test(offsetRaw) ? offsetRaw : null;
  return { local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, offset };
}

/** The EXIF time as an ISO instant: with its offset when known, else in the phone's own time zone. */
export function exifIso(time: ExifTime | null): string | null {
  if (!time) return null;
  const d = new Date(time.offset ? `${time.local}${time.offset}` : time.local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A taken-at time worth storing: not before 2000 and not more than a day in the future. */
export function plausibleTakenAt(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t < Date.parse("2000-01-01T00:00:00Z") || t > now + 86_400_000) return null;
  return new Date(t).toISOString();
}
