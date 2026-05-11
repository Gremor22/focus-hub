import { describe, expect, it } from 'vitest';
import { loadAppStateApi } from './app-state-harness.mjs';

const api = loadAppStateApi();

function baseState() {
  const state = api.defaultState();
  state.settings.deviceId = 'local-device';
  state.settings.lastModifiedAt = '2026-05-10T10:00:00.000Z';
  return state;
}

describe('sync merge', () => {
  it('keeps the newer project version by updatedAt', () => {
    const local = baseState();
    const remote = baseState();
    local.projects = [{
      id: 'p1',
      name: 'Local',
      status: 'active',
      updatedAt: '2026-05-10T10:00:00.000Z',
      updatedByDevice: 'local-device'
    }];
    remote.projects = [{
      id: 'p1',
      name: 'Remote newer',
      status: 'active',
      updatedAt: '2026-05-10T11:00:00.000Z',
      updatedByDevice: 'remote-device'
    }];

    const merged = api.mergeAppState(local, remote);

    expect(merged.projects).toHaveLength(1);
    expect(merged.projects[0].name).toBe('Remote newer');
  });

  it('preserves entities that exist only locally or only remotely', () => {
    const local = baseState();
    const remote = baseState();
    local.daily = [{
      id: 'local-task',
      date: '2026-05-10',
      text: 'Local task',
      updatedAt: '2026-05-10T10:00:00.000Z'
    }];
    remote.daily = [{
      id: 'remote-task',
      date: '2026-05-10',
      text: 'Remote task',
      updatedAt: '2026-05-10T10:05:00.000Z'
    }];

    const merged = api.mergeAppState(local, remote);

    expect(merged.daily.map(task => task.id).sort()).toEqual(['local-task', 'remote-task']);
  });

  it('keeps a newer deleted entity as a tombstone so it does not return', () => {
    const local = baseState();
    const remote = baseState();
    local.daily = [{
      id: 'task-1',
      date: '2026-05-10',
      text: 'Deleted locally',
      updatedAt: '2026-05-10T12:00:00.000Z',
      deletedAt: '2026-05-10T12:00:00.000Z'
    }];
    remote.daily = [{
      id: 'task-1',
      date: '2026-05-10',
      text: 'Old remote copy',
      updatedAt: '2026-05-10T09:00:00.000Z',
      deletedAt: ''
    }];

    const merged = api.mergeAppState(local, remote);

    expect(merged.daily).toHaveLength(1);
    expect(merged.daily[0].deletedAt).toBe('2026-05-10T12:00:00.000Z');
  });

  it('uses the local entity as deterministic tie-breaker', () => {
    const local = baseState();
    const remote = baseState();
    local.rituals = [{
      id: 'ritual-1',
      text: 'Local ritual',
      updatedAt: '2026-05-10T10:00:00.000Z',
      updatedByDevice: 'local-device'
    }];
    remote.rituals = [{
      id: 'ritual-1',
      text: 'Remote ritual',
      updatedAt: '2026-05-10T10:00:00.000Z',
      updatedByDevice: 'remote-device'
    }];

    const merged = api.mergeAppState(local, remote);

    expect(merged.rituals[0].text).toBe('Local ritual');
  });

  it('merges key collections without dropping unrelated state', () => {
    const local = baseState();
    const remote = baseState();
    local.journal = [{
      id: 'journal-local',
      date: '2026-05-10',
      note: 'Local note',
      updatedAt: '2026-05-10T10:00:00.000Z'
    }];
    remote.projects = [{
      id: 'remote-project',
      name: 'Remote project',
      status: 'backlog',
      updatedAt: '2026-05-10T10:00:00.000Z'
    }];
    remote.ritualLog = { '2026-05-10': { 'remote-ritual': true } };
    local.dailyPriority = { '2026-05-10': 'local-task' };

    const merged = api.mergeAppState(local, remote);

    expect(merged.journal.map(entry => entry.id)).toContain('journal-local');
    expect(merged.projects.map(project => project.id)).toContain('remote-project');
    expect(merged.ritualLog['2026-05-10']).toEqual({ 'remote-ritual': true });
    expect(merged.dailyPriority['2026-05-10']).toBe('local-task');
  });
});
