// Persist the connected repo's directory handles across page reloads.
//
// A FileSystemDirectoryHandle cannot be stored in localStorage (not JSON-
// serializable), but IndexedDB can structured-clone it. We keep the arbiter/
// handle and the repo-root handle so a reload can re-establish the connection
// without re-picking the folder (subject to a permission re-grant).

const DB_NAME = 'arbiter-dashboard';
const STORE = 'handles';
const KEY = 'repo';
const DB_VERSION = 1;

export interface SavedRepoHandles {
  arbiter: FileSystemDirectoryHandle;
  root?: FileSystemDirectoryHandle;
}

// queryPermission / requestPermission aren't in the standard DOM lib types.
type PermissionState = 'granted' | 'denied' | 'prompt';
interface HandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRepoHandles(arbiter: FileSystemDirectoryHandle, root?: FileSystemDirectoryHandle): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ arbiter, root } satisfies SavedRepoHandles, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Persistence is best-effort — a failure here just means a reconnect on reload.
  }
}

export async function loadRepoHandles(): Promise<SavedRepoHandles | null> {
  if (!idbAvailable()) return null;
  try {
    const db = await openDb();
    const result = await new Promise<SavedRepoHandles | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as SavedRepoHandles | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
}

export async function clearRepoHandles(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* best-effort */ }
}

/** Current readwrite permission for a handle without prompting. */
export async function queryHandlePermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const h = handle as HandleWithPermission;
  if (!h.queryPermission) return 'granted'; // older browsers: assume usable
  try {
    return await h.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

/** Prompt (requires a user gesture) to (re)grant readwrite on a handle. */
export async function requestHandlePermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const h = handle as HandleWithPermission;
  if (!h.requestPermission) return 'granted';
  try {
    return await h.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}
