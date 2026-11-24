/** How many activity-log photos show at once. */
export const PHOTOS_PER_PAGE = 4;

export function photoPageCount(count: number, size = PHOTOS_PER_PAGE): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Math.max(1, Math.ceil(n / size));
}

/** Keep the current page inside the pages that still have photos. */
export function clampPhotoPage(page: number, count: number, size = PHOTOS_PER_PAGE): number {
  const pages = photoPageCount(count, size);
  const n = Number.isFinite(page) ? Math.floor(page) : 0;
  return Math.min(Math.max(0, n), pages - 1);
}

export function photoPageSlice<T>(items: readonly T[], page: number, size = PHOTOS_PER_PAGE): T[] {
  const start = clampPhotoPage(page, items.length, size) * size;
  return items.slice(start, start + size);
}
