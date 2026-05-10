export function createFocusHubStorage({
  appStorageKey,
  localStorage,
  validateAndMigrateState,
  normalizeForStorage,
  syncDocRef,
  setDoc,
  onSnapshot,
  serverTimestamp
}) {
  function loadLocal() {
    const cached = localStorage.getItem(appStorageKey);
    if (!cached) return { state: validateAndMigrateState(null, 'local-empty'), migrated: false, error: null };
    try {
      return { state: validateAndMigrateState(JSON.parse(cached), 'localStorage'), migrated: true, error: null };
    } catch (error) {
      return { state: validateAndMigrateState(null, 'local-fallback'), migrated: false, error };
    }
  }

  function saveLocal(state) {
    const cleanState = normalizeForStorage(state);
    localStorage.setItem(appStorageKey, JSON.stringify(cleanState));
    return cleanState;
  }

  function loadRemote(userId, handlers = {}) {
    const ref = syncDocRef(userId);
    return onSnapshot(ref, (snap) => {
      const payload = snap.data() || {};
      if (!payload.state) {
        handlers.onEmpty?.(payload);
        return;
      }
      try {
        handlers.onState?.(validateAndMigrateState(payload.state, 'firestore'), payload);
      } catch (error) {
        handlers.onError?.(error);
      }
    }, (error) => handlers.onError?.(error));
  }

  async function saveRemote(userId, state, metadata = {}) {
    const cleanState = normalizeForStorage(state);
    await setDoc(syncDocRef(userId), {
      state: cleanState,
      updatedAt: serverTimestamp(),
      revision: Date.now(),
      ...metadata
    }, { merge: true });
    return cleanState;
  }

  function exportBackup(state) {
    const exportedAt = new Date().toISOString();
    const cleanState = normalizeForStorage(state);
    const payload = {
      meta: {
        app: 'Focus Hub',
        exportedAt,
        schemaVersion: cleanState.schemaVersion
      },
      data: cleanState
    };
    const text = JSON.stringify(payload, null, 2);
    const date = exportedAt.slice(0, 10);
    return {
      payload,
      text,
      blob: new Blob([text], { type: 'application/json;charset=utf-8' }),
      filename: `focus-hub-backup-${date}.json`
    };
  }

  async function importBackup(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rawState = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    return validateAndMigrateState(rawState, 'backup-import');
  }

  return { loadLocal, saveLocal, loadRemote, saveRemote, exportBackup, importBackup };
}
