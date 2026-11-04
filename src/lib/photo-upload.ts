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
 * DateTimeOriginal (or DateTimeDigitized) from a JPEG EXIF block or a HEIC/HEIF `Exif` item,
 * with OffsetTimeOriginal when the camera wrote one. `local` is "YYYY-MM-DDTHH:MM:SS".
 * HEIC has to be read here: heic2any drops the tags when it converts to JPEG.
 */
export function exifTakenAt(bytes: Uint8Array): ExifTime | null {
  return jpegExif(bytes) ?? (isHeifBytes(bytes) ? heifExif(bytes) : null);
}

function jpegExif(bytes: Uint8Array): ExifTime | null {
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

function isHeifBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") return false;
  return HEIF_BRANDS.has(String.fromCharCode(...bytes.subarray(8, 12)));
}

function be(bytes: Uint8Array, offset: number, size: number): number {
  if (size < 1 || offset < 0 || offset + size > bytes.length) return -1;
  let value = 0;
  for (let i = 0; i < size; i += 1) value = value * 256 + bytes[offset + i];
  return value;
}

type Box = { type: string; payload: number; end: number };

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let i = start;
  while (i + 8 <= end) {
    let size = be(bytes, i, 4);
    let header = 8;
    if (size === 1) {
      const hi = be(bytes, i + 8, 4);
      const lo = be(bytes, i + 12, 4);
      if (hi < 0 || lo < 0) break;
      size = hi * 0x100000000 + lo;
      header = 16;
    } else if (size === 0) size = end - i;
    if (size < header || i + size > end) break;
    out.push({ type: String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]), payload: i + header, end: i + size });
    i += size;
  }
  return out;
}

/** item id → 4cc, from an `iinf` box (infe v2/v3). */
function itemTypes(bytes: Uint8Array, iinf: Box): Map<number, string> {
  const version = bytes[iinf.payload] ?? 0;
  let at = iinf.payload + 4;
  const count = version === 0 ? be(bytes, at, 2) : be(bytes, at, 4);
  at += version === 0 ? 2 : 4;
  const map = new Map<number, string>();
  if (count < 0 || count > 64) return map;
  for (const child of boxes(bytes, at, iinf.end)) {
    if (child.type !== "infe") continue;
    const v = bytes[child.payload] ?? 0;
    if (v < 2) continue;
    let q = child.payload + 4;
    const id = v === 2 ? be(bytes, q, 2) : be(bytes, q, 4);
    q += v === 2 ? 2 : 4;
    q += 2;
    if (id < 0 || q + 4 > child.end) continue;
    map.set(id, String.fromCharCode(bytes[q], bytes[q + 1], bytes[q + 2], bytes[q + 3]));
  }
  return map;
}

/** item id → absolute file ranges, from an `iloc` box (version 0, 1, or 2). */
function itemExtents(bytes: Uint8Array, iloc: Box): Map<number, { off: number; len: number }[]> {
  const version = bytes[iloc.payload] ?? 0;
  let p = iloc.payload + 4;
  if (p + 2 > iloc.end) return new Map();
  const offsetSize = bytes[p] >> 4;
  const lengthSize = bytes[p] & 0x0f;
  const baseSize = bytes[p + 1] >> 4;
  const indexSize = version === 1 || version === 2 ? bytes[p + 1] & 0x0f : 0;
  p += 2;
  const count = version < 2 ? be(bytes, p, 2) : be(bytes, p, 4);
  p += version < 2 ? 2 : 4;
  const map = new Map<number, { off: number; len: number }[]>();
  if (count < 0 || count > 64 || offsetSize > 4 || lengthSize > 4 || baseSize > 4) return map;
  for (let i = 0; i < count && p < iloc.end; i += 1) {
    const id = version < 2 ? be(bytes, p, 2) : be(bytes, p, 4);
    p += version < 2 ? 2 : 4;
    if (version === 1 || version === 2) p += 2;
    p += 2;
    const base = baseSize ? be(bytes, p, baseSize) : 0;
    p += baseSize;
    const extents = be(bytes, p, 2);
    p += 2;
    const list: { off: number; len: number }[] = [];
    const n = extents < 0 || extents > 8 ? 0 : extents;
    for (let j = 0; j < n; j += 1) {
      p += indexSize;
      const off = offsetSize ? be(bytes, p, offsetSize) : 0;
      p += offsetSize;
      const len = lengthSize ? be(bytes, p, lengthSize) : 0;
      p += lengthSize;
      if (base >= 0 && off >= 0 && len > 0) list.push({ off: base + off, len });
    }
    if (id >= 0 && list.length) map.set(id, list);
  }
  return map;
}

function tiffFromExifPayload(payload: Uint8Array): ExifTime | null {
  if (payload.length < 8) return null;
  const shift = be(payload, 0, 4);
  const starts = shift >= 0 ? [4 + shift, shift, 0] : [0];
  for (const at of starts) {
    if (at < payload.length && (payload[at] === 0x49 || payload[at] === 0x4d)) {
      const hit = readTiff(payload.subarray(at));
      if (hit) return hit;
    }
  }
  for (let i = 0; i + 14 < payload.length && i < 64; i += 1) {
    if (payload[i] === 0x45 && payload[i + 1] === 0x78 && payload[i + 2] === 0x69 && payload[i + 3] === 0x66 && payload[i + 4] === 0 && payload[i + 5] === 0) {
      const hit = readTiff(payload.subarray(i + 6));
      if (hit) return hit;
    }
  }
  return null;
}

function heifExif(bytes: Uint8Array): ExifTime | null {
  let meta: Box | undefined;
  for (const box of boxes(bytes, 0, bytes.length)) {
    if (box.type === "meta") meta = box;
  }
  if (!meta || meta.payload + 4 >= meta.end) return null;
  const children = boxes(bytes, meta.payload + 4, meta.end);
  const iinf = children.find((b) => b.type === "iinf");
  const iloc = children.find((b) => b.type === "iloc");
  if (iinf && iloc) {
    const types = itemTypes(bytes, iinf);
    const extents = itemExtents(bytes, iloc);
    for (const [id, type] of types) {
      if (type !== "Exif") continue;
      for (const range of extents.get(id) ?? []) {
        if (range.off + range.len > bytes.length) continue;
        const hit = tiffFromExifPayload(bytes.subarray(range.off, range.off + range.len));
        if (hit) return hit;
      }
    }
  }
  // Declared somewhere the iloc walk didn't reach: the Exif marker plus a TIFF header.
  const limit = Math.min(bytes.length, 8 * 1024 * 1024);
  for (let i = 0; i + 14 < limit; i += 1) {
    if (bytes[i] !== 0x45 || bytes[i + 1] !== 0x78 || bytes[i + 2] !== 0x69 || bytes[i + 3] !== 0x66 || bytes[i + 4] !== 0 || bytes[i + 5] !== 0) continue;
    const hit = readTiff(bytes.subarray(i + 6, Math.min(bytes.length, i + 6 + 65536)));
    if (hit) return hit;
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

export type PhotoTimeSource = "exif" | "file";

/**
 * The clock to show for a photo. The camera's DateTimeOriginal wins. A file's lastModified
 * is only used when the camera wrote no capture time, and callers must label it as file time.
 */
export function resolvePhotoClock(
  input: { exif: string | null; lastModified: number | null },
  now = Date.now(),
): { at: string; source: PhotoTimeSource } | null {
  const exif = plausibleTakenAt(input.exif, now);
  if (exif) return { at: exif, source: "exif" };
  if (input.lastModified == null || !Number.isFinite(input.lastModified) || input.lastModified <= 0) return null;
  const file = plausibleTakenAt(new Date(input.lastModified).toISOString(), now);
  return file ? { at: file, source: "file" } : null;
}

/** Camera time stays in `takenAt`. A file-modified fallback is `fileTime` and is never called "taken". */
export function splitPhotoClock(takenAt: string | null, source: string | null): { takenAt: string | null; fileTime: string | null } {
  if (!takenAt) return { takenAt: null, fileTime: null };
  if (source === "file") return { takenAt: null, fileTime: takenAt };
  return { takenAt, fileTime: null };
}

/**
 * What a photo upload stores. An unlabeled time is the camera (older clients).
 * File time is stored only when the client marks it as such.
 */
export function storedPhotoClock(input: { takenAt: string; fileTime: string; takenSource: string }): { at: string | null; source: PhotoTimeSource | null } {
  if (input.takenSource === "file") {
    const file = plausibleTakenAt(input.fileTime || input.takenAt);
    return file ? { at: file, source: "file" } : { at: null, source: null };
  }
  const exif = plausibleTakenAt(input.takenAt);
  return exif ? { at: exif, source: "exif" } : { at: null, source: null };
}
