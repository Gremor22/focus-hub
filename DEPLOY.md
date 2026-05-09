# Focus Hub deploy

Publikacja jako Cloudflare Worker + static assets:

1. `cd /Users/damiangronkowski/Desktop/focus-hub`
2. `npm install`
3. `npx wrangler login`
4. ustaw sekrety Workera:
   - `FCM_VAPID_PUBLIC_KEY`
   - `FCM_SERVICE_ACCOUNT_JSON`
   - `FCM_PROJECT_ID`
5. opcjonalnie wpisz te same wartosci do `.dev.vars`
6. `npm run deploy`

Sekrety ustawisz tak:

1. `npx wrangler secret put FCM_VAPID_PUBLIC_KEY`
2. `npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON`
3. `npx wrangler secret put FCM_PROJECT_ID`

Bezpieczniejsza opcja, bez recznego wklejania JSON-a:

1. pobierz plik JSON service account z Firebase / Google Cloud
2. uruchom:
   - `npm run fcm:service-account -- /sciezka/do/service-account.json`
3. uruchom:
   - `npm run deploy`

Wartosci bierz z Firebase:

1. `FCM_VAPID_PUBLIC_KEY`
   - Firebase Console
   - `Project settings`
   - `Cloud Messaging`
   - `Web configuration`
   - `Web Push certificates`
2. `FCM_SERVICE_ACCOUNT_JSON`
   - Firebase Console / Google Cloud
   - `Project settings`
   - `Service accounts`
   - wygeneruj prywatny klucz JSON dla Firebase Admin SDK
   - wklej caly JSON jako sekret Workera
3. `FCM_PROJECT_ID`
   - identyfikator projektu Firebase

Zamiast `FCM_SERVICE_ACCOUNT_JSON` mozna ustawic rozbite sekrety:

1. `npx wrangler secret put FCM_CLIENT_EMAIL`
2. `npx wrangler secret put FCM_PRIVATE_KEY`

Worker pokazuje brak konfiguracji jako `missing_fcm_service_account` w debug panelu powiadomien.

Po zmianach w `index.html`, `sw.js` albo `_worker.js` wystarczy:

1. `cd /Users/damiangronkowski/Desktop/focus-hub`
2. `npm run deploy`

Jeśli logowanie Firebase nie działa na stronie produkcyjnej, sprawdź w Firebase:

1. `Authentication`
2. `Settings`
3. `Authorized domains`
4. czy jest tam domena Workera / Pages

Powiadomienia web push:

1. otworz appke przez HTTPS
2. na iPhonie dodaj ja do ekranu glownego
3. zaloguj sie
4. wejdź do `Konto -> Powiadomienia`
5. kliknij `Włącz powiadomienia`
6. kliknij `Odśwież rejestrację`, jeśli token wymaga ponownej rejestracji
7. kliknij `Wyślij test`

W tej wersji:

1. token FCM jest rejestrowany per użytkownik i urządzenie,
2. token i status urządzenia zapisują się w Firestore,
3. Cloudflare Worker planuje przypomnienia per użytkownik,
4. Durable Object wysyła powiadomienia przez FCM HTTP v1,
5. service worker obsługuje wiadomości w tle dla PWA na iPhonie i MacBooku.
