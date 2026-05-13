# Focus Hub

Focus Hub is a lightweight personal planning PWA for daily tasks, upcoming work, journal entries, projects, Firebase sync, and system notifications.

## Project Structure

- `index.html` - main app UI and client-side logic.
- `_worker.js` - Cloudflare Worker API, push backend, Durable Object scheduler.
- `firebase-messaging-sw.js` - Firebase Messaging service worker for background notifications.
- `sw.js` - app shell service worker and offline cache.
- `manifest.webmanifest` - PWA metadata.
- `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` - app icons.
- `scripts/build-assets.mjs` - copies static assets to `dist/`.
- `scripts/set-fcm-service-account.mjs` - helper for setting Firebase service account secrets in Wrangler.
- `DEPLOY.md` - deployment and push notification setup notes.

## Local Setup

```bash
npm install
npm run build
```

The build output is written to `dist/` and is intentionally ignored by git.

## E2E Smoke Tests

Playwright smoke tests cover the auth screen, local mode, core navigation, daily task creation, journal saving, project modal open/close, mobile bottom navigation, and a small WebKit smoke subset for Safari-like behavior.

```bash
npx playwright install chromium webkit
npm run test:e2e
npm run test:e2e:chromium
npm run test:e2e:webkit
npm run test:e2e:headed
npm run test:e2e:ui
```

The Playwright config starts a local static server automatically with `python3 -m http.server 4173`.

For Cloudflare Worker development and deploys:

```bash
npx wrangler login
npm run deploy
```

## Secrets

Do not commit real secrets. Keep these in Cloudflare Worker secrets or local ignored files:

- `FCM_SERVICE_ACCOUNT_JSON`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY`
- real `.dev.vars`
- real `.env` files
- Firebase service account JSON files

Use `.dev.vars.example` only as a safe template.

The Firebase web config and Web Push public VAPID key in the client are public project configuration, not admin credentials. Server-side Firebase Admin credentials must stay outside git.

## Workflow

1. Edit source files in the project root.
2. Run `npm run build`.
3. Test locally or deploy with `npm run deploy`.
4. Commit only source, config templates, docs, and package lockfiles.
5. Do not commit `node_modules/`, `dist/`, `.wrangler/`, logs, backups, or real secret files.
