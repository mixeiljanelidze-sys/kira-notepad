const DB_NAME = 'kira_notepad_db';
const STORE = 'kv';
const VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function readJson(key, fallback) {
  try {
    const db = await openDb();
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (existing !== undefined) return existing;

    // migrate one-time from the old localStorage-based version, if present
    try {
      const legacy = localStorage.getItem('kira_np_' + key);
      if (legacy !== null) {
        const parsed = JSON.parse(legacy);
        await writeJson(key, parsed);
        return parsed;
      }
    } catch (_) {}

    return fallback;
  } catch (e) {
    return fallback;
  }
}

async function writeJson(key, data) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const storageService = { readJson, writeJson };
