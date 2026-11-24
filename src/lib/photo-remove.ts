/** How long a saved photo stays recoverable after the trash icon. Same window as dispatch Undo. */
export const PHOTO_UNDO_MS = 5_000;

export type PhotoRemove = { kind: "drop" } | { kind: "undo"; ms: number };

/**
 * A photo still waiting to upload only sits in the pending list.
 * A photo already stored on the log is removed after the undo window.
 */
export function planPhotoRemove(saved: boolean): PhotoRemove {
  return saved ? { kind: "undo", ms: PHOTO_UNDO_MS } : { kind: "drop" };
}
