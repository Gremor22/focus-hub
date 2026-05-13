# Security

This project is a personal PWA, but it still handles authenticated user data, push tokens, and backend credentials. Keep security changes conservative and review them carefully.

## Auth And Access Model

Firebase Auth is the identity layer.

Protected `/api/*` POST endpoints require:

```text
Authorization: Bearer <Firebase ID token>
```

The Cloudflare Worker verifies the Firebase ID token server-side, extracts the authenticated `uid`, and compares it with `body.userId`. A request is rejected if the token UID and request user ID do not match.

The backend must never trust `userId` from the request body by itself.

Protected endpoint groups include:

- `/api/push/register-device`
- `/api/push/unregister-device`
- `/api/push/test`
- `/api/reminders/sync`
- `/api/reminders/debug`
- `/api/reminders/test-journal`

## Firestore Access Rules

Firestore user data is scoped by UID in `firestore.rules`:

```text
users/{userId}/{document=**}
```

Reads and writes are allowed only when:

```text
request.auth != null && request.auth.uid == userId
```

Keep `firestore.rules` in sync with any future Firestore data model changes and deploy rules intentionally.

## Secrets Handling

Do not commit real secrets.

Safe templates:

- `.dev.vars.example`

Ignored/local/secret-only values:

- `.dev.vars`
- `.env`
- Firebase service account JSON files
- `FCM_SERVICE_ACCOUNT_JSON`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY`
- any private key, token, or admin credential

Use Cloudflare Worker secrets for production credentials:

```bash
npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
npx wrangler secret put FCM_PROJECT_ID
npx wrangler secret put FCM_VAPID_PUBLIC_KEY
```

The Firebase web config in the client is public project configuration. Firebase Admin/service account credentials are not.

## Worker And API Safety

`_worker.js` should keep these properties:

- verify Firebase ID tokens for protected endpoints,
- validate payload shape, string lengths, booleans, dates, times, and allowed values,
- enforce request-size limits,
- return consistent JSON errors,
- include `requestId` in API responses and logs,
- avoid exposing internal stack traces or raw secrets in public responses.

FCM sending must happen server-side through the Worker/Durable Object path. Do not move Firebase Admin credentials or FCM HTTP v1 sending into client code.

## Debug And Internal Endpoints

Debug endpoints are useful while fixing reminders and push delivery, but they should not be public by default.

Development/debug access is controlled by environment flags such as:

- `ENVIRONMENT=development`
- `ALLOW_DEBUG_ENDPOINTS=true`

Do not add new debug endpoints without explicit gating and clear output limits.

## Notification URL Safety

Notification click targets must stay same-origin or relative.

Both Worker payload generation and `firebase-messaging-sw.js` sanitize notification URLs. Do not allow arbitrary external origins in notification `data.url`.

## Service Worker Safety

`sw.js` should not cache:

- `/api/*`,
- cross-origin requests,
- failed responses,
- dynamic backend responses.

`firebase-messaging-sw.js` is responsible for background push display. Keep its scope and path stable unless the registration flow is updated at the same time.

## Maintenance Checklist

Before deploy or security-sensitive changes:

```bash
npm run check
npm run test:e2e
```

Be especially careful when touching:

- auth lifecycle,
- Firestore sync and merge,
- Worker auth/validation,
- FCM service account handling,
- service workers,
- backup import,
- code that writes user data into HTML.

## Reporting Security Problems

For a private project workflow, report security issues or critical regressions by opening a private GitHub issue, direct maintainer note, or a branch/PR with:

- what is affected,
- steps to reproduce,
- expected vs actual behavior,
- whether credentials, user data, push tokens, or auth boundaries may be involved.

Rotate exposed credentials immediately if a secret is ever committed or shared.
