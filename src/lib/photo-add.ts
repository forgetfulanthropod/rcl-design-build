/**
 * Adding photos to the browser activity log.
 * Each file is prepared and stored on its own: one failure cannot cancel the rest,
 * and the busy flag is cleared after the wait even when the store throws.
 * A full phone store (localStorage or IndexedDB) is "Phone storage full".
 * The person holding the phone owns this log, so a quota error that the browser
 * reports as a permission or security error is never shown to them as a permission error.
 */
import { can } from "./permissions.ts";

export const PHONE_STORAGE_FULL = "Phone storage full";

export type PhotoAddContext = { owner: boolean; role: string | null };

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error)
    return String((error as { name: unknown }).name);
  return "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** localStorage and IndexedDB both throw these when the phone cannot take another photo. */
export function isQuotaError(error: unknown): boolean {
  const name = errorName(error);
  const message = errorText(error);
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    name === "QUOTA_EXCEEDED_ERR" ||
    /quota/i.test(message) ||
    /exceeded the quota/i.test(message)
  );
}

/**
 * Phones often report a full or blocked store as a security or permission failure
 * ("The operation is insecure", NotAllowedError) rather than as a quota error.
 */
export function isStoragePermissionError(error: unknown): boolean {
  const name = errorName(error);
  const message = errorText(error);
  return (
    name === "SecurityError" ||
    name === "NotAllowedError" ||
    /permission/i.test(message) ||
    /not allowed/i.test(message) ||
    /insecure/i.test(message) ||
    /can't do that/i.test(message)
  );
}

/** The log on this phone belongs to whoever is holding it. Anyone else's log follows activity.add. */
export function mayAddLogPhoto(ctx: PhotoAddContext): boolean {
  if (ctx.owner) return true;
  return can(ctx.role ?? "", "activity.add");
}

/** What to show under a photo that did not save. The owner never sees a permission error. */
export function photoAddMessage(error: unknown, ctx: PhotoAddContext): string {
  if (!mayAddLogPhoto(ctx)) return "Your role can't do that (activity.add).";
  if (isQuotaError(error) || (ctx.owner && isStoragePermissionError(error)))
    return PHONE_STORAGE_FULL;
  return errorText(error) || "Couldn't save that photo.";
}

export type FailedPhoto = {
  index: number;
  name: string;
  message: string;
  retry: true;
  remove: true;
};

export type BatchFile<T> = {
  name: string;
  prepare: () => Promise<T>;
};

/**
 * Prepare and store one file at a time. `save` runs only after `prepare` resolves, which is
 * where a full store used to throw with the button still showing "Adding photos…".
 * The returned `busy` is always false: the flag is cleared in `finally`.
 */
export async function runPhotoBatch<T>(opts: {
  files: BatchFile<T>[];
  save: (value: T, file: BatchFile<T>, index: number) => Promise<void> | void;
  owner: boolean;
  role: string | null;
}): Promise<{
  busy: boolean;
  saved: { index: number; name: string; value: T }[];
  failed: FailedPhoto[];
}> {
  let busy = true;
  const saved: { index: number; name: string; value: T }[] = [];
  const failed: FailedPhoto[] = [];
  const ctx = { owner: opts.owner, role: opts.role };
  try {
    for (let index = 0; index < opts.files.length; index += 1) {
      const file = opts.files[index];
      try {
        if (!mayAddLogPhoto(ctx)) throw new Error("Your role can't do that (activity.add).");
        const value = await file.prepare();
        await opts.save(value, file, index);
        saved.push({ index, name: file.name, value });
      } catch (error) {
        failed.push({
          index,
          name: file.name,
          message: photoAddMessage(error, ctx),
          retry: true,
          remove: true,
        });
      }
    }
  } finally {
    busy = false;
  }
  return { busy, saved, failed };
}

/** Ask the browser to keep this site's storage. Missing or refused is fine: adding photos still works. */
export async function requestPersistentStorage(
  storage:
    { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } | null | undefined,
): Promise<boolean> {
  try {
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export type LogEntry = {
  id: string;
  kind: string;
  dataUrl?: string;
  blobId?: string;
};

/**
 * Move photo bytes that are still inline into the blob store so the log record itself stays small.
 * A quota error while parking leaves the log unchanged (the caller surfaces "Phone storage full").
 */
export async function parkPhotoBytes<E extends LogEntry>(
  log: Record<string, E[]>,
  putBlob: (id: string, dataUrl: string) => Promise<void>,
): Promise<Record<string, E[]>> {
  const pending: { id: string; dataUrl: string }[] = [];
  for (const entries of Object.values(log)) {
    for (const entry of entries) {
      if (entry.kind === "photo" && entry.dataUrl && !entry.blobId)
        pending.push({ id: entry.id, dataUrl: entry.dataUrl });
    }
  }
  if (pending.length === 0) return log;
  for (const item of pending) await putBlob(item.id, item.dataUrl);
  const parked = new Set(pending.map((item) => item.id));
  const out: Record<string, E[]> = {};
  for (const [day, entries] of Object.entries(log)) {
    out[day] = entries.map((entry) =>
      parked.has(entry.id) ? { ...entry, blobId: entry.id } : entry,
    );
  }
  return out;
}

/** The copy written to localStorage. Bytes live in the blob store once a photo has a blobId. */
export function logForDisk<E extends LogEntry>(log: Record<string, E[]>): Record<string, E[]> {
  const out: Record<string, E[]> = {};
  for (const [day, entries] of Object.entries(log)) {
    out[day] = entries.map((entry) => (entry.blobId ? { ...entry, dataUrl: undefined } : entry));
  }
  return out;
}

function logHasInlinePhotos<E extends LogEntry>(log: Record<string, E[]>): boolean {
  return Object.values(log).some((entries) =>
    entries.some((entry) => entry.kind === "photo" && entry.dataUrl && !entry.blobId),
  );
}

/** Copy blob ids parked from an older snapshot onto the log as it is now (captions included). */
export function applyParkedIds<E extends LogEntry>(
  latest: Record<string, E[]>,
  parked: Record<string, E[]>,
): Record<string, E[]> {
  const ids = new Set<string>();
  for (const entries of Object.values(parked))
    for (const entry of entries) if (entry.blobId) ids.add(entry.id);
  const out: Record<string, E[]> = {};
  for (const [day, entries] of Object.entries(latest)) {
    out[day] = entries.map((entry) =>
      ids.has(entry.id) && !entry.blobId ? { ...entry, blobId: entry.id } : entry,
    );
  }
  return out;
}

/**
 * Add one photo to the in-memory log and then to disk.
 * IndexedDB is preferred. If it is full or blocked, the compressed image is written inline.
 * Either store throwing quota rejects so this photo fails on its own.
 * `read` is the log after the awaits, so a caption typed while the bytes were writing is kept.
 */
export async function rememberPhoto<E extends LogEntry>(
  log: Record<string, E[]>,
  day: string,
  entry: E,
  io: {
    save: (log: Record<string, E[]>) => void;
    putBlob?: (id: string, dataUrl: string) => Promise<void>;
    deleteBlob?: (id: string) => Promise<void>;
    read?: () => Record<string, E[]>;
  },
): Promise<Record<string, E[]>> {
  const current = () => io.read?.() ?? log;
  let blobId: string | undefined;
  if (entry.dataUrl && io.putBlob) {
    try {
      await io.putBlob(entry.id, entry.dataUrl);
      blobId = entry.id;
    } catch {
      // IndexedDB missing, blocked, or full: keep the compressed image inline and let the log write say so.
      blobId = undefined;
    }
  }
  let base = current();
  if (io.putBlob && logHasInlinePhotos(base)) {
    try {
      const parked = await parkPhotoBytes(base, io.putBlob);
      base = applyParkedIds(current(), parked);
    } catch (error) {
      if (blobId && io.deleteBlob) await io.deleteBlob(entry.id).catch(() => undefined);
      if (isQuotaError(error)) throw error;
      base = current();
    }
  }
  const stored: E = { ...entry, blobId, dataUrl: entry.dataUrl };
  const next: Record<string, E[]> = {
    ...base,
    [day]: [...(base[day] ?? []), stored],
  };
  try {
    io.save(next);
  } catch (error) {
    if (blobId && io.deleteBlob) await io.deleteBlob(entry.id).catch(() => undefined);
    throw error;
  }
  return next;
}
