import { describe, expect, it } from 'vitest';
import { loadAppStateApi } from './app-state-harness.mjs';

const api = loadAppStateApi();

function syncedState() {
  const state = api.defaultState();
  state.settings.deviceId = 'device-local';
  state.settings.lastModifiedAt = '2026-05-12T08:00:00.000Z';
  state.settings.lastModifiedByDevice = 'device-local';
  state.settings.lastLocalSaveAt = '2026-05-12T08:01:00.000Z';
  state.settings.lastCloudSyncAt = '2026-05-12T08:02:00.000Z';
  state.daily.push({
    id: 'task-1',
    date: '2026-05-12',
    text: 'Anki',
    lane: 'quick',
    done: false,
    createdAt: '2026-05-12T07:30:00.000Z',
    updatedAt: '2026-05-12T08:00:00.000Z',
    updatedByDevice: 'device-local'
  });
  return api.normalizeAppState(state);
}

describe('Firestore sync loop hotfix', () => {
  it('does not request remote write-back when applying a remote snapshot', () => {
    const local = syncedState();
    const remote = api.normalizeAppState({
      ...local,
      settings: {
        ...local.settings,
        deviceId: 'device-remote',
        lastModifiedAt: '2026-05-12T08:05:00.000Z',
        lastModifiedByDevice: 'device-remote'
      },
      daily: [
        ...local.daily,
        {
          id: 'task-remote',
          date: '2026-05-12',
          text: 'Remote task',
          lane: 'quick',
          done: false,
          createdAt: '2026-05-12T08:05:00.000Z',
          updatedAt: '2026-05-12T08:05:00.000Z',
          updatedByDevice: 'device-remote'
        }
      ]
    });

    const decision = api.remoteSnapshotDecision(local, remote, { forceApply: true });

    expect(decision.shouldApply).toBe(true);
    expect(decision.shouldWriteRemote).toBe(false);
    expect(decision.state.daily.map(task => task.id)).toContain('task-remote');
  });

  it('does not change edit metadata when a remote snapshot has no real edit', () => {
    const local = syncedState();
    const remote = api.normalizeAppState({ ...local });

    const decision = api.remoteSnapshotDecision(local, remote, { forceApply: true });

    expect(decision.state.settings.lastModifiedAt).toBe(local.settings.lastModifiedAt);
    expect(decision.state.settings.lastModifiedByDevice).toBe(local.settings.lastModifiedByDevice);
    expect(decision.state.daily[0].updatedAt).toBe(local.daily[0].updatedAt);
    expect(decision.state.daily[0].updatedByDevice).toBe(local.daily[0].updatedByDevice);
    expect(decision.shouldWriteRemote).toBe(false);
  });

  it('still marks a real local mutation as needing remote push', () => {
    const local = syncedState();
    const remoteHash = JSON.stringify(api.normalizeAppState(local));
    const changed = api.applyChangeMetadata({
      ...local,
      daily: local.daily.map(task => task.id === 'task-1' ? { ...task, done: true } : task)
    }, {
      entity: 'dailyTask',
      id: 'task-1',
      updatedAt: '2026-05-12T09:00:00.000Z'
    });

    const decision = api.localPushDecision(changed, remoteHash, '');

    expect(decision.shouldPush).toBe(true);
    expect(decision.hash).not.toBe(remoteHash);
  });
});
