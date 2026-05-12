import { describe, expect, it } from 'vitest';
import { loadAppStateApi } from './app-state-harness.mjs';

const api = loadAppStateApi();

describe('sync status hotfix', () => {
  it('finishes as synced if the confirming snapshot already cleared pending write', () => {
    const status = api.syncStatusAfterRemoteWrite('', 'remote-hash');

    expect(status).toEqual({ mode: 'ok', text: 'Zsynchronizowano' });
  });

  it('stays syncing while a pending write is still waiting for snapshot confirmation', () => {
    const status = api.syncStatusAfterRemoteWrite('pending-hash', 'previous-remote-hash');

    expect(status).toEqual({ mode: '', text: 'Synchronizowanie...' });
  });

  it('finishes as synced when pending and remote hashes already match', () => {
    const status = api.syncStatusAfterRemoteWrite('same-hash', 'same-hash');

    expect(status).toEqual({ mode: 'ok', text: 'Zsynchronizowano' });
  });
});
