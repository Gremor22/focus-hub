import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadAppStateApi() {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*)<\/script>/)?.[1];
  if (!script) throw new Error('index_module_script_not_found');

  const withoutImports = script.replace(/^import .*$/gm, '');
  const stateOnly = withoutImports.slice(0, withoutImports.indexOf('\nconst GLOBAL_ACTIONS'));
  const prelude = `
    const initializeApp = () => ({});
    const getAuth = () => ({});
    const getFirestore = () => ({});
    const doc = (...parts) => parts.join('/');
    const setDoc = async () => {};
    const onSnapshot = () => () => {};
    const serverTimestamp = () => new Date().toISOString();
    const getMessaging = () => ({});
    const getToken = async () => '';
    const deleteToken = async () => {};
    const isMessagingSupported = async () => false;
    const onMessage = () => () => {};
    const createFocusHubStorage = () => ({});
    const localStore = new Map();
    const localStorage = {
      getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
      setItem: (key, value) => localStore.set(key, String(value)),
      removeItem: (key) => localStore.delete(key)
    };
    const classList = { add() {}, remove() {}, toggle() {} };
    const document = {
      documentElement: { dataset: {}, style: { setProperty() {} } },
      body: { classList },
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      addEventListener() {},
      createElement: () => ({ style: {}, classList, dataset: {}, addEventListener() {}, appendChild() {} })
    };
    const window = {
      location: { href: 'http://localhost/', origin: 'http://localhost' },
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      addEventListener() {},
      scrollTo() {},
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (fn) => setTimeout(fn, 0)
    };
    const navigator = { onLine: true, serviceWorker: null };
    const Notification = { permission: 'default' };
    const indexedDB = {};
    const caches = { open: async () => ({ put() {}, addAll() {} }), keys: async () => [], delete: async () => true, match: async () => null };
  `;

  return new Function(
    `${prelude}
    ${stateOnly}
    return {
      CURRENT_SCHEMA_VERSION,
      defaultState,
      migrateState,
      validateAndMigrateState,
      normalizeAppState,
      applyChangeMetadata,
      metadataTimestamp
    };`
  )();
}
