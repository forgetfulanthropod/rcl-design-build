/**
 * Photo bytes for the activity log. IndexedDB holds the pictures (a much larger quota than
 * localStorage). The log record keeps a blobId and the screen keeps the data URL in memory.
 */
const DB_NAME = "rcl-activity-log";
const STORE = "photos";

function canUseDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open photo storage."));
  });
}

function runTx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Couldn't store that photo."));
    tx.onabort = () => reject(tx.error ?? new Error("Couldn't store that photo."));
  });
}

export async function putPhotoBlob(id: string, dataUrl: string): Promise<void> {
  if (!canUseDb()) throw new Error("Photo storage isn't available on this phone.");
  const db = await openDb();
  try {
    await runTx(db, "readwrite", (store) => {
      store.put(dataUrl, id);
    });
  } finally {
    db.close();
  }
}

export async function getPhotoBlob(id: string): Promise<string | null> {
  if (!canUseDb()) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => reject(req.error ?? new Error("Couldn't read that photo."));
    });
  } finally {
    db.close();
  }
}

export async function deletePhotoBlob(id: string): Promise<void> {
  if (!canUseDb()) return;
  const db = await openDb();
  try {
    await runTx(db, "readwrite", (store) => {
      store.delete(id);
    });
  } catch {
    // The log entry is already gone; an orphaned blob is not shown.
  } finally {
    db.close();
  }
}
