# Focus Hub

Focus Hub is a personal planning PWA for daily tasks, upcoming work, projects, journal entries, rituals, backups, Firebase sync, and push reminders.

The app is intentionally lightweight: most product logic runs in the browser, static assets are deployed through Cloudflare, and backend glue for push/reminders lives in a Cloudflare Worker.

## Stack

- Static frontend: `index.html`, `styles.css`, browser ES modules.
- State and storage: localStorage, JSON backup/import, Firestore sync.
- Auth: Firebase Auth.
- Backend: Cloudflare Worker, Durable Object reminder scheduler, Firebase Cloud Messaging HTTP v1.
- PWA: app shell service worker plus a separate Firebase Messaging service worker.
- Quality: ESLint, Prettier, Vitest, Playwright Chromium/WebKit smoke tests.

## Local Development

Install dependencies:

```bash
npm install
```

Build static assets into `dist/`:

```bash
npm run build
```

Run a quick local static preview from the repo root:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`. For normal manual testing without Firebase login, use `Wejdź lokalnie bez synchronizacji`.

For Worker-oriented local development, use Wrangler with local variables/secrets in `.dev.vars`:

```bash
npx wrangler dev
```

## Scripts

- `npm run check` - runs lint, unit tests, and build.
- `npm run build` - copies deployable assets into `dist/` and stamps the service worker cache version.
- `npm run lint` / `npm run lint:fix` - ESLint checks and fixes.
- `npm run format` / `npm run format:check` - Prettier formatting.
- `npm run test` - Vitest unit tests.
- `npm run test:e2e` - all Playwright smoke tests.
- `npm run test:e2e:chromium` - Chromium desktop and mobile smoke tests.
- `npm run test:e2e:webkit` - WebKit desktop and mobile smoke tests.
- `npm run test:e2e:headed` / `npm run test:e2e:ui` - interactive Playwright modes.
- `npm run fcm:service-account` - helper for setting Firebase service account secrets in Wrangler.
- `npm run deploy` - runs `check`, then deploys the Worker/static assets with Wrangler.

## Testing

Vitest covers the data foundations: state migration, storage import/export, sync merge behavior, action initialization, and sync status regressions.

Playwright smoke tests cover:

- auth screen rendering,
- local mode entry,
- core navigation,
- daily task creation,
- daily task trash/restore smoke flow,
- journal saving,
- project modal open/close,
- mobile bottom navigation,
- a small WebKit subset for Safari-like behavior.

Install Playwright browsers before local E2E runs:

```bash
npx playwright install chromium webkit
npm run test:e2e
```

## Deploy

Deployment is expected to happen from `main`.

Recommended flow:

```bash
npm run check
npm run deploy
```

`npm run deploy` already runs `check` before `wrangler deploy`, so a deploy should not skip lint, unit tests, and build.

`scripts/build-assets.mjs` copies the app shell files into `dist/` and replaces the development service worker cache version with a deploy-specific token.

More push/reminder setup notes are in `DEPLOY.md`.

## Environment And Secrets

Do not commit real secrets.

Use `.dev.vars.example` as the safe template for local/Worker variables. Real values belong in ignored local files or Cloudflare Worker secrets.

Important secret/config names:

- `FCM_VAPID_PUBLIC_KEY`
- `FCM_PROJECT_ID`
- `FIREBASE_PROJECT_ID`
- `FCM_SERVICE_ACCOUNT_JSON`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY`
- `ENVIRONMENT`
- `ALLOW_DEBUG_ENDPOINTS`

The Firebase web config and public VAPID key are client-side project configuration. Firebase Admin/service account credentials are secrets and must stay out of git.

## Key Files

- `index.html` - app document, static shell, auth screen, page containers.
- `styles.css` - full visual system and responsive layout.
- `app.js` - app bootstrap, Firebase/auth/sync glue, navigation, notification/PWA setup, and remaining cross-domain logic.
- `projects.js` - project cards, Hub project lists, project modal CRUD, archive/promote/done actions.
- `daily.js` - Dziś, Plan/Nadchodzące task flow, rituals, morning focus, daily close prompts.
- `journal.js` - journal form, journal entries, export preview/download, day-close panel.
- `account.js` - account/settings page, theme settings, feature visibility, and JSON backup import/export UI.
- `state.js` - state store helpers, sync decisions, sync status helpers.
- `render.js` - top-level render controller.
- `actions.js` - delegated DOM action router.
- `storage.js` - local/remote/backup storage adapter.
- `_worker.js` - Cloudflare Worker API, FCM sender, Durable Object scheduler.
- `sw.js` - app shell service worker.
- `firebase-messaging-sw.js` - background push notification service worker.
- `firestore.rules` - Firestore per-user access rules.

## Workflow Notes

1. Work on a branch.
2. Keep product changes scoped.
3. Run `npm run check`.
4. Run relevant E2E smoke tests when touching UI, auth, navigation, storage, sync, or PWA behavior.
5. Commit source, config templates, docs, and lockfiles only.
6. Do not commit `node_modules/`, `dist/`, `.wrangler/`, reports, logs, backups, `.dev.vars`, `.env`, or service account JSON files.
