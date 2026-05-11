import { describe, expect, it, vi } from 'vitest';
import { createFocusHubStorage } from '../storage.js';

function createMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    raw: store
  };
}

function createStorage(overrides = {}) {
  const localStorage = createMemoryLocalStorage();
  const validateAndMigrateState = vi.fn((state) => ({
    schemaVersion: 3,
    settings: {},
    projects: [],
    daily: [],
    journal: [],
    rituals: [],
    ...(state || {})
  }));
  const normalizeForStorage = vi.fn((state) => ({ ...state, normalized: true }));
  const setDoc = vi.fn(async () => {});
  return {
    localStorage,
    validateAndMigrateState,
    normalizeForStorage,
    setDoc,
    storage: createFocusHubStorage({
      appStorageKey: 'focus-hub-test',
      localStorage,
      validateAndMigrateState,
      normalizeForStorage,
      syncDocRef: (userId) => `users/${userId}/sync/state`,
      setDoc,
      onSnapshot: vi.fn(),
      serverTimestamp: () => 'server-now',
      ...overrides
    })
  };
}

describe('storage layer', () => {
  it('saves and loads local state through validation and normalization', () => {
    const { storage, localStorage, validateAndMigrateState, normalizeForStorage } = createStorage();

    const saved = storage.saveLocal({ schemaVersion: 3, daily: [{ id: 't1' }] });
    expect(saved.normalized).toBe(true);
    expect(normalizeForStorage).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('focus-hub-test')).normalized).toBe(true);

    const loaded = storage.loadLocal();
    expect(loaded.error).toBeNull();
    expect(validateAndMigrateState).toHaveBeenCalled();
    expect(loaded.state.normalized).toBe(true);
  });

  it('exports backup with metadata and normalized data', async () => {
    const { storage } = createStorage();

    const backup = storage.exportBackup({ schemaVersion: 3, settings: { lastBackupAt: 'x' } });
    const text = await backup.blob.text();
    const parsed = JSON.parse(text);

    expect(backup.filename).toMatch(/^focus-hub-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(parsed.meta.app).toBe('Focus Hub');
    expect(parsed.meta.schemaVersion).toBe(3);
    expect(parsed.data.normalized).toBe(true);
  });

  it('imports wrapped backup data through validation', async () => {
    const { storage, validateAndMigrateState } = createStorage();
    const file = {
      text: async () => JSON.stringify({ meta: { app: 'Focus Hub' }, data: { schemaVersion: 2, daily: [] } })
    };

    const imported = await storage.importBackup(file);

    expect(validateAndMigrateState).toHaveBeenCalledWith({ schemaVersion: 2, daily: [] }, 'backup-import');
    expect(imported.schemaVersion).toBe(2);
  });

  it('rejects malformed backup JSON instead of returning partial state', async () => {
    const { storage, validateAndMigrateState } = createStorage();

    await expect(storage.importBackup({ text: async () => '{broken-json' })).rejects.toThrow();
    expect(validateAndMigrateState).not.toHaveBeenCalled();
  });
});
