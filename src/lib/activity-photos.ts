/**
 * Adding a photo to the browser-local activity log.
 * The log belongs to whoever is using this browser, so a role can never block it.
 * A read or a save that fails is one photo's problem: the batch still finishes.
 */

/** Stored JPEG budget for one activity-log photo. About twenty of these fit in localStorage. */
export const ACTIVITY_PHOTO_MAX_BYTES = 120 * 1024;
export const ACTIVITY_PHOTO_MAX_SIDE = 1024;
/** A decode or HEIC conversion that sits longer than this is a failed photo, not a stuck button. */
export const ACTIVITY_PHOTO_READ_MS = 20_000;

const ROLES = ["superadmin", "owner", "admin", "lead", "labor", "sub", "subcontractor", ""] as const;

/** The activity log is on this device. Every role, and a signed-out visitor, may add their own photos. */
export function canAddActivityPhoto(role: string | null | undefined): boolean {
  void role;
  return true;
}

export function knownActivityRoles(): readonly string[] {
  return ROLES;
}

export function activityPhotoMessage(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  if (name === "QuotaExceededError" || /quota|storage is full|exceeded the quota/i.test(message)) {
    return "This browser is full, so that photo wasn't saved. Remove one and try again.";
  }
  if (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /not allowed|permission denied|denied permission|user denied/i.test(message)
  ) {
    return "This phone blocked reading that photo. Choose it again, or remove it.";
  }
  if (/role can't|own report|doc\.send|report\.write/i.test(message)) {
    return "This photo stays on this device with your log.";
  }
  if (/too long/i.test(message)) return "That photo took too long to read. Try again or remove it.";
  if (message) return message;
  return "Couldn't read that photo.";
}

/** Reject when `work` does not settle in time, so one file cannot stall the rest. */
export async function settlePhotoRead<T>(work: Promise<T>, ms = ACTIVITY_PHOTO_READ_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("That photo took too long to read.")), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function tryStore(write: () => void): string | null {
  try {
    write();
    return null;
  } catch (cause) {
    return activityPhotoMessage(cause);
  }
}

/**
 * Read and store photos one at a time. A thrown read or a full store is recorded
 * and the loop continues. The returned promise always settles.
 */
export async function addActivityPhotos<TFile, T>(opts: {
  files: readonly TFile[];
  nameOf: (file: TFile) => string;
  read: (file: TFile) => Promise<T>;
  store: (item: T) => void;
}): Promise<{ saved: T[]; failed: { file: TFile; name: string; message: string }[] }> {
  const saved: T[] = [];
  const failed: { file: TFile; name: string; message: string }[] = [];
  for (const file of opts.files) {
    let item: T;
    try {
      item = await opts.read(file);
    } catch (cause) {
      failed.push({ file, name: opts.nameOf(file), message: activityPhotoMessage(cause) });
      continue;
    }
    const problem = tryStore(() => opts.store(item));
    if (problem) failed.push({ file, name: opts.nameOf(file), message: problem });
    else saved.push(item);
  }
  return { saved, failed };
}
