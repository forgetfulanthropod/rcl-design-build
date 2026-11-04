/**
 * The line at the top of a photo caption, on screen and in the activity-log PDF.
 * Camera time is the clock. A file-modified fallback is never presented as the shutter.
 */
import type { PhotoTimeSource } from "./photo-upload.ts";

export function photoCaptionHeading(
  photo: { takenAt?: string | null; fileTime?: string | null; takenSource?: PhotoTimeSource | null },
  clock: (iso: string) => string,
): string {
  const fileMarked = photo.takenSource === "file" || (!photo.takenAt && Boolean(photo.fileTime));
  if (fileMarked) {
    const at = photo.fileTime || photo.takenAt;
    if (at && !Number.isNaN(Date.parse(at))) return `file time ${clock(at)} (not camera)`;
    return "file time (not camera)";
  }
  if (photo.takenAt && !Number.isNaN(Date.parse(photo.takenAt))) return clock(photo.takenAt);
  return "";
}
