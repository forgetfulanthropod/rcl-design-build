/**
 * Browser side of adding a photo: refuse oversized files, read the EXIF taken-at time, decode
 * (converting iPhone HEIC to JPEG where the browser can't show it), then downscale and compress
 * to a JPEG the server stores and the PDF embeds. HEIC conversion (heic2any, ~1 MB) only loads
 * when a HEIC file actually needs it; Safari decodes HEIC itself.
 */
import {
  STORED_MAX_SIDE,
  exifIso,
  exifTakenAt,
  firstThatFits,
  isHeic,
  resolvePhotoClock,
  tooLargeMessage,
  type PhotoTimeSource,
} from "@/lib/photo-upload";

export type Prepared = {
  image: string;
  thumb: string;
  width: number;
  height: number;
  /** Camera DateTimeOriginal, when the file has one. */
  takenAt: string | null;
  /** File lastModified, only when there is no camera time. Marked as such in the UI. */
  fileTime: string | null;
  takenSource: PhotoTimeSource | null;
  converted: boolean;
};

async function decode(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function encode(img: HTMLImageElement, max: number, quality: number) {
  const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  const url = canvas.toDataURL("image/jpeg", quality);
  canvas.width = 0; // free the bitmap early on phones
  return { url, w, h };
}

export async function preparePhoto(file: File): Promise<Prepared> {
  const big = tooLargeMessage(file.size);
  if (big) throw new Error(big);
  // The whole file: a HEIC Exif item can sit past the first boxes, and heic2any strips it.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = bytes.subarray(0, Math.min(bytes.length, 256 * 1024));
  const clock = resolvePhotoClock({ exif: exifIso(exifTakenAt(bytes)), lastModified: file.lastModified });
  let img: HTMLImageElement;
  let converted = false;
  try {
    img = await decode(new Blob([bytes], { type: file.type }));
  } catch {
    if (!isHeic(file, head)) throw new Error("That file isn't a photo this phone can read.");
    try {
      const { default: heic2any } = await import("heic2any");
      const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      img = await decode(Array.isArray(out) ? out[0] : out);
      converted = true;
    } catch {
      throw new Error("Couldn't convert that iPhone (HEIC) photo. Try sharing it as a JPEG.");
    }
  }
  const full = firstThatFits((q) => encode(img, STORED_MAX_SIDE, q)) ?? firstThatFits((q) => encode(img, 1024, q));
  if (!full) throw new Error("That photo is too detailed to upload. Try a smaller one.");
  const thumb = encode(img, 320, 0.7);
  return {
    image: full.url,
    thumb: thumb.url,
    width: full.w,
    height: full.h,
    takenAt: clock?.source === "exif" ? clock.at : null,
    fileTime: clock?.source === "file" ? clock.at : null,
    takenSource: clock?.source ?? null,
    converted,
  };
}
