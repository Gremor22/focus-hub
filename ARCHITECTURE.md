# Focus Hub Architecture

This document describes the current repo shape. It is not a target architecture.

## Frontend Structure

- `index.html` contains the static document, auth screen, page containers, modals, mobile navigation, and script/style includes.
- `styles.css` contains the full visual system, responsive layout, mobile safe-area behavior, component styles, and reduced-motion rules.
- `app.js` is still the main application module. It bootstraps Firebase, auth, sync, notification setup, navigation, and remaining cross-domain product logic.
- `state.js` contains the small state-store layer and sync-status helpers.
- `render.js` contains the top-level render controller: safe render wrapper, page render dispatcher, and full render orchestration.
- `actions.js` contains event delegation for `data-action` based UI actions.
- `storage.js` contains the storage adapter for localStorage, Firestore load/save, and JSON backup import/export.
- `projects.js` contains project-domain behavior: Hub project rendering, project cards, project modal CRUD, archive/promote/done flows, and project progress helpers.
- `daily.js` contains daily-task behavior: Dziś rendering/actions, Plan/Nadchodzące task flows, rituals, morning focus, and day-close prompts.
- `journal.js` contains journal behavior: form state, save/edit/delete, day-close panel, and text export/copy/download.
- `account.js` contains account/settings behavior: account page rendering, app mode/project limit toggles, theme presets/custom colors, feature visibility, and JSON backup import/export UI glue.

The project has started domain modularization, but `app.js` still owns important shared glue plus auth, sync, notification, Worker, PWA, and bootstrap internals.

## State Model

The main app state is the global state object managed from `app.js` and passed through helpers in `state.js`.

State updates are intended to flow through the store created by `createStateStore()`:

1. read current state,
2. apply a mutation or replacement,
3. normalize and apply change metadata,
4. save local cache,
5. schedule/push remote sync when appropriate,
6. notify subscribers and optionally render.

Important store helpers:

- `getState()` returns the current state.
- `setState(nextState, metadata)` replaces state through the controlled flow.
- `updateState(mutator, metadata)` mutates a cloned draft and saves through `setState`.
- `subscribe(listener)` registers state listeners.

Some domain modules still use the existing direct state mutation style and then call the central save flow. New changes should prefer the central update flow where practical.

## Schema, Metadata, And Migrations

`app.js` defines `CURRENT_SCHEMA_VERSION` and migration/normalization helpers. Old localStorage, Firestore, and backup states are passed through validation and migration before use.

The current model uses entity metadata for safer sync:

- `updatedAt`
- `updatedByDevice`
- `deletedAt` for soft deletion where merge safety requires it
- `trashPurges` for permanent-delete markers after an item is removed from the trash

Key entity groups covered by migration/merge logic include:

- projects,
- daily tasks,
- journal entries,
- rituals.

`deletedAt` marks removed entities so they move out of normal views and into the trash. The current trash flow covers daily tasks, journal entries, and rituals. Restoring an item clears `deletedAt`; permanent delete removes the item and records a `trashPurges` marker so older copies do not reappear during sync. Projects still use the existing active/backlog/archive lifecycle rather than trash.

## Persistence And Sync

### Local Persistence

`storage.js` wraps localStorage:

- `loadLocal()`
- `saveLocal(state)`

Local state is the app's immediate working copy. It allows local mode and keeps the UI usable even when cloud sync is not active.

### Backup JSON

`storage.js` also owns:

- `exportBackup(state)`
- `importBackup(file)`

Backups contain metadata plus the normalized state payload. Import goes through parse, validation, migration, and only then becomes usable app state.

### Firestore Sync

Authenticated users sync one app-state document at:

```text
users/{uid}/app/state
```

`storage.js` wraps Firestore reads/writes with:

- `loadRemote(userId, handlers)`
- `saveRemote(userId, state, metadata)`

Remote snapshots are merged locally. The app avoids treating remote snapshots as fresh local writes, which prevents Firestore write loops.

### Merge Strategy

The sync merge is pragmatic and per-entity:

- entities are matched by `id`,
- newer `updatedAt` wins,
- local-only and remote-only entities are preserved,
- `deletedAt` prevents deleted entities from coming back,
- `trashPurges` prevents permanently deleted trash items from being restored by older snapshots,
- tie-breaking is deterministic and uses existing metadata/fallback behavior.

This is not a CRDT. It is a minimal, predictable merge layer for the current whole-state Firestore storage model.

## Auth

Focus Hub uses Firebase Auth in the browser.

There are two app entry modes:

- authenticated mode: Firebase user exists, Firestore sync and push registration can be active;
- local mode: user can use the app without cloud sync.

When authenticated, API calls to `/api/*` include a Firebase ID token in the `Authorization: Bearer <token>` header. Auth state controls cloud sync lifecycle and notification registration.

## Backend / Worker

`_worker.js` is the Cloudflare Worker entrypoint. `wrangler.toml` configures it with static assets and a Durable Object binding.

Main responsibilities:

- serve static assets through the Cloudflare assets binding,
- handle `/api/*` routes,
- verify Firebase ID tokens for protected POST endpoints,
- validate request payloads,
- register/unregister push devices,
- send test push notifications,
- sync reminder schedules,
- schedule reminders through the `ReminderScheduler` Durable Object,
- send push notifications through Firebase Cloud Messaging HTTP v1.

Important API groups:

- `/api/push/config`
- `/api/push/register-device`
- `/api/push/unregister-device`
- `/api/push/test`
- `/api/reminders/sync`
- `/api/reminders/debug`
- `/api/reminders/test-journal`

Debug endpoints are gated by development environment flags and should not be exposed casually in production.

## PWA And Service Workers

There are two service workers with separate roles.

### `sw.js`

App shell service worker:

- caches only same-origin static app assets,
- does not cache `/api/*`,
- avoids caching failed responses,
- provides an app shell fallback for navigation,
- clears old caches during activation.

`scripts/build-assets.mjs` replaces the development cache version before deploy.

### `firebase-messaging-sw.js`

Firebase Messaging service worker:

- receives background FCM payloads,
- calls `showNotification(...)`,
- sanitizes notification URLs to same-origin/relative targets,
- updates app badge when supported,
- stores lightweight notification debug info in IndexedDB.

Be careful when changing service worker paths or scopes. PWA cache and FCM delivery depend on predictable registration.

## Testing Architecture

### Vitest

Unit tests live in `tests/*.test.js`. They cover:

- state migrations,
- storage import/export,
- sync merge rules,
- sync loop/status regressions,
- action initialization.

### Playwright

E2E smoke tests live in `tests/e2e/`.

Projects in `playwright.config.js`:

- `desktop-chromium`
- `mobile-chromium`
- `webkit-smoke`
- `mobile-webkit-smoke`

Smoke tests intentionally avoid real Firebase login, push delivery, PWA install flows, and cross-device sync. Those remain manual/integration concerns.

## Build And Deploy

`scripts/build-assets.mjs` creates `dist/` by copying:

- HTML/CSS/JS modules,
- manifest,
- icons,
- service workers.

It also stamps `sw.js` with a cache version from:

- `FOCUS_HUB_CACHE_VERSION`,
- or `CF_PAGES_COMMIT_SHA`,
- or a timestamp fallback.

`wrangler.toml` deploys `_worker.js` with `dist/` as static assets. `/api/*` routes run through the Worker first; other requests are served as app assets with SPA fallback behavior.

Deploy flow:

```bash
npm run check
npm run deploy
```

`npm run deploy` already runs `check`.

## Change Guidance

- Prefer small, scoped changes.
- Keep `index.html`, `styles.css`, `app.js`, and the first-level modules consistent.
- Use `data-action` and delegated handlers instead of inline JS handlers.
- Do not bypass validation/migration when reading localStorage, Firestore, or backups.
- Do not write remote snapshots straight back to Firestore.
- Do not cache API responses in `sw.js`.
- Do not expose debug endpoints in production.
