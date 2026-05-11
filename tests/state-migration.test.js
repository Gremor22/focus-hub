import { describe, expect, it } from 'vitest';
import { loadAppStateApi } from './app-state-harness.mjs';

describe('state migrations and metadata', () => {
  it('migrates legacy state without schemaVersion to the current schema', () => {
    const appState = loadAppStateApi();
    const migrated = appState.validateAndMigrateState(
      {
        settings: { deviceId: 'device-test' },
        projects: [{ id: 'p1', name: 'Projekt', steps: ['Start'], created: '2026-05-01' }],
        daily: [{ id: 't1', date: '2026-05-10', text: 'Anki', createdAt: '2026-05-10T08:00:00.000Z' }],
        journal: [{ id: 'j1', date: '2026-05-10', note: 'Dzień', createdAt: '2026-05-10T20:00:00.000Z' }],
        rituals: [{ id: 'r1', text: 'Duolingo', createdAt: '2026-05-09T08:00:00.000Z' }]
      },
      'test'
    );

    expect(migrated.schemaVersion).toBe(appState.CURRENT_SCHEMA_VERSION);
    expect(migrated.projects[0].updatedAt).toBeTruthy();
    expect(migrated.daily[0].updatedAt).toBe('2026-05-10T08:00:00.000Z');
    expect(migrated.daily[0].deletedAt).toBe('');
    expect(migrated.journal[0].updatedByDevice).toBe('device-test');
    expect(migrated.rituals[0].updatedAt).toBe('2026-05-09T08:00:00.000Z');
    expect(migrated.settings.lastModifiedAt).toBeTruthy();
  });

  it('adds change metadata to the selected entity and settings', () => {
    const appState = loadAppStateApi();
    const state = appState.defaultState();
    state.settings.deviceId = 'device-test';
    state.daily.push({
      id: 'task-1',
      date: '2026-05-11',
      text: 'Anki',
      lane: 'quick',
      done: false,
      createdAt: '2026-05-11T07:00:00.000Z'
    });

    const changed = appState.applyChangeMetadata(state, {
      entity: 'dailyTask',
      id: 'task-1',
      updatedAt: '2026-05-11T09:30:00.000Z',
      reason: 'test'
    });

    expect(changed.settings.lastModifiedAt).toBe('2026-05-11T09:30:00.000Z');
    expect(changed.settings.lastModifiedByDevice).toBe('device-test');
    expect(changed.daily[0].updatedAt).toBe('2026-05-11T09:30:00.000Z');
    expect(changed.daily[0].updatedByDevice).toBe('device-test');
  });
});
