import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, getIdToken } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getMessaging, getToken, deleteToken, isSupported as isMessagingSupported, onMessage } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-messaging.js";
import { bindActionDelegation as bindDelegatedActions } from "./actions.js";
import { createRenderController } from "./render.js";
import { createStateStore, localPushDecision as createLocalPushDecision, remoteSnapshotDecision as createRemoteSnapshotDecision, syncStatusAfterRemoteWrite, syncStatusView } from "./state.js";
import { createFocusHubStorage } from "./storage.js";
import { createDailyDomain } from "./daily.js";
import { createJournalDomain } from "./journal.js";
import { createProjectsDomain, projectProgress } from "./projects.js";

// ════════════════════════════════════════
// CONFIG / CONSTANTS
// ════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyCXN4q5M6oUkZXTlXL3WHExWv1jcP83kFc",
  authDomain: "focus-hub-b8bfc.firebaseapp.com",
  projectId: "focus-hub-b8bfc",
  storageBucket: "focus-hub-b8bfc.firebasestorage.app",
  messagingSenderId: "691259568151",
  appId: "1:691259568151:web:bcab4443372d58201cac52",
  measurementId: "G-4157Y6TKXJ",
  fcmVapidKey: "BD56BPL80Z6NXzD6NqcvWqRxQ_xfSTdaOeO-N66F1eYshaV0nUrCYfuCFK7eDEs01MXP-cfv9_QIvy-9AIUROu4"
};
const fbApp = initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);
const fbDb = getFirestore(fbApp);
const APP_STORAGE_KEY = 'focushub_v1';
const CURRENT_SCHEMA_VERSION = 4;
const THEME_PRESETS = {
  lime: { label:'Neon Lime', accent:'#c8f040', blue:'#40a8f0', amber:'#f0b840', red:'#f04840' },
  ocean: { label:'Ocean', accent:'#5cc8ff', blue:'#3f8cff', amber:'#ffb65c', red:'#ff6b7a' },
  orchid: { label:'Orchid', accent:'#c98cff', blue:'#6ca8ff', amber:'#ffbf69', red:'#ff6b9d' }
};
const CAT_COLORS = {
  'Gry':'#c8f040','Nauka':'#40a8f0','Projekt':'#f0b840',
  'Kariera':'#a0f080','Zdrowie':'#f08040','Związek':'#f04880','Inne':'#8080f0'
};
const APP_MODES = {
  minimal: {
    label: 'Minimal',
    defaults: { limit: 3, showMorningFocus: false, showAdvancedStats: false }
  },
  standard: {
    label: 'Standard',
    defaults: { limit: 3, showMorningFocus: true, showAdvancedStats: true }
  },
  extended: {
    label: 'Rozszerzony',
    defaults: { limit: 5, showMorningFocus: true, showAdvancedStats: true }
  }
};
const LEGACY_MODE_MAP = { visionary: 'standard', executor: 'minimal', balancer: 'standard' };
const PAGE_TITLES = { hub:'Hub', daily:'Dziś', upcoming:'Nadchodzące', active:'Aktywne', backlog:'Pomysły', archive:'Archiwum', pride:'Ściana dumy', journal:'Dziennik', stats:'Postęp', review:'Review', account:'Konto' };

// ════════════════════════════════════════
// DEFAULT STATE / HYDRATION
// ════════════════════════════════════════
function defaultState() {
  const modeDefaults = APP_MODES.standard.defaults;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: {
      name:'',
      limit: modeDefaults.limit,
      lastBackupAt:'',
      lastLocalSaveAt:'',
      lastCloudSyncAt:'',
      backupReminderDays: 3,
      autoRollDaily: true,
      lastDailyRollDate:'',
      lastDailyRollFrom:'',
      lastDayCloseDismissedDate:'',
      lastDayCloseConfirmedDate:'',
      themeMode:'auto',
      themePreset:'lime',
      themeCustom:{ accent:'#c8f040', blue:'#40a8f0', amber:'#f0b840', red:'#f04840' },
      showAdvancedStats: modeDefaults.showAdvancedStats,
      showMorningFocus: modeDefaults.showMorningFocus,
      notificationsEnabled:false,
      journalReminderEnabled:true,
      journalReminderTime:'21:30',
      journalReminderFollowupEnabled:false,
      journalReminderFollowupTime:'',
      taskReminderEnabled:true,
      eveningReminderEnabled:true,
      eveningReminderTime:'19:00',
      badgeEnabled:true,
      appMode:'standard',
      deviceId: '',
      lastModifiedAt:'',
      lastModifiedByDevice:''
    },
    projects: [],
    pride: [],
    journal: [],
    daily: [],
    rituals: [],
    ritualLog: {},
    morningFocus: {},
    weeklyReview: [],
    dailyPriority: {}
  };
}
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function nowIso() { return new Date().toISOString(); }
function validIsoDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}
function optionalTimestamp(value) {
  return validIsoDateTime(value) || '';
}
function metadataTimestamp(...values) {
  for (const value of values) {
    const iso = validIsoDateTime(value);
    if (iso) return iso;
  }
  return nowIso();
}
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validationIssue(message, source = 'state') {
  const error = new Error(message);
  error.source = source;
  return error;
}
function validateArrayField(state, key, source) {
  if (state[key] == null) return true;
  if (!Array.isArray(state[key])) throw validationIssue(`${source}: ${key} must be an array`, source);
  return true;
}
function validateObjectField(state, key, source) {
  if (state[key] == null) return true;
  if (!isPlainObject(state[key])) throw validationIssue(`${source}: ${key} must be an object`, source);
  return true;
}
function validateProjectShape(project, source) {
  if (!isPlainObject(project)) throw validationIssue(`${source}: invalid project`, source);
  if (project.steps != null && !Array.isArray(project.steps)) throw validationIssue(`${source}: project.steps must be an array`, source);
  if (project.history != null && !Array.isArray(project.history)) throw validationIssue(`${source}: project.history must be an array`, source);
}
function validateDailyTaskShape(task, source) {
  if (!isPlainObject(task)) throw validationIssue(`${source}: invalid daily task`, source);
}
function validateJournalEntryShape(entry, source) {
  if (!isPlainObject(entry)) throw validationIssue(`${source}: invalid journal entry`, source);
  if (entry.closeDay != null && !isPlainObject(entry.closeDay)) throw validationIssue(`${source}: journal.closeDay must be an object`, source);
}
function validateRitualShape(ritual, source) {
  if (!isPlainObject(ritual)) throw validationIssue(`${source}: invalid ritual`, source);
}
function validateStateShape(raw, source = 'state') {
  if (raw == null) return;
  if (!isPlainObject(raw)) throw validationIssue(`${source}: state must be an object`, source);
  validateObjectField(raw, 'settings', source);
  validateObjectField(raw, 'morningFocus', source);
  validateObjectField(raw, 'dailyPriority', source);
  validateObjectField(raw, 'ritualLog', source);
  ['projects','pride','journal','daily','rituals','weeklyReview'].forEach(key => validateArrayField(raw, key, source));
  (raw.projects || []).forEach(item => validateProjectShape(item, source));
  (raw.daily || []).forEach(item => validateDailyTaskShape(item, source));
  (raw.journal || []).forEach(item => validateJournalEntryShape(item, source));
  (raw.rituals || []).forEach(item => validateRitualShape(item, source));
}
function migrateLegacyStateToV1(state) {
  return {
    ...state,
    schemaVersion: 1,
    settings: isPlainObject(state.settings) ? state.settings : {},
    projects: Array.isArray(state.projects) ? state.projects : [],
    pride: Array.isArray(state.pride) ? state.pride : [],
    journal: Array.isArray(state.journal) ? state.journal : [],
    daily: Array.isArray(state.daily) ? state.daily : [],
    morningFocus: isPlainObject(state.morningFocus) ? state.morningFocus : {},
    weeklyReview: Array.isArray(state.weeklyReview) ? state.weeklyReview : [],
    dailyPriority: isPlainObject(state.dailyPriority) ? state.dailyPriority : {}
  };
}
function migrateV1StateToV2(state) {
  return {
    ...state,
    schemaVersion: 2,
    rituals: Array.isArray(state.rituals) ? state.rituals : [],
    ritualLog: isPlainObject(state.ritualLog) ? state.ritualLog : {}
  };
}
function migrateV2StateToV3(state) {
  const deviceId = state.settings?.deviceId || '';
  const stampProject = (project) => ({
    ...project,
    updatedAt: metadataTimestamp(project.updatedAt, project.touched, project.createdAt, project.created),
    updatedByDevice: project.updatedByDevice || deviceId
  });
  const stampEntity = (entity) => ({
    ...entity,
    updatedAt: metadataTimestamp(entity.updatedAt, entity.createdAt, entity.created),
    updatedByDevice: entity.updatedByDevice || deviceId
  });
  return {
    ...state,
    schemaVersion: 3,
    settings: {
      ...(isPlainObject(state.settings) ? state.settings : {}),
      lastModifiedAt: metadataTimestamp(state.settings?.lastModifiedAt, state.settings?.lastCloudSyncAt, state.settings?.lastLocalSaveAt),
      lastModifiedByDevice: state.settings?.lastModifiedByDevice || deviceId
    },
    projects: Array.isArray(state.projects) ? state.projects.map(stampProject) : [],
    daily: Array.isArray(state.daily) ? state.daily.map(stampEntity) : [],
    journal: Array.isArray(state.journal) ? state.journal.map(stampEntity) : [],
    rituals: Array.isArray(state.rituals) ? state.rituals.map(stampEntity) : []
  };
}
function migrateV3StateToV4(state) {
  const keepDeletedAt = (entity) => ({
    ...entity,
    deletedAt: optionalTimestamp(entity?.deletedAt)
  });
  return {
    ...state,
    schemaVersion: 4,
    projects: Array.isArray(state.projects) ? state.projects.map(keepDeletedAt) : [],
    daily: Array.isArray(state.daily) ? state.daily.map(keepDeletedAt) : [],
    journal: Array.isArray(state.journal) ? state.journal.map(keepDeletedAt) : [],
    rituals: Array.isArray(state.rituals) ? state.rituals.map(keepDeletedAt) : []
  };
}
function migrateState(raw) {
  const initial = raw == null ? defaultState() : clone(raw);
  validateStateShape(initial, 'pre-migration');
  let version = Number(initial.schemaVersion || 0);
  if (!Number.isFinite(version) || version < 0) version = 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw validationIssue(`unsupported_schema_version_${version}`, 'migration');
  }
  let next = initial;
  if (version < 1) {
    next = migrateLegacyStateToV1(next);
    version = 1;
  }
  if (version < 2) {
    next = migrateV1StateToV2(next);
    version = 2;
  }
  if (version < 3) {
    next = migrateV2StateToV3(next);
    version = 3;
  }
  if (version < 4) {
    next = migrateV3StateToV4(next);
  }
  validateStateShape(next, 'post-migration');
  return next;
}
function hydrateState(raw) {
  const base = defaultState();
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    ...base,
    ...src,
    settings: { ...base.settings, ...(src.settings || {}), themeCustom: { ...base.settings.themeCustom, ...((src.settings || {}).themeCustom || {}) } },
    projects: Array.isArray(src.projects) ? src.projects : base.projects,
    pride: Array.isArray(src.pride) ? src.pride : base.pride,
    journal: Array.isArray(src.journal) ? src.journal : base.journal,
    daily: Array.isArray(src.daily) ? src.daily : base.daily,
    rituals: Array.isArray(src.rituals) ? src.rituals : base.rituals,
    ritualLog: src.ritualLog && typeof src.ritualLog === 'object' ? src.ritualLog : base.ritualLog,
    morningFocus: src.morningFocus && typeof src.morningFocus === 'object' ? src.morningFocus : base.morningFocus,
    weeklyReview: Array.isArray(src.weeklyReview) ? src.weeklyReview : base.weeklyReview,
    dailyPriority: src.dailyPriority && typeof src.dailyPriority === 'object' ? src.dailyPriority : base.dailyPriority
  };
}
function normalizeStateShape(state = D) {
  const S = state;
  const fallbackDeviceId = S.settings?.deviceId || makeDeviceId();
  const toIso = (value) => {
    if (!value) return '';
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const dotDate = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (dotDate) return `${dotDate[3]}-${dotDate[2]}-${dotDate[1]}`;
    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0,10);
  };
  S.projects = Array.isArray(S.projects) ? S.projects.map((p, idx) => ({
    id: String(p.id || Date.now() + idx),
    name: p.name || p.title || 'Projekt',
    icon: p.icon || '📌',
    cat: p.cat || p.category || 'Projekt',
    status: ['active','backlog','done','archived','paused'].includes(p.status) ? p.status : (p.status === 'w toku' ? 'active' : (p.status === 'zrobione' ? 'done' : 'backlog')),
    why: p.why || '',
    next: p.next || p.nextStep || '',
    notes: p.notes || '',
    progress: Number(p.progress ?? 0) || 0,
    steps: Array.isArray(p.steps) ? p.steps.filter(Boolean).map((step, stepIdx) => ({
      id: String(step.id || `${p.id || idx}-${stepIdx}`),
      text: typeof step === 'string' ? step : (step.text || ''),
      done: typeof step === 'string' ? false : !!step.done
    })) : [],
    due: toIso(p.due || p.deadline || ''),
    created: toIso(p.created || p.createdAt || todayStr()) || todayStr(),
    touched: toIso(p.touched || p.updatedAt || p.created || p.createdAt || todayStr()) || todayStr(),
    updatedAt: metadataTimestamp(p.updatedAt, p.touched, p.createdAt, p.created),
    updatedByDevice: p.updatedByDevice || fallbackDeviceId,
    deletedAt: optionalTimestamp(p.deletedAt),
    history: Array.isArray(p.history) ? p.history : []
  })) : [];
  S.daily = Array.isArray(S.daily) ? S.daily.map((t, idx) => ({
    id: String(t.id || Date.now() + idx),
    date: toIso(t.date || todayStr()) || todayStr(),
    text: t.text || t.title || '',
    lane: ['must','quick','optional'].includes(t.lane) ? t.lane : (t.section === 'Must' ? 'must' : (['Jeśli starczy sił','Opcjonalne'].includes(t.section) ? 'optional' : 'quick')),
    done: !!t.done,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: metadataTimestamp(t.updatedAt, t.createdAt),
    updatedByDevice: t.updatedByDevice || fallbackDeviceId,
    projectId: t.projectId || '',
    reason: t.reason || '',
    reminderEnabled: !!(t.reminderEnabled ?? t.remindAt ?? t.reminderAt),
    remindAt: t.remindAt || t.reminderAt || '',
    reminderSentAt: t.reminderSentAt || t.lastReminderSentAt || t.reminderLastTriggeredAt || '',
    reminderDismissedAt: t.reminderDismissedAt || (t.reminderDismissed ? new Date().toISOString() : ''),
    deletedAt: optionalTimestamp(t.deletedAt),
  })) : [];
  S.journal = Array.isArray(S.journal) ? S.journal.map((j, idx) => ({
    id: String(j.id || Date.now() + idx),
    date: toIso(j.date || todayStr()) || todayStr(),
    mood: Math.max(1, Math.min(5, Number(j.mood || 3) || 3)),
    win: j.win || '',
    gratitude: j.gratitude || '',
    acceptance: j.acceptance || '',
    note: j.note || '',
    closeDay: j.closeDay || {},
    closeNote: j.closeNote || '',
    createdAt: j.createdAt || new Date().toISOString(),
    updatedAt: metadataTimestamp(j.updatedAt, j.createdAt),
    updatedByDevice: j.updatedByDevice || fallbackDeviceId,
    deletedAt: optionalTimestamp(j.deletedAt)
  })) : [];
  S.rituals = Array.isArray(S.rituals) ? S.rituals.map((r, idx) => ({
    id: String(r.id || Date.now() + idx),
    text: r.text || r.name || '',
    timeOfDay: ['morning','evening','any'].includes(r.timeOfDay) ? r.timeOfDay : 'any',
    active: r.active !== false,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: metadataTimestamp(r.updatedAt, r.createdAt),
    updatedByDevice: r.updatedByDevice || fallbackDeviceId,
    deletedAt: optionalTimestamp(r.deletedAt)
  })).filter(r => r.text || r.deletedAt) : [];
  S.ritualLog = (S.ritualLog && typeof S.ritualLog === 'object') ? Object.fromEntries(Object.entries(S.ritualLog).map(([date, value]) => {
    const day = toIso(date);
    const raw = value && typeof value === 'object' ? value : {};
    const normalized = Object.fromEntries(Object.entries(raw).filter(([, done]) => !!done).map(([id]) => [String(id), true]));
    return [day, normalized];
  }).filter(([date]) => !!date)) : {};
  S.pride = Array.isArray(S.pride) ? S.pride : [];
  S.morningFocus = (S.morningFocus && typeof S.morningFocus === 'object') ? S.morningFocus : {};
  S.weeklyReview = Array.isArray(S.weeklyReview) ? S.weeklyReview.map((entry, idx) => ({
    id: String(entry.id || Date.now() + idx),
    weekKey: entry.weekKey || '',
    finished: entry.finished || '',
    dropped: entry.dropped || '',
    goal: entry.goal || '',
    createdAt: entry.createdAt || new Date().toISOString()
  })) : [];
  S.dailyPriority = (S.dailyPriority && typeof S.dailyPriority === 'object') ? S.dailyPriority : {};
  const rawSettings = S.settings && typeof S.settings === 'object' ? S.settings : {};
  const themeCustom = rawSettings.themeCustom && typeof rawSettings.themeCustom === 'object' ? rawSettings.themeCustom : {};
  const appMode = ['minimal','standard','extended'].includes(rawSettings.appMode)
    ? rawSettings.appMode
    : (LEGACY_MODE_MAP[rawSettings.workMode] || 'standard');
  const modeDefaults = APP_MODES[appMode]?.defaults || APP_MODES.standard.defaults;
  S.settings = {
    name: typeof rawSettings.name === 'string' ? rawSettings.name : '',
    limit: Math.max(1, Math.min(20, Number(rawSettings.limit ?? modeDefaults.limit) || modeDefaults.limit)),
    lastBackupAt: rawSettings.lastBackupAt || '',
    lastLocalSaveAt: rawSettings.lastLocalSaveAt || '',
    lastCloudSyncAt: rawSettings.lastCloudSyncAt || '',
    backupReminderDays: Math.max(1, Math.min(30, Number(rawSettings.backupReminderDays || 3) || 3)),
    autoRollDaily: rawSettings.autoRollDaily !== false,
    lastDailyRollDate: rawSettings.lastDailyRollDate || '',
    lastDailyRollFrom: rawSettings.lastDailyRollFrom || '',
    lastDayCloseDismissedDate: rawSettings.lastDayCloseDismissedDate || '',
    lastDayCloseConfirmedDate: rawSettings.lastDayCloseConfirmedDate || '',
    themeMode: ['auto','dark','light'].includes(rawSettings.themeMode) ? rawSettings.themeMode : 'auto',
    themePreset: rawSettings.themePreset || 'lime',
    themeCustom: {
      accent: themeCustom.accent || '#c8f040',
      blue: themeCustom.blue || '#40a8f0',
      amber: themeCustom.amber || '#f0b840',
      red: themeCustom.red || '#f04840'
    },
    showAdvancedStats: rawSettings.showAdvancedStats ?? modeDefaults.showAdvancedStats,
    showMorningFocus: rawSettings.showMorningFocus ?? modeDefaults.showMorningFocus,
    notificationsEnabled: !!(rawSettings.notificationsEnabled ?? rawSettings.enableNotifications ?? rawSettings.enableTaskNotifications),
    journalReminderEnabled: rawSettings.journalReminderEnabled !== false,
    journalReminderTime: rawSettings.journalReminderTime || '21:30',
    journalReminderFollowupEnabled: false,
    journalReminderFollowupTime: '',
    taskReminderEnabled: typeof rawSettings.taskReminderEnabled === 'boolean'
      ? rawSettings.taskReminderEnabled
      : (typeof rawSettings.taskRemindersEnabled === 'boolean'
        ? rawSettings.taskRemindersEnabled
        : (typeof rawSettings.enableTaskNotifications === 'boolean' ? rawSettings.enableTaskNotifications : true)),
    eveningReminderEnabled: typeof rawSettings.eveningReminderEnabled === 'boolean'
      ? rawSettings.eveningReminderEnabled
      : (typeof rawSettings.eveningOpenTasksReminderEnabled === 'boolean' ? rawSettings.eveningOpenTasksReminderEnabled : true),
    eveningReminderTime: rawSettings.eveningReminderTime || rawSettings.eveningOpenTasksReminderTime || '19:00',
    badgeEnabled: rawSettings.badgeEnabled !== false,
    appMode,
    deviceId: rawSettings.deviceId || fallbackDeviceId,
    lastModifiedAt: rawSettings.lastModifiedAt || '',
    lastModifiedByDevice: rawSettings.lastModifiedByDevice || rawSettings.deviceId || fallbackDeviceId
  };
  S.projects.forEach(project => { project.progress = projectProgress(project); });
  S.schemaVersion = CURRENT_SCHEMA_VERSION;
  return S;
}
function validateAndMigrateState(raw, source = 'state') {
  const migrated = migrateState(raw);
  const normalized = normalizeStateShape(hydrateState(migrated));
  validateStateShape(normalized, source);
  return normalized;
}
function normalizeAppState(raw) {
  return validateAndMigrateState(raw, 'normalize');
}
function isDeleted(item) {
  return !!item?.deletedAt;
}
function visibleItems(items) {
  return (items || []).filter(item => !isDeleted(item));
}
function visibleProjects() { return visibleItems(D.projects); }
function visibleDailyTasks() { return visibleItems(D.daily); }
function visibleJournalEntries() { return visibleItems(D.journal); }
function visibleRituals() { return visibleItems(D.rituals); }
function markEntityDeleted(item) {
  if (!item) return '';
  const stamp = nowIso();
  item.deletedAt = stamp;
  item.updatedAt = stamp;
  item.updatedByDevice = D.settings?.deviceId || '';
  return stamp;
}
function firstTimestampValue(...values) {
  for (const value of values) {
    const iso = validIsoDateTime(value);
    if (!iso) continue;
    const time = new Date(iso).getTime();
    if (Number.isFinite(time)) return time;
  }
  return Number.NEGATIVE_INFINITY;
}
function compareEntityVersions(localItem, remoteItem) {
  const localTime = firstTimestampValue(localItem?.deletedAt, localItem?.updatedAt, localItem?.touched, localItem?.createdAt, localItem?.created);
  const remoteTime = firstTimestampValue(remoteItem?.deletedAt, remoteItem?.updatedAt, remoteItem?.touched, remoteItem?.createdAt, remoteItem?.created);
  if (remoteTime > localTime) return 'remote';
  return 'local';
}
function mergeEntityCollection(localItems = [], remoteItems = []) {
  const localMap = new Map((Array.isArray(localItems) ? localItems : []).filter(item => item?.id != null).map(item => [String(item.id), item]));
  const remoteMap = new Map((Array.isArray(remoteItems) ? remoteItems : []).filter(item => item?.id != null).map(item => [String(item.id), item]));
  const ids = [...new Set([...localMap.keys(), ...remoteMap.keys()])];
  return ids.map((id) => {
    const localItem = localMap.get(id);
    const remoteItem = remoteMap.get(id);
    if (!localItem) return clone(remoteItem);
    if (!remoteItem) return clone(localItem);
    return clone(compareEntityVersions(localItem, remoteItem) === 'remote' ? remoteItem : localItem);
  });
}
function mergeObjectMap(localMap, remoteMap) {
  return {
    ...(isPlainObject(remoteMap) ? remoteMap : {}),
    ...(isPlainObject(localMap) ? localMap : {})
  };
}
function mergeSettings(localSettings = {}, remoteSettings = {}) {
  const localTime = firstTimestampValue(localSettings.lastModifiedAt, localSettings.lastLocalSaveAt, localSettings.lastCloudSyncAt);
  const remoteTime = firstTimestampValue(remoteSettings.lastModifiedAt, remoteSettings.lastLocalSaveAt, remoteSettings.lastCloudSyncAt);
  const chosen = remoteTime > localTime ? remoteSettings : localSettings;
  return {
    ...chosen,
    deviceId: localSettings.deviceId || chosen.deviceId || makeDeviceId(),
    lastLocalSaveAt: localSettings.lastLocalSaveAt || chosen.lastLocalSaveAt || '',
    lastCloudSyncAt: localSettings.lastCloudSyncAt || chosen.lastCloudSyncAt || ''
  };
}
function mergeAppState(localState, remoteState) {
  const local = normalizeAppState(localState || defaultState());
  const remote = normalizeAppState(remoteState || defaultState());
  const merged = hydrateState({
    ...remote,
    ...local,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: mergeSettings(local.settings, remote.settings),
    projects: mergeEntityCollection(local.projects, remote.projects),
    daily: mergeEntityCollection(local.daily, remote.daily),
    journal: mergeEntityCollection(local.journal, remote.journal),
    rituals: mergeEntityCollection(local.rituals, remote.rituals),
    pride: mergeEntityCollection(local.pride, remote.pride),
    weeklyReview: mergeEntityCollection(local.weeklyReview, remote.weeklyReview),
    ritualLog: mergeObjectMap(local.ritualLog, remote.ritualLog),
    morningFocus: mergeObjectMap(local.morningFocus, remote.morningFocus),
    dailyPriority: mergeObjectMap(local.dailyPriority, remote.dailyPriority)
  });
  return normalizeAppState(merged);
}
let D = defaultState();
let reminderTimers = new Map();
function touchEntity(state, target, id, at, deviceId) {
  if (!target) return;
  const update = (item) => {
    item.updatedAt = at;
    item.updatedByDevice = deviceId;
  };
  if (target === 'project') {
    const item = (state.projects || []).find(project => String(project.id) === String(id));
    if (item) {
      update(item);
      item.touched = todayStr();
    }
    return;
  }
  if (target === 'dailyTask') {
    const item = (state.daily || []).find(task => String(task.id) === String(id));
    if (item) update(item);
    return;
  }
  if (target === 'journalEntry') {
    const item = (state.journal || []).find(entry => String(entry.id) === String(id));
    if (item) update(item);
    return;
  }
  if (target === 'ritual') {
    const item = (state.rituals || []).find(ritual => String(ritual.id) === String(id));
    if (item) update(item);
  }
}
function applyChangeMetadata(state, metadata = {}) {
  const next = normalizeAppState(state);
  const at = metadata.updatedAt || nowIso();
  const deviceId = next.settings?.deviceId || makeDeviceId();
  next.settings.lastModifiedAt = at;
  next.settings.lastModifiedByDevice = deviceId;
  touchEntity(next, metadata.entity, metadata.id, at, deviceId);
  (metadata.entities || []).forEach(item => touchEntity(next, item.entity, item.id, at, deviceId));
  return next;
}
const stateStore = createStateStore({
  getCurrent: () => D,
  setCurrent: (next) => { D = next; },
  defaultState,
  clone,
  applyChangeMetadata,
  saveLocalCache,
  pushStateToCloud,
  renderCurrentPage: () => renderCurrentPage()
});
const { setState } = stateStore;

// ════════════════════════════════════════
// FIREBASE INIT / RUNTIME
// ════════════════════════════════════════
let currentUser = null;
let remoteUnsub = null;
let suppressRemoteWrite = false;
let syncTimer = null;
let lastRemoteHash = '';
let deferredInstallPrompt = null;
let swRegistration = null;
let messagingSwRegistration = null;
let messagingClient = null;
let reminderSyncTimer = null;
let badgeSyncTimer = null;
const JOURNAL_REMINDER_DEBUG = {
  lastJournalReminderAttempt: '',
  lastJournalReminderResult: '',
  lastJournalReminderError: '',
  computedLocalDate: '',
  timezone: '',
  journalEntryExistsToday: false,
  firstReminderEligible: false,
  firstReminderHandledToday: false,
  firstReminderPushRequestedAt: '',
  firstReminderSkipReason: '',
  firstReminderResult: '',
  secondReminderEligible: false,
  secondReminderHandledToday: false,
  secondReminderPushRequestedAt: '',
  secondReminderSkipReason: '',
  secondReminderResult: '',
  schedulerDecidedToSend: false,
  backendAuthAvailable: false,
  backendAuthError: '',
  pushRequestExecuted: false,
  pushBackendAccepted: false,
  lastPushRequestStatus: '',
  lastPushRequestResponse: '',
  lastPushRequestError: '',
  serviceWorkerReceivedPayload: 'unknown',
  visibleNotificationShown: 'unknown'
};
const NOTIFICATION_RUNTIME = {
  supported: false,
  secureContext: false,
  notificationApi: false,
  serviceWorkerApi: false,
  pushApi: false,
  standalone: false,
  ios: false,
  homeScreenRequired: false,
  appServiceWorkerReady: false,
  messagingServiceWorkerReady: false,
  firstRegistrationAt: '',
  token: '',
  permission: 'default',
  registrationStatus: 'niedostępne',
  registrationError: '',
  lastAttemptAt: '',
  lastRegistrationAt: '',
  foregroundReady: false,
  vapidKey: firebaseConfig.fcmVapidKey || ''
};
const APP_RUNTIME = {
  booted: false,
  authReady: false,
  localMode: false,
  pendingCloudHash: '',
  syncMode: 'local',
  syncText: 'Zapisano lokalnie',
  syncStatus: 'local',
  authResolve: null,
  authPromise: null
};
APP_RUNTIME.authPromise = new Promise(resolve => { APP_RUNTIME.authResolve = resolve; });

function makeDeviceId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'device-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}
function ensureDisplayNameFromAuth(user = currentUser) {
  if (D.settings.name) return;
  const email = user?.email || '';
  D.settings.name = email.includes('@') ? email.split('@')[0] : '';
}
function syncDocRef(uid) { return doc(fbDb, 'users', uid, 'app', 'state'); }
function deviceDocRef(uid, deviceId) { return doc(fbDb, 'users', uid, 'devices', deviceId); }
function appRemoteSnapshotDecision(currentState, incomingState, options = {}) {
  return createRemoteSnapshotDecision(currentState, incomingState, { ...options, mergeAppState });
}
function appLocalPushDecision(state, remoteHash, pendingHash = '') {
  return createLocalPushDecision(state, remoteHash, pendingHash, { clone, normalizeAppState });
}
let storageLayer = null;
function storage() {
  if (!storageLayer) {
    storageLayer = createFocusHubStorage({
      appStorageKey: APP_STORAGE_KEY,
      localStorage,
      validateAndMigrateState,
      normalizeForStorage: normalizeAppState,
      syncDocRef,
      setDoc,
      onSnapshot,
      serverTimestamp
    });
  }
  return storageLayer;
}
async function firebaseAuthHeaders() {
  if (!currentUser) throw new Error('not_authenticated');
  const token = await getIdToken(currentUser, false);
  return { authorization: `Bearer ${token}` };
}
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const authHeaders = await firebaseAuthHeaders();
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value));
  return fetch(url, { ...options, headers });
}
function showAuthError(msg='') {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}
function formatSavedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff >= 0 && diff < 60000) return 'przed chwilą';
  return d.toLocaleString('pl-PL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function setSyncState(mode, text) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-text');
  APP_RUNTIME.syncMode = mode || 'local';
  APP_RUNTIME.syncText = text || 'Zapisano lokalnie';
  if (dot && label) {
    dot.className = 'sync-dot' + (mode === 'ok' ? ' ok' : mode === 'bad' ? ' bad' : '');
    label.textContent = APP_RUNTIME.syncText;
  }
  updateUserChip();
}
function setSyncStatus(status) {
  APP_RUNTIME.syncStatus = status;
  const view = syncStatusView(status);
  setSyncState(view.mode, view.text);
}
function finishSyncStatus() {
  const view = syncStatusAfterRemoteWrite(APP_RUNTIME.pendingCloudHash, lastRemoteHash);
  APP_RUNTIME.syncStatus = view.mode === 'ok' ? 'synced' : 'syncing';
  setSyncState(view.mode, view.text);
}
function updateUserChip() {
  const accEmail = document.getElementById('account-email');
  const accSync = document.getElementById('account-sync-text');
  const localSave = document.getElementById('account-local-save-text');
  const cloudSync = document.getElementById('account-cloud-sync-text');
  if (accEmail) accEmail.textContent = currentUser?.email || 'lokalnie / brak konta';
  if (accSync) accSync.textContent = APP_RUNTIME.syncText || 'Zapisano lokalnie';
  if (localSave) localSave.textContent = formatSavedAt(D.settings?.lastLocalSaveAt);
  if (cloudSync) cloudSync.textContent = formatSavedAt(D.settings?.lastCloudSyncAt);
}
function openAuthOverlay() {
  document.getElementById('auth-screen')?.classList.add('show');
  document.getElementById('shell')?.style.setProperty('display', 'none');
  document.getElementById('mobile-bottom-nav')?.style.setProperty('display', 'none');
  document.getElementById('mobile-menu-overlay')?.classList.remove('open');
}

function closeAuthOverlay() {
  document.getElementById('auth-screen')?.classList.remove('show');
  document.getElementById('shell')?.style.removeProperty('display');
  if (isPhoneUI()) {
    document.getElementById('mobile-bottom-nav')?.style.setProperty('display', 'grid');
  } else {
    document.getElementById('mobile-bottom-nav')?.style.removeProperty('display');
  }
}

// ════════════════════════════════════════
// LOCAL CACHE
// ════════════════════════════════════════
function loadLocalCache() {
  const result = storage().loadLocal();
  if (result.error) console.warn('Local state fallback', result.error);
  D = result.state || defaultState();
  ensureDisplayNameFromAuth();
}
function saveLocalCache(options = {}) {
  if (D?.settings && options.touchLocalSave !== false) D.settings.lastLocalSaveAt = new Date().toISOString();
  if (!options.skipNormalize) D = normalizeAppState(D);
  D = storage().saveLocal(D);
  if (!options.skipSyncStatus) setSyncStatus(currentUser ? 'local' : (APP_RUNTIME.localMode ? 'offline' : 'local'));
  scheduleBadgeSync();
  scheduleReminderSync();
  scheduleReminderTimers();
}
function save(metadata = {}) {
  return setState(D, metadata);
}

// ════════════════════════════════════════
// RENDER HELPERS
// ════════════════════════════════════════
function pageRenderers(safeRender) {
  return {
    hub: () => safeRender(renderHub, 'hub-active'),
    daily: () => safeRender(renderDaily, 'must-list'),
    upcoming: () => safeRender(renderUpcoming, 'upcoming-selected-list'),
    active: () => safeRender(renderActive, 'active-list'),
    backlog: () => safeRender(renderBacklog, 'backlog-list'),
    archive: () => safeRender(renderArchive, 'archive-list'),
    pride: () => safeRender(renderPride, 'pride-list'),
    journal: () => safeRender(renderJournal, 'journal-list'),
    stats: () => safeRender(renderStats, 'stats-category-summary'),
    review: () => safeRender(renderReview, 'review-week'),
    account: () => safeRender(renderAccount, 'account-email')
  };
}
function renderMobileFocusPill() {
  const box = document.getElementById('mobile-focus-pill');
  if (!box) return;
  const focus = D.morningFocus?.[todayStr()];
  if (!focus || !(focus.priorities || []).some(Boolean)) {
    box.innerHTML = '';
    return;
  }
  const first = (focus.priorities || []).filter(Boolean)[0] || '';
  const note = focus.note ? `<div style="margin-top:6px;color:var(--text3);font-size:.74rem;">${escapeHtml(focus.note)}</div>` : '';
  box.innerHTML = `<div class="proj-next"><span class="next-arrow">→</span><div><strong>Focus dnia:</strong> ${escapeHtml(first)}${note}</div></div>`;
}
function getCurrentPageId() {
  return document.querySelector('.page.on')?.id?.replace('page-','') || defaultLandingPage();
}
function renderGlobalUI() {
  renderMobileFocusPill();
  updateSidebar();
  updateUserChip();
  updateFeatureVisibility();
  syncInstallUI();
}
const renderController = createRenderController({
  pageRenderers,
  renderGlobalUI,
  getCurrentPageId,
  toast,
  escapeHtml,
  document
});
const { safeRender, renderCurrentPage, renderAll } = renderController;

// ════════════════════════════════════════
// THEME
// ════════════════════════════════════════
function hexToRgb(hex) {
  const clean = String(hex || '').replace('#','');
  const full = clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r:200, g:240, b:64 };
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}
function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function activeThemeColors() {
  const preset = THEME_PRESETS[D.settings.themePreset] || THEME_PRESETS.lime;
  const custom = D.settings.themePreset === 'custom' ? D.settings.themeCustom : preset;
  return { accent: custom.accent, blue: custom.blue, amber: custom.amber, red: custom.red };
}
function currentThemeMode() {
  if ((D.settings.themeMode || 'auto') === 'auto') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return D.settings.themeMode || 'dark';
}
function applyThemeSettings() {
  if (!D?.settings) return;
  const root = document.documentElement;
  const mode = currentThemeMode();
  document.body.classList.toggle('light-theme', mode === 'light');
  const colors = activeThemeColors();
  root.style.setProperty('--lime', colors.accent);
  root.style.setProperty('--lime2', colors.accent);
  root.style.setProperty('--lime-dim', rgba(colors.accent, 0.10));
  root.style.setProperty('--lime-border', rgba(colors.accent, 0.25));
  root.style.setProperty('--blue', colors.blue);
  root.style.setProperty('--blue-dim', rgba(colors.blue, 0.10));
  root.style.setProperty('--blue-border', rgba(colors.blue, 0.25));
  root.style.setProperty('--amber', colors.amber);
  root.style.setProperty('--amber-dim', rgba(colors.amber, 0.10));
  root.style.setProperty('--amber-border', rgba(colors.amber, 0.25));
  root.style.setProperty('--red', colors.red);
  root.style.setProperty('--red-dim', rgba(colors.red, 0.10));
  root.style.setProperty('--red-border', rgba(colors.red, 0.25));
  syncThemeForm();
}
function syncThemeForm() {
  const modeEl = document.getElementById('theme-mode');
  if (modeEl) modeEl.value = D.settings.themeMode || 'auto';
  ['accent','blue','amber','red'].forEach(key => {
    const el = document.getElementById('theme-' + key);
    if (el) el.value = D.settings.themeCustom[key] || activeThemeColors()[key];
  });
  const wrap = document.getElementById('theme-preset-list');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(THEME_PRESETS).map(([key, val]) => `<div class="theme-preset ${D.settings.themePreset===key?'active':''}" role="button" tabindex="0" aria-label="Wybierz preset kolorów ${escapeHtml(val.label)}" data-action="setThemePreset" data-value="${escapeHtml(key)}"><div class="theme-swatches"><span style="background:${val.accent}"></span><span style="background:${val.blue}"></span><span style="background:${val.amber}"></span><span style="background:${val.red}"></span></div><strong>${escapeHtml(val.label)}</strong></div>`).join('') + `<div class="theme-preset ${D.settings.themePreset==='custom'?'active':''}" role="button" tabindex="0" aria-label="Wybierz własne kolory" data-action="setThemePreset" data-value="custom"><div class="theme-swatches"><span style="background:${D.settings.themeCustom.accent}"></span><span style="background:${D.settings.themeCustom.blue}"></span><span style="background:${D.settings.themeCustom.amber}"></span><span style="background:${D.settings.themeCustom.red}"></span></div><strong>Własny</strong></div>`;
}
function setThemeMode(mode) { D.settings.themeMode = mode; applyThemeSettings(); save({ reason:'settings:theme' }); }
function setThemePreset(preset) {
  D.settings.themePreset = preset;
  if (preset !== 'custom' && THEME_PRESETS[preset]) D.settings.themeCustom = { ...THEME_PRESETS[preset] };
  applyThemeSettings();
  save({ reason:'settings:theme' });
}
function updateCustomTheme() {
  D.settings.themePreset = 'custom';
  ['accent','blue','amber','red'].forEach(key => {
    const el = document.getElementById('theme-' + key);
    if (el) D.settings.themeCustom[key] = el.value;
  });
  applyThemeSettings();
  save({ reason:'settings:theme' });
}

// ════════════════════════════════════════
// AUTH LIFECYCLE
// ════════════════════════════════════════
function resolveAuthLifecycle() {
  if (APP_RUNTIME.authReady) return;
  APP_RUNTIME.authReady = true;
  APP_RUNTIME.authResolve?.();
}
async function loginUser() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  showAuthError('');
  if (!email || !password) {
    showAuthError('Podaj e-mail i hasło.');
    return;
  }
  APP_RUNTIME.localMode = false;
  try { await signInWithEmailAndPassword(fbAuth, email, password); }
  catch (e) { showAuthError(e?.message || 'Nie udało się zalogować.'); }
}
async function registerUser() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  showAuthError('');
  if (!email || !password) {
    showAuthError('Podaj e-mail i hasło.');
    return;
  }
  if (password.length < 6) {
    showAuthError('Hasło musi mieć co najmniej 6 znaków.');
    return;
  }
  APP_RUNTIME.localMode = false;
  try { await createUserWithEmailAndPassword(fbAuth, email, password); }
  catch (e) { showAuthError(e?.message || 'Nie udało się utworzyć konta.'); }
}
async function logoutUser() {
  try { await unregisterCurrentDevice(); } catch (e) {}
  APP_RUNTIME.localMode = false;
  try { await signOut(fbAuth); } catch (e) {}
}
function continueLocalMode() {
  APP_RUNTIME.localMode = true;
  closeAuthOverlay();
  setSyncStatus('offline');
  updateUserChip();
  resolveAuthLifecycle();
  if (APP_RUNTIME.booted) renderCurrentPage();
}

window.loginUser = loginUser;
window.registerUser = registerUser;
window.continueLocalMode = continueLocalMode;

function bindAuthButtons() {
  const loginBtn = document.getElementById('auth-login-btn');
  const registerBtn = document.getElementById('auth-register-btn');
  const localBtn = document.getElementById('auth-local-btn');
  if (loginBtn && loginBtn.dataset.boundAuthBtn !== '1') {
    loginBtn.dataset.boundAuthBtn = '1';
    loginBtn.addEventListener('click', (event) => {
      event.preventDefault();
      loginUser();
    });
  }
  if (registerBtn && registerBtn.dataset.boundAuthBtn !== '1') {
    registerBtn.dataset.boundAuthBtn = '1';
    registerBtn.addEventListener('click', (event) => {
      event.preventDefault();
      registerUser();
    });
  }
  if (localBtn && localBtn.dataset.boundAuthBtn !== '1') {
    localBtn.dataset.boundAuthBtn = '1';
    localBtn.addEventListener('click', (event) => {
      event.preventDefault();
      continueLocalMode();
    });
  }
}

async function handleAuthStateChange(user) {
  currentUser = user || null;
  if (currentUser) {
    APP_RUNTIME.localMode = false;
    closeAuthOverlay();
    await startCloudSyncForUser(currentUser);
    if (notificationsAllowed()) {
      syncMessagingRegistration({ force: true, requestPermission: false }).catch((err) => console.error('Messaging sync after auth failed', err));
    } else {
      syncNotificationUI();
    }
  } else {
    stopCloudSync();
    ensureDisplayNameFromAuth();
    if (APP_RUNTIME.localMode) {
      closeAuthOverlay();
      setSyncStatus('offline');
    } else {
      openAuthOverlay();
      setSyncStatus('local');
    }
    await unregisterCurrentDevice().catch(() => {});
  }
  updateUserChip();
  resolveAuthLifecycle();
  if (APP_RUNTIME.booted) renderCurrentPage();
}
function initAuthLifecycle() {
  onAuthStateChanged(fbAuth, (user) => {
    handleAuthStateChange(user).catch((err) => {
      console.error(err);
      setSyncStatus('error');
      resolveAuthLifecycle();
    });
  });
}

// ════════════════════════════════════════
// CLOUD SYNC LIFECYCLE
// ════════════════════════════════════════
function stopCloudSync() {
  if (remoteUnsub) {
    try { remoteUnsub(); } catch (e) {}
    remoteUnsub = null;
  }
  lastRemoteHash = '';
  APP_RUNTIME.pendingCloudHash = '';
}
async function pushStateToCloud(reason='save', options = {}) {
  if (!options.skipLocal) saveLocalCache();
  if (!currentUser || suppressRemoteWrite) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const decision = appLocalPushDecision(D, lastRemoteHash, APP_RUNTIME.pendingCloudHash);
      if (!decision.shouldPush) {
        finishSyncStatus();
        return;
      }
      APP_RUNTIME.pendingCloudHash = decision.hash;
      setSyncStatus('syncing');
      await storage().saveRemote(currentUser.uid, decision.cleanState, {
        updatedBy: currentUser.email || '',
        lastWriterDevice: D.settings.deviceId || ''
      });
      lastRemoteHash = decision.hash;
      APP_RUNTIME.pendingCloudHash = '';
      D.settings.lastCloudSyncAt = new Date().toISOString();
      saveLocalCache({ touchLocalSave: false, skipSyncStatus: true });
      finishSyncStatus();
    } catch (e) {
      console.error(e);
      setSyncStatus(navigator.onLine === false ? 'offline' : 'error');
      toast('Nie udało się zsynchronizować zmian. Dane są tylko lokalnie.');
    }
  }, reason === 'immediate' ? 40 : 260);
}
async function startCloudSyncForUser(user) {
  stopCloudSync();
  setSyncStatus('syncing');
  await new Promise((resolve) => {
    let firstSnapshotHandled = false;
    remoteUnsub = storage().loadRemote(user.uid, {
      onState: (incomingState) => {
        const remoteDecision = appRemoteSnapshotDecision(D, incomingState, { forceApply: !firstSnapshotHandled });
        const incomingHash = remoteDecision.incomingHash;
        const shouldHydrateFromCloud = remoteDecision.shouldApply;
        lastRemoteHash = incomingHash;
        if (shouldHydrateFromCloud) {
          suppressRemoteWrite = true;
          D = remoteDecision.state;
          ensureDisplayNameFromAuth(user);
          saveLocalCache({ touchLocalSave: false, skipSyncStatus: true });
          suppressRemoteWrite = false;
        }
        if (APP_RUNTIME.pendingCloudHash === incomingHash) {
          APP_RUNTIME.pendingCloudHash = '';
          D.settings.lastCloudSyncAt = new Date().toISOString();
          saveLocalCache({ touchLocalSave: false, skipSyncStatus: true });
        }
        if (!APP_RUNTIME.pendingCloudHash && !D.settings.lastCloudSyncAt) {
          D.settings.lastCloudSyncAt = new Date().toISOString();
          saveLocalCache({ touchLocalSave: false, skipSyncStatus: true });
        }
        finishSyncStatus();
        if (APP_RUNTIME.booted) renderCurrentPage();
        if (!firstSnapshotHandled) {
          firstSnapshotHandled = true;
          resolve();
        }
      },
      onEmpty: () => {
        ensureDisplayNameFromAuth(user);
        pushStateToCloud('immediate');
        if (APP_RUNTIME.booted) renderCurrentPage();
        if (!firstSnapshotHandled) {
          firstSnapshotHandled = true;
          resolve();
        }
      },
      onError: (err) => {
        console.error(err);
        setSyncStatus(navigator.onLine === false ? 'offline' : 'error');
        toast('Nie udało się zsynchronizować zmian. Dane są tylko lokalnie.');
        if (!firstSnapshotHandled) {
          firstSnapshotHandled = true;
          resolve();
        }
      }
    });
  });
}

// ════════════════════════════════════════
// BOOT SEQUENCE
// ════════════════════════════════════════
function isPhoneUI() { return window.matchMedia('(max-width: 760px)').matches; }
function defaultLandingPage() { return isPhoneUI() ? 'daily' : 'hub'; }
function launchPageFromUrl() {
  const page = new URL(window.location.href).searchParams.get('page') || '';
  return PAGE_TITLES[page] ? page : '';
}
function initStaticChrome() {
  const dateEl = document.getElementById('tb-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('pl-PL', { weekday:'long', day:'numeric', month:'long' });
  }
  bindActionDelegation();
  applyThemeSettings();
  registerAppServiceWorker();
  initMessagingClient().catch((err) => console.error('Messaging init failed', err));
  syncInstallUI();
}
function initBrowserLifecycle() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    syncInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    syncInstallUI();
  });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const rerenderTheme = () => {
      if ((D.settings.themeMode || 'auto') === 'auto') applyThemeSettings();
    };
    if (mq.addEventListener) mq.addEventListener('change', rerenderTheme);
    else if (mq.addListener) mq.addListener(rerenderTheme);
  }
}
function runAppBootSequence() {
  ensureDisplayNameFromAuth();
  maybeRollDailyTasks();
  prepJournalDefaults();
  prepDailyDefaults();
  prepMorningFocusDefaults();
  ensureDailySelectedDate();
  syncNotificationUI();
  scheduleBadgeSync();
  if (D.settings.notificationsEnabled && notificationsAllowed()) {
    syncMessagingRegistration({ force: true, requestPermission: false }).catch((err) => console.error('Push subscribe init failed', err));
  }
  scheduleReminderTimers();
  if (currentUser) scheduleReminderSync();
  nav(launchPageFromUrl() || defaultLandingPage());
  maybeOpenWeeklyReview();
}
async function bootstrapApp() {
  loadLocalCache();
  initStaticChrome();
  initBrowserLifecycle();
  initAuthLifecycle();
  await APP_RUNTIME.authPromise;
  APP_RUNTIME.booted = true;
  runAppBootSequence();
}

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
function updateMobileNav(page) {
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.toggle('on', btn.dataset.page === page));
}
function toggleMobileMenu(force) {
  const el = document.getElementById('mobile-menu-overlay');
  if (!el) return;
  const shouldOpen = typeof force === 'boolean' ? force : !el.classList.contains('open');
  el.classList.toggle('open', shouldOpen);
}
function mobileNav(page) {
  nav(page);
  toggleMobileMenu(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function mobileQuickAdd() {
  nav('daily');
  toggleMobileMenu(false);
  setTimeout(() => focusDailyTaskInput(), 120);
}
function focusDailyTaskInput() {
  const el = document.getElementById('daily-task-text');
  if (el) { el.focus(); el.scrollIntoView({ behavior:'smooth', block:'center' }); }
}
function focusJournalInput() {
  const targets = ['jr-win', 'jr-acceptance', 'jr-note'];
  for (const id of targets) {
    const el = document.getElementById(id);
    if (el) { el.focus(); el.scrollIntoView({ behavior:'smooth', block:'center' }); break; }
  }
}
function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('on');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.dataset.page === page) n.classList.add('on');
  });
  updateMobileNav(page);
  updateFeatureVisibility();

  const addBtn = document.getElementById('tb-add-btn');
  addBtn.style.display = !isPhoneUI() && ['hub','active','backlog'].includes(page) ? '' : 'none';

  const renders = { hub: () => safeRender(renderHub, 'hub-active'), daily: () => safeRender(renderDaily, 'must-list'), upcoming: () => safeRender(renderUpcoming, 'upcoming-selected-list'), active: () => safeRender(renderActive, 'active-list'), backlog: () => safeRender(renderBacklog, 'backlog-list'), archive: () => safeRender(renderArchive, 'archive-list'), pride: () => safeRender(renderPride, 'pride-list'), journal: () => safeRender(renderJournal, 'journal-list'), stats: () => safeRender(renderStats, 'stats-category-summary'), review: () => safeRender(renderReview, 'review-week'), account: () => safeRender(renderAccount, 'account-email') };
  if (renders[page]) renders[page]();
  if (isPhoneUI()) toggleMobileMenu(false);
  maybeOpenWeeklyReview();
}


// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function todayStr() { return new Date().toISOString().split('T')[0]; }
function userTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Warsaw';
}
function localDateString(date = new Date(), timeZone = userTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function isoDateOffset(baseStr, days) { const d = new Date((baseStr || todayStr()) + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10); }
function yesterdayStr() { return isoDateOffset(todayStr(), -1); }
function currentHour() { return new Date().getHours(); }
function currentWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}
function toneText(firm, steady, gentle = steady) {
  return steady || firm || gentle || '';
}
function messageCopy(key, vars = {}) {
  const direct = {
    nextStepRequired: 'Uzupełnij następny krok.',
    stepsRequired: 'Projekt potrzebuje od 3 do 5 konkretnych kroków.',
    limitReached: `Limit aktywnych projektów: ${vars.limit ?? D.settings.limit}.`,
    noSlot: `Brak wolnego slotu. Limit ${vars.limit ?? D.settings.limit} aktywnych projektów.`,
    notificationsOn: 'Powiadomienia zostały włączone.',
    notificationsDenied: 'Safari blokuje powiadomienia dla Focus Hub.',
    notificationsPending: 'Nie nadano jeszcze zgody na powiadomienia.',
    notificationsUnsupported: 'Ta przeglądarka nie obsługuje powiadomień.',
    notificationsServerMissing: 'Zgoda jest nadana, ale brakuje konfiguracji web push na serwerze.',
    pushTestSent: 'Backend wysłał test push.',
    pushTestFailed: 'Nie udało się wysłać testowego web push.'
  };
  return direct[key] || '';
}
function weeklyReviewDue() {
  const now = new Date();
  return now.getDay() === 0 && currentHour() >= 18 && !D.weeklyReview.some(entry => entry.weekKey === currentWeekKey(now));
}
function maybeOpenWeeklyReview() {
  if (!weeklyReviewDue()) return;
  const weekKey = currentWeekKey(new Date());
  const existing = (D.weeklyReview || []).find(entry => entry.weekKey === weekKey);
  document.getElementById('weekly-review-finished').value = existing?.finished || '';
  document.getElementById('weekly-review-drop').value = existing?.dropped || '';
  document.getElementById('weekly-review-goal').value = existing?.goal || '';
  openModal('modal-weekly-review');
}
function canUseNotifications() { return typeof window !== 'undefined' && 'Notification' in window; }
function notificationsAllowed() { return canUseNotifications() && Notification.permission === 'granted'; }
function isIOSWebKit() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}
function yesNo(value) {
  return value ? 'tak' : 'nie';
}
function shortError(error) {
  return String(error?.message || error || '').replace(/^FirebaseError:\s*/i, '').slice(0, 180) || '—';
}
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function looksLikeVapidPublicKey(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{80,120}$/.test(key);
}
function syncInstallUI() {
  const chip = document.getElementById('install-state-chip');
  const note = document.getElementById('install-help-note');
  if (!chip || !note) return;
  chip.classList.remove('is-ready', 'is-soft');
  if (isStandaloneApp()) {
    chip.classList.add('is-ready');
    chip.textContent = 'Focus Hub jest zainstalowany jako appka';
    note.textContent = 'To najlepsza wersja dla iPhone. Mamy juz service worker i appka moze dzialac bardziej natywnie.';
    return;
  }
  chip.classList.add('is-soft');
  chip.textContent = 'Otworz Safari i dodaj appke do ekranu glownego';
  note.textContent = deferredInstallPrompt
    ? 'Mozesz zainstalowac Focus Huba bezposrednio z tego przycisku.'
    : 'Na iPhonie wybierz Udostepnij -> Dodaj do ekranu poczatkowego. Po instalacji latwiej bedzie przejsc na prawdziwy web push.';
}
async function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    bindAppServiceWorkerUpdates(swRegistration);
    NOTIFICATION_RUNTIME.appServiceWorkerReady = true;
    return swRegistration;
  } catch (err) {
    console.error('SW register failed', err);
    NOTIFICATION_RUNTIME.appServiceWorkerReady = false;
    return null;
  } finally {
    syncInstallUI();
  }
}
function bindAppServiceWorkerUpdates(registration) {
  if (!registration || registration.datasetBound === '1') return;
  registration.datasetBound = '1';
  const notifyUpdate = () => showAppUpdateAvailable(registration);
  if (registration.waiting) notifyUpdate();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate();
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (APP_RUNTIME.reloadingForUpdate) return;
    APP_RUNTIME.reloadingForUpdate = true;
    window.location.reload();
  });
}
function showAppUpdateAvailable(registration) {
  toast('Dostępna nowa wersja Focus Hub. Odśwież aplikację.', {
    label: 'Odśwież',
    duration: 10000,
    onClick: () => {
      if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    }
  });
}
async function registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    NOTIFICATION_RUNTIME.messagingServiceWorkerReady = false;
    throw new Error('service_worker_unsupported');
  }
  try {
    messagingSwRegistration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', {
      scope: './firebase-cloud-messaging-push-scope/'
    });
    await navigator.serviceWorker.ready.catch(() => null);
    NOTIFICATION_RUNTIME.messagingServiceWorkerReady = true;
    return messagingSwRegistration;
  } catch (err) {
    NOTIFICATION_RUNTIME.messagingServiceWorkerReady = false;
    throw new Error(`service_worker_registration_failed: ${err?.message || err}`, { cause: err });
  } finally {
    syncNotificationUI();
  }
}
function promptInstallApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
      deferredInstallPrompt = null;
      syncInstallUI();
    });
    return;
  }
  if (isStandaloneApp()) {
    toast('Focus Hub jest juz zainstalowany.');
    return;
  }
  alert('Na iPhonie otworz Safari, stuknij Udostepnij i wybierz "Dodaj do ekranu poczatkowego".');
}
function notificationPlatformLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-web';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos-web';
  return 'web';
}
function collectNotificationEnvironment() {
  NOTIFICATION_RUNTIME.secureContext = !!window.isSecureContext;
  NOTIFICATION_RUNTIME.notificationApi = canUseNotifications();
  NOTIFICATION_RUNTIME.serviceWorkerApi = 'serviceWorker' in navigator;
  NOTIFICATION_RUNTIME.pushApi = 'PushManager' in window;
  NOTIFICATION_RUNTIME.standalone = isStandaloneApp();
  NOTIFICATION_RUNTIME.ios = isIOSWebKit();
  NOTIFICATION_RUNTIME.homeScreenRequired = NOTIFICATION_RUNTIME.ios && !NOTIFICATION_RUNTIME.standalone;
  NOTIFICATION_RUNTIME.permission = canUseNotifications() ? Notification.permission : 'default';
  return {
    secureContext: NOTIFICATION_RUNTIME.secureContext,
    notificationApi: NOTIFICATION_RUNTIME.notificationApi,
    serviceWorkerApi: NOTIFICATION_RUNTIME.serviceWorkerApi,
    pushApi: NOTIFICATION_RUNTIME.pushApi,
    standalone: NOTIFICATION_RUNTIME.standalone,
    ios: NOTIFICATION_RUNTIME.ios,
    homeScreenRequired: NOTIFICATION_RUNTIME.homeScreenRequired,
    permission: NOTIFICATION_RUNTIME.permission,
    fcmAvailable: NOTIFICATION_RUNTIME.supported
  };
}
async function checkNotificationEnvironment({ requirePermission = false } = {}) {
  const env = collectNotificationEnvironment();
  if (!env.secureContext) return { ok:false, code:'insecure_context', label:'wymagany HTTPS' };
  if (!env.notificationApi) return { ok:false, code:'unsupported_browser', label:'unsupported browser: brak Notification API' };
  if (!env.serviceWorkerApi) return { ok:false, code:'service_worker_unsupported', label:'unsupported browser: brak service worker' };
  if (!env.pushApi) return { ok:false, code:'push_unsupported', label:'unsupported browser: brak Push API' };
  if (env.homeScreenRequired) return { ok:false, code:'not_installed_home_screen', label:'not installed as home screen app' };
  try {
    NOTIFICATION_RUNTIME.supported = await isMessagingSupported();
  } catch (err) {
    NOTIFICATION_RUNTIME.supported = false;
    return { ok:false, code:'fcm_support_check_failed', label:shortError(err) };
  }
  if (!NOTIFICATION_RUNTIME.supported) return { ok:false, code:'fcm_unavailable', label:'FCM unavailable in this browser' };
  if (requirePermission && env.permission === 'denied') return { ok:false, code:'permission_denied', label:'permission denied' };
  return { ok:true, code:'ok', label:'środowisko gotowe' };
}
function notificationPermissionLabel(permission = 'default') {
  if (permission === 'granted') return 'Udzielona';
  if (permission === 'denied') return 'Zablokowana';
  return 'Brak zgody';
}
function currentJournalEntry(date = todayStr()) {
  return visibleJournalEntries().find((entry) => entry.date === date) || null;
}
function openTasksTodayCount() {
  return visibleDailyTasks().filter((task) => task.date === todayStr() && !task.done).length;
}
function openThingsBadgeCount() {
  const openTasks = openTasksTodayCount();
  const journalPending = currentJournalEntry(todayStr()) ? 0 : 1;
  return openTasks + journalPending;
}
async function syncAppBadge() {
  const count = D.settings.badgeEnabled ? openThingsBadgeCount() : 0;
  const navApi = navigator;
  if (!navApi) return;
  try {
    if (count > 0 && typeof navApi.setAppBadge === 'function') {
      await navApi.setAppBadge(count);
    } else if (count <= 0 && typeof navApi.clearAppBadge === 'function') {
      await navApi.clearAppBadge();
    }
  } catch (err) {
    console.error('Badge update failed', err);
  }
}
function scheduleBadgeSync() {
  clearTimeout(badgeSyncTimer);
  badgeSyncTimer = window.setTimeout(() => {
    syncAppBadge().catch((err) => console.error('Badge sync failed', err));
  }, 60);
}
function setNotificationRuntimeStatus(status, error = '') {
  NOTIFICATION_RUNTIME.registrationStatus = status;
  NOTIFICATION_RUNTIME.registrationError = error || '';
  syncNotificationUI();
}
async function initMessagingClient() {
  const check = await checkNotificationEnvironment();
  if (!check.ok) {
    setNotificationRuntimeStatus(check.code, check.label);
    return null;
  }
  if (!messagingClient) messagingClient = getMessaging(fbApp);
  if (!NOTIFICATION_RUNTIME.foregroundReady) {
    onMessage(messagingClient, (payload) => {
      const body = payload?.data?.body || payload?.notification?.body || 'Masz nowe powiadomienie.';
      toast(body);
      scheduleBadgeSync();
    });
    NOTIFICATION_RUNTIME.foregroundReady = true;
  }
  if (!notificationsAllowed()) {
    setNotificationRuntimeStatus('brak zgody');
  }
  return messagingClient;
}
async function loadNotificationConfig() {
  if (looksLikeVapidPublicKey(NOTIFICATION_RUNTIME.vapidKey)) return NOTIFICATION_RUNTIME.vapidKey.trim();
  const appKey = firebaseConfig.fcmVapidKey || '';
  if (looksLikeVapidPublicKey(appKey)) {
    NOTIFICATION_RUNTIME.vapidKey = appKey.trim();
    return NOTIFICATION_RUNTIME.vapidKey;
  }
  try {
    const res = await fetch('./api/push/config');
    const data = await res.json().catch(() => ({}));
    if (res.ok && looksLikeVapidPublicKey(data?.vapidKey)) {
      NOTIFICATION_RUNTIME.vapidKey = data.vapidKey.trim();
      return NOTIFICATION_RUNTIME.vapidKey;
    }
  } catch (err) {
    console.error('Notification config load failed', err);
  }
  throw new Error('missing_fcm_vapid_key');
}
function validateNotificationConfig() {
  const key = firebaseConfig.fcmVapidKey || NOTIFICATION_RUNTIME.vapidKey || '';
  if (!looksLikeVapidPublicKey(key)) {
    NOTIFICATION_RUNTIME.token = '';
    NOTIFICATION_RUNTIME.vapidKey = '';
    setNotificationRuntimeStatus('missing_fcm_vapid_key', 'missing_fcm_vapid_key');
    return false;
  }
  NOTIFICATION_RUNTIME.vapidKey = key.trim();
  return NOTIFICATION_RUNTIME.vapidKey;
}
async function writeDeviceRegistration(update = {}) {
  if (!currentUser) return;
  const nowIso = new Date().toISOString();
  const createdAt = update.createdAt || NOTIFICATION_RUNTIME.firstRegistrationAt || NOTIFICATION_RUNTIME.lastRegistrationAt || nowIso;
  NOTIFICATION_RUNTIME.firstRegistrationAt = createdAt;
  await setDoc(deviceDocRef(currentUser.uid, D.settings.deviceId), {
    deviceId: D.settings.deviceId,
    platform: notificationPlatformLabel(),
    createdAt,
    updatedAt: serverTimestamp(),
    permission: NOTIFICATION_RUNTIME.permission,
    standalone: isStandaloneApp(),
    token: update.token ?? NOTIFICATION_RUNTIME.token ?? '',
    active: update.active ?? false,
    notificationsEnabled: !!D.settings.notificationsEnabled,
    badgeEnabled: !!D.settings.badgeEnabled,
    lastRegistrationAt: update.lastRegistrationAt || NOTIFICATION_RUNTIME.lastRegistrationAt || '',
    lastTokenRefreshAttemptAt: NOTIFICATION_RUNTIME.lastAttemptAt || '',
    lastError: update.lastError ?? NOTIFICATION_RUNTIME.registrationError ?? ''
  }, { merge: true });
}
async function registerDeviceTokenWithBackend(token) {
  if (!currentUser || !token) return;
  await apiFetch('./api/push/register-device', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.uid,
      deviceId: D.settings.deviceId,
      token,
      platform: notificationPlatformLabel(),
      permission: NOTIFICATION_RUNTIME.permission,
      standalone: isStandaloneApp(),
      active: true,
      badgeEnabled: !!D.settings.badgeEnabled,
      lastRegistrationAt: NOTIFICATION_RUNTIME.lastRegistrationAt || new Date().toISOString()
    })
  }).then(async (res) => {
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || 'register_device_failed');
    }
  });
}
async function unregisterCurrentDevice({ clearToken = false } = {}) {
  if (NOTIFICATION_RUNTIME.token && messagingClient && clearToken) {
    try { await deleteToken(messagingClient); } catch (err) { console.error('FCM token delete failed', err); }
  }
  if (currentUser) {
    await apiFetch('./api/push/unregister-device', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.uid,
        deviceId: D.settings.deviceId
      })
    }).catch((err) => console.error('Push unregister failed', err));
    await writeDeviceRegistration({ active: false, token: clearToken ? '' : NOTIFICATION_RUNTIME.token, lastError: '' });
  }
  if (clearToken) NOTIFICATION_RUNTIME.token = '';
  syncNotificationUI();
}
function reminderDateLabel(iso, baseDate = todayStr()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString('pl-PL', { hour:'2-digit', minute:'2-digit' });
  if (date === baseDate) return time;
  if (date === isoDateOffset(baseDate, 1)) return `jutro ${time}`;
  return `${d.toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit' })} ${time}`;
}
function reminderChipHTML(task) {
  if (!task?.reminderEnabled || !task.remindAt) return '';
  const due = new Date(task.remindAt).getTime();
  const isDue = Number.isFinite(due) && due <= Date.now() && !task.done;
  return `<div class="daily-task-chip-row"><span class="daily-reminder-chip ${isDue ? 'is-due' : 'is-on'}">przypomnienie ${escapeHtml(reminderDateLabel(task.remindAt, task.date || todayStr()))}</span></div>`;
}
function defaultReminderTime() {
  return D.settings.eveningReminderTime || '19:00';
}
function syncTaskReminderForm(prefix) {
  const enabled = document.getElementById(`${prefix}-task-reminder-enabled`)?.checked;
  const fields = document.getElementById(`${prefix}-task-reminder-fields`);
  const dateEl = document.getElementById(`${prefix}-task-reminder-date`);
  const timeEl = document.getElementById(`${prefix}-task-reminder-time`);
  const taskDate = document.getElementById(`${prefix}-task-date`)?.value || todayStr();
  if (fields) fields.style.display = enabled ? '' : 'none';
  if (enabled) {
    if (dateEl && !dateEl.value) dateEl.value = taskDate;
    if (timeEl && !timeEl.value) timeEl.value = defaultReminderTime();
  }
}
function resetTaskReminderForm(prefix) {
  const enabled = document.getElementById(`${prefix}-task-reminder-enabled`);
  const dateEl = document.getElementById(`${prefix}-task-reminder-date`);
  const timeEl = document.getElementById(`${prefix}-task-reminder-time`);
  if (enabled) enabled.checked = false;
  if (dateEl) dateEl.value = '';
  if (timeEl) timeEl.value = '';
  syncTaskReminderForm(prefix);
}
function collectTaskReminderFromForm(prefix, fallbackDate) {
  const enabled = !!document.getElementById(`${prefix}-task-reminder-enabled`)?.checked;
  if (!enabled) return { reminderEnabled:false, remindAt:'', reminderSentAt:'', reminderDismissedAt:'' };
  const date = document.getElementById(`${prefix}-task-reminder-date`)?.value || fallbackDate || todayStr();
  const time = document.getElementById(`${prefix}-task-reminder-time`)?.value || defaultReminderTime();
  const parsed = new Date(`${date}T${time}`);
  if (Number.isNaN(parsed.getTime())) return { reminderEnabled:false, remindAt:'', reminderSentAt:'', reminderDismissedAt:'' };
  return { reminderEnabled:true, remindAt: parsed.toISOString(), reminderSentAt:'', reminderDismissedAt:'' };
}
function taskReminderIsPending(task) {
  if (!D.settings.taskReminderEnabled) return false;
  if (!task?.reminderEnabled || !task.remindAt || task.done || task.reminderDismissedAt) return false;
  const due = new Date(task.remindAt).getTime();
  if (!Number.isFinite(due)) return false;
  return due <= Date.now() && !task.reminderSentAt;
}
function clearReminderTimers() {
  reminderTimers.forEach(id => clearTimeout(id));
  reminderTimers.clear();
}
function scheduleReminderTimers() {
  clearReminderTimers();
  scheduleDayBoundaryRefresh();
  flushDueTaskReminders();
  if (!D.settings.notificationsEnabled || !notificationsAllowed()) return;
  visibleDailyTasks().forEach(task => {
    if (!task?.reminderEnabled || !task.remindAt || task.done || task.reminderSentAt || task.reminderDismissedAt) return;
    const diff = new Date(task.remindAt).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0 || diff > 2147483647) return;
    reminderTimers.set(`task-${task.id}`, window.setTimeout(() => triggerTaskReminder(task.id), diff));
  });
  scheduleJournalReminderTimers();
  scheduleEveningOpenTasksReminder();
}
function scheduleDayBoundaryRefresh() {
  const next = new Date();
  next.setHours(24, 0, 5, 0);
  const diff = next.getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0 || diff > 2147483647) return;
  reminderTimers.set('day-boundary', window.setTimeout(() => {
    maybeRollDailyTasks();
    prepJournalDefaults();
    scheduleBadgeSync();
    scheduleReminderTimers();
    renderCurrentPage();
  }, diff));
}
function scheduleJournalReminderTimers() {
  if (!D.settings.journalReminderEnabled) return;
  const today = localDateString();
  if (currentJournalEntry(today)) return;
  const primaryAt = notificationTimeForDate(today, D.settings.journalReminderTime || '21:30');
  const primaryDiff = primaryAt.getTime() - Date.now();
  if (primaryDiff > 0 && primaryDiff <= 2147483647) {
    reminderTimers.set('journal-primary', window.setTimeout(() => triggerJournalReminder('primary'), primaryDiff));
  }
  if (!D.settings.journalReminderFollowupEnabled) return;
  const followupAt = notificationTimeForDate(today, D.settings.journalReminderFollowupTime || '22:30');
  const followupDiff = followupAt.getTime() - Date.now();
  if (followupDiff > 0 && followupDiff <= 2147483647) {
    reminderTimers.set('journal-followup', window.setTimeout(() => triggerJournalReminder('followup'), followupDiff));
  }
}
function flushDueTaskReminders() {
  if (!D.settings.notificationsEnabled || !D.settings.taskReminderEnabled || !notificationsAllowed()) return;
  visibleDailyTasks().forEach(task => {
    if (taskReminderIsPending(task)) triggerTaskReminder(task.id);
  });
}
function notificationTimeForDate(date, timeValue) {
  const [hours, minutes] = String(timeValue || '').split(':').map(Number);
  const target = new Date(`${date}T12:00:00`);
  target.setHours(Number.isFinite(hours) ? hours : 21, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return target;
}
function scheduleEveningOpenTasksReminder() {
  if (!D.settings.eveningReminderEnabled) return;
  const target = notificationTimeForDate(todayStr(), D.settings.eveningReminderTime || '19:00');
  let diff = target.getTime() - Date.now();
  if (diff <= 0) {
    target.setDate(target.getDate() + 1);
    diff = target.getTime() - Date.now();
  }
  if (diff > 2147483647) return;
  reminderTimers.set('evening-open-tasks', window.setTimeout(triggerEveningOpenTasksReminder, diff));
}
function triggerTaskReminder(taskId) {
  const task = visibleDailyTasks().find(item => String(item.id) === String(taskId));
  if (!taskReminderIsPending(task)) return;
  task.reminderSentAt = new Date().toISOString();
  const project = task.projectId ? visibleProjects().find(p => p.id === task.projectId) : null;
  new Notification('Przypomnienie', {
    body: project ? `${task.text} · projekt: ${project.name}` : task.text,
    tag: `task-${task.id}`,
    data: { url: `./?page=${task.date > todayStr() ? 'upcoming' : 'daily'}`, page: task.date > todayStr() ? 'upcoming' : 'daily', taskId: task.id }
  });
  save({ entity:'dailyTask', id:task.id, reason:'daily:reminder-local' });
  renderCurrentPage();
}
function triggerJournalReminder(type = 'primary') {
  if (!D.settings.notificationsEnabled || !D.settings.journalReminderEnabled || !notificationsAllowed()) return;
  const today = localDateString();
  if (currentJournalEntry(today)) return;
  const body = type === 'followup'
    ? 'Dzisiejszy wpis w dzienniku jest jeszcze pusty.'
    : 'Dodaj wpis do dziennika na dziś.';
  new Notification('Dziennik', {
    body,
    tag: `journal-${today}-${type}`,
    data: { url: './?page=journal', page: 'journal' }
  });
}
function triggerEveningOpenTasksReminder() {
  const open = visibleDailyTasks().filter(task => task.date === todayStr() && !task.done);
  if (open.length && D.settings.notificationsEnabled && D.settings.taskReminderEnabled && D.settings.eveningReminderEnabled && notificationsAllowed()) {
    new Notification('Masz otwarte zadania na dziś', {
      body: open.length === 1 ? 'Na dziś została jeszcze jedna rzecz do domknięcia.' : `Masz jeszcze ${open.length} otwarte zadania na dziś.`,
      tag: `open-tasks-${todayStr()}`,
      data: { url: './?page=daily', page: 'daily' }
    });
  }
  scheduleReminderTimers();
}
function buildReminderSchedule() {
  if (!currentUser || !D.settings.notificationsEnabled) return [];
  const reminders = [];
  if (D.settings.taskReminderEnabled) {
    visibleDailyTasks()
      .filter(task => task.reminderEnabled && task.remindAt && !task.done && !task.reminderDismissedAt)
      .forEach(task => {
        const project = task.projectId ? visibleProjects().find((item) => item.id === task.projectId) : null;
        reminders.push({
          id: `task-${task.id}-${task.remindAt}`,
          kind: 'task',
          remindAt: task.remindAt,
          title: 'Przypomnienie',
          body: project ? `${task.text} · projekt: ${project.name}` : task.text,
          tag: `task-${task.id}`,
          badgeCount: openThingsBadgeCount(),
          data: {
            url: `./?page=${task.date > todayStr() ? 'upcoming' : 'daily'}`,
            page: task.date > todayStr() ? 'upcoming' : 'daily',
            taskId: task.id
          }
        });
      });
  }
  const today = todayStr();
  if (D.settings.eveningReminderEnabled && openTasksTodayCount() > 0) {
    reminders.push({
      id: `evening-open-${today}`,
      kind: 'evening-open',
      remindAt: notificationTimeForDate(today, D.settings.eveningReminderTime || '19:00').toISOString(),
      title: 'Otwarte zadania',
      body: openTasksTodayCount() === 1 ? 'Masz jeszcze otwarte zadanie na dziś.' : 'Masz jeszcze otwarte zadania na dziś.',
      tag: `open-tasks-${today}`,
      badgeCount: openThingsBadgeCount(),
      data: { url: './?page=daily', page: 'daily' }
    });
  }
  return reminders;
}
function buildJournalReminderConfig() {
  const timeZone = userTimeZone();
  return {
    notificationsEnabled: !!D.settings.notificationsEnabled,
    journalReminderEnabled: !!D.settings.journalReminderEnabled,
    journalReminderTime: D.settings.journalReminderTime || '21:30',
    journalReminderFollowupEnabled: false,
    journalReminderFollowupTime: '',
    timezone: timeZone,
    journalDates: [...new Set(visibleJournalEntries().map(entry => entry?.date).filter(Boolean))],
    updatedAt: new Date().toISOString()
  };
}
async function syncReminderScheduleToBackend() {
  if (!currentUser) return;
  await apiFetch('./api/reminders/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.uid,
      reminders: buildReminderSchedule(),
      journalConfig: buildJournalReminderConfig()
    })
  }).catch((err) => console.error('Reminder sync failed', err));
}
function scheduleReminderSync() {
  clearTimeout(reminderSyncTimer);
  reminderSyncTimer = window.setTimeout(() => {
    syncReminderScheduleToBackend().catch((err) => console.error('Reminder sync failed', err));
  }, 180);
}
async function syncMessagingRegistration({ force = false, requestPermission = false } = {}) {
  NOTIFICATION_RUNTIME.lastAttemptAt = new Date().toISOString();
  NOTIFICATION_RUNTIME.registrationError = '';
  syncNotificationUI();
  const preflight = await checkNotificationEnvironment({ requirePermission: true });
  if (!preflight.ok) {
    D.settings.notificationsEnabled = false;
    save({ reason:'settings:notifications' });
    setNotificationRuntimeStatus(preflight.code, preflight.label);
    return false;
  }
  if (!validateNotificationConfig()) {
    D.settings.notificationsEnabled = false;
    save({ reason:'settings:notifications' });
    await writeDeviceRegistration({ active: false, token: '', lastError: 'missing_fcm_vapid_key' }).catch(() => {});
    return false;
  }
  if (!currentUser) {
    setNotificationRuntimeStatus('not_authenticated', 'Powiadomienia wymagają zalogowanego konta.');
    return false;
  }
  if (requestPermission && Notification.permission === 'default') {
    NOTIFICATION_RUNTIME.permission = await Notification.requestPermission();
  }
  collectNotificationEnvironment();
  if (!notificationsAllowed()) {
    D.settings.notificationsEnabled = false;
    save({ reason:'settings:notifications' });
    await unregisterCurrentDevice();
    setNotificationRuntimeStatus(Notification.permission === 'denied' ? 'permission_denied' : 'permission_missing', Notification.permission === 'denied' ? 'permission denied' : 'brak zgody');
    return false;
  }
  const messaging = await initMessagingClient();
  if (!messaging) return false;
  let registration;
  try {
    registration = await registerMessagingServiceWorker();
  } catch (err) {
    D.settings.notificationsEnabled = false;
    save({ reason:'settings:notifications' });
    setNotificationRuntimeStatus('service_worker_registration_failed', shortError(err));
    return false;
  }
  try {
    const vapidKey = await loadNotificationConfig();
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration
    });
    if (!token) {
      throw new Error('missing_fcm_token');
    }
    NOTIFICATION_RUNTIME.token = token;
    NOTIFICATION_RUNTIME.lastRegistrationAt = new Date().toISOString();
    NOTIFICATION_RUNTIME.registrationError = '';
    D.settings.notificationsEnabled = true;
    save({ reason:'settings:notifications' });
    await writeDeviceRegistration({
      active: false,
      token,
      lastRegistrationAt: NOTIFICATION_RUNTIME.lastRegistrationAt,
      lastError: ''
    });
    await registerDeviceTokenWithBackend(token);
    await writeDeviceRegistration({
      active: true,
      token,
      lastRegistrationAt: NOTIFICATION_RUNTIME.lastRegistrationAt,
      lastError: ''
    });
    if (force) await syncReminderScheduleToBackend();
    setNotificationRuntimeStatus('token_saved_successfully');
    return true;
  } catch (err) {
    console.error('FCM registration failed', err);
    await writeDeviceRegistration({
      active: false,
      token: NOTIFICATION_RUNTIME.token,
      lastRegistrationAt: NOTIFICATION_RUNTIME.lastRegistrationAt,
      lastError: shortError(err)
    }).catch(() => {});
    setNotificationRuntimeStatus('fcm_token_request_failed', shortError(err));
    return false;
  }
}
function syncNotificationUI() {
  collectNotificationEnvironment();
  const chip = document.getElementById('notification-state-chip');
  const note = document.getElementById('notification-support-note');
  const permission = document.getElementById('notification-permission-text');
  const standalone = document.getElementById('notification-standalone-text');
  const swText = document.getElementById('notification-sw-text');
  const token = document.getElementById('notification-token-text');
  const refresh = document.getElementById('notification-refresh-text');
  const device = document.getElementById('notification-device-text');
  const errorText = document.getElementById('notification-error-text');
  const enableBtn = document.getElementById('notification-enable-btn');
  const refreshBtn = document.getElementById('notification-refresh-btn');
  const testBtn = document.getElementById('notification-test-btn');
  const visibleTestBtn = document.getElementById('visible-notification-test-btn');
  const journalFirstTestBtn = document.getElementById('journal-reminder-test-first-btn');
  const journalSecondTestBtn = document.getElementById('journal-reminder-test-second-btn');
  const tokenReady = !!(D.settings.notificationsEnabled && NOTIFICATION_RUNTIME.token && ['token_saved_successfully', 'aktywne'].includes(NOTIFICATION_RUNTIME.registrationStatus));
  const statusCopy = {
    token_saved_successfully: 'Token zapisany. Urządzenie jest aktywne.',
    aktywne: 'Token zapisany. Urządzenie jest aktywne.',
    insecure_context: 'Wymagany HTTPS.',
    unsupported_browser: 'Unsupported browser.',
    service_worker_unsupported: 'Brak Service Worker API.',
    push_unsupported: 'Brak Push API.',
    not_installed_home_screen: 'Na iPhonie wymagana jest appka z ekranu głównego.',
    fcm_unavailable: 'FCM niedostępne w tej przeglądarce.',
    fcm_support_check_failed: 'Nie udało się sprawdzić FCM.',
    permission_denied: 'Permission denied.',
    permission_missing: 'Brak zgody systemowej.',
    service_worker_registration_failed: 'Service worker registration failed.',
    fcm_token_request_failed: 'FCM token request failed.',
    missing_fcm_vapid_key: 'Konfiguracja Web Push jest niekompletna: brak klucza VAPID.',
    not_authenticated: 'Wymagane zalogowane konto.',
    'brak zgody': 'Brak zgody systemowej.',
    'niedostępne': 'Powiadomienia niedostępne.'
  };
  if (chip) {
    chip.classList.remove('is-on', 'is-off');
    if (tokenReady) {
      chip.classList.add('is-on');
      chip.textContent = statusCopy.token_saved_successfully;
    } else if (NOTIFICATION_RUNTIME.homeScreenRequired) {
      chip.classList.add('is-off');
      chip.textContent = statusCopy.not_installed_home_screen;
    } else if (!NOTIFICATION_RUNTIME.secureContext) {
      chip.classList.add('is-off');
      chip.textContent = statusCopy.insecure_context;
    } else if (!NOTIFICATION_RUNTIME.serviceWorkerApi || !NOTIFICATION_RUNTIME.pushApi || !NOTIFICATION_RUNTIME.notificationApi) {
      chip.classList.add('is-off');
      chip.textContent = 'Unsupported browser.';
    } else if (NOTIFICATION_RUNTIME.registrationStatus === 'fcm_token_request_failed') {
      chip.classList.add('is-off');
      chip.textContent = 'Permission granted, ale token nie został wygenerowany.';
    } else if (NOTIFICATION_RUNTIME.registrationStatus === 'missing_fcm_vapid_key') {
      chip.classList.add('is-off');
      chip.textContent = statusCopy.missing_fcm_vapid_key;
    } else if (NOTIFICATION_RUNTIME.registrationStatus === 'service_worker_registration_failed') {
      chip.classList.add('is-off');
      chip.textContent = statusCopy.service_worker_registration_failed;
    } else if (!NOTIFICATION_RUNTIME.supported && canUseNotifications()) {
      chip.classList.add('is-off');
      chip.textContent = statusCopy.fcm_unavailable;
    } else if (!canUseNotifications()) {
      chip.classList.add('is-off');
      chip.textContent = 'Unsupported browser.';
    } else if (NOTIFICATION_RUNTIME.permission === 'granted') {
      chip.textContent = 'Permission granted, ale tokenu nie ma.';
    } else if (NOTIFICATION_RUNTIME.permission === 'denied') {
      chip.classList.add('is-off');
      chip.textContent = statusCopy.permission_denied;
    } else {
      chip.textContent = statusCopy[NOTIFICATION_RUNTIME.registrationStatus] || 'Rejestracja nieaktywna.';
    }
  }
  if (note) {
    note.textContent = NOTIFICATION_RUNTIME.registrationStatus === 'missing_fcm_vapid_key'
      ? 'Konfiguracja Web Push jest niekompletna: brak klucza VAPID.'
      : NOTIFICATION_RUNTIME.homeScreenRequired
      ? 'Na iPhonie otwórz Focus Huba z ikony na ekranie głównym. W zwykłej karcie Safari push nie będzie rejestrowany.'
      : (tokenReady
        ? 'Powiadomienia używają standardowego zachowania systemu.'
        : 'Do działania potrzebne są: HTTPS, service worker, Push API, zgoda systemowa i zapisany token FCM.');
  }
  if (permission) permission.textContent = notificationPermissionLabel(NOTIFICATION_RUNTIME.permission || 'default');
  if (standalone) standalone.textContent = NOTIFICATION_RUNTIME.standalone ? 'Zainstalowana / standalone' : (NOTIFICATION_RUNTIME.ios ? 'Safari tab' : 'Przeglądarka');
  if (swText) swText.textContent = NOTIFICATION_RUNTIME.messagingServiceWorkerReady ? 'Messaging worker działa' : (NOTIFICATION_RUNTIME.appServiceWorkerReady ? 'App shell działa, messaging nie' : 'Brak rejestracji');
  if (token) token.textContent = NOTIFICATION_RUNTIME.token ? 'Zarejestrowany' : 'Brak tokenu';
  if (refresh) refresh.textContent = formatSavedAt(NOTIFICATION_RUNTIME.lastRegistrationAt);
  if (device) device.textContent = tokenReady ? 'Aktywne' : 'Nieaktywne';
  if (errorText) errorText.textContent = NOTIFICATION_RUNTIME.registrationError || '—';
  if (enableBtn) enableBtn.disabled = !NOTIFICATION_RUNTIME.secureContext || !NOTIFICATION_RUNTIME.notificationApi || !NOTIFICATION_RUNTIME.serviceWorkerApi || !NOTIFICATION_RUNTIME.pushApi || NOTIFICATION_RUNTIME.homeScreenRequired;
  if (refreshBtn) refreshBtn.disabled = !currentUser || !NOTIFICATION_RUNTIME.secureContext || !NOTIFICATION_RUNTIME.notificationApi || !NOTIFICATION_RUNTIME.serviceWorkerApi || !NOTIFICATION_RUNTIME.pushApi || NOTIFICATION_RUNTIME.homeScreenRequired;
  if (testBtn) testBtn.disabled = !tokenReady;
  if (visibleTestBtn) visibleTestBtn.disabled = !tokenReady;
  if (journalFirstTestBtn) journalFirstTestBtn.disabled = !currentUser;
  if (journalSecondTestBtn) journalSecondTestBtn.disabled = !currentUser;
  setText('debug-standalone', yesNo(NOTIFICATION_RUNTIME.standalone));
  setText('debug-permission', NOTIFICATION_RUNTIME.permission || 'default');
  setText('debug-service-worker', yesNo(NOTIFICATION_RUNTIME.appServiceWorkerReady));
  setText('debug-messaging-worker', yesNo(NOTIFICATION_RUNTIME.messagingServiceWorkerReady));
  setText('debug-push-api', yesNo(NOTIFICATION_RUNTIME.pushApi));
  setText('debug-fcm', yesNo(NOTIFICATION_RUNTIME.supported));
  setText('debug-vapid', yesNo(looksLikeVapidPublicKey(NOTIFICATION_RUNTIME.vapidKey || firebaseConfig.fcmVapidKey)));
  setText('debug-token', yesNo(!!NOTIFICATION_RUNTIME.token));
  setText('debug-last-attempt', formatSavedAt(NOTIFICATION_RUNTIME.lastAttemptAt));
  setText('debug-last-error', NOTIFICATION_RUNTIME.registrationError || '—');
  renderJournalReminderDebug();
  syncInstallUI();
}
function renderJournalReminderDebug(debug = JOURNAL_REMINDER_DEBUG) {
  const timeZone = debug.timezone || userTimeZone();
  const localDate = debug.computedLocalDate || localDateString(new Date(), timeZone);
  const entryExists = typeof debug.journalEntryExistsToday === 'boolean'
    ? debug.journalEntryExistsToday
    : !!currentJournalEntry(localDate);
  setText('debug-journal-enabled', yesNo(!!D.settings.journalReminderEnabled));
  setText('debug-journal-first-time', D.settings.journalReminderTime || '21:30');
  setText('debug-journal-followup-enabled', yesNo(!!D.settings.journalReminderFollowupEnabled));
  setText('debug-journal-followup-time', D.settings.journalReminderFollowupTime || '22:30');
  setText('debug-journal-timezone', timeZone);
  setText('debug-journal-local-date', localDate);
  setText('debug-journal-entry-exists', yesNo(entryExists));
  setText('debug-journal-first-eligible', yesNo(!!debug.firstReminderEligible));
  setText('debug-journal-first-handled', yesNo(!!debug.firstReminderHandledToday));
  setText('debug-journal-first-push-at', formatSavedAt(debug.firstReminderPushRequestedAt || debug.firstReminderAttemptedAt));
  setText('debug-journal-first-result', debug.firstReminderResult || '—');
  setText('debug-journal-first-skip', debug.firstReminderSkipReason || '—');
  setText('debug-journal-second-eligible', yesNo(!!debug.secondReminderEligible));
  setText('debug-journal-second-handled', yesNo(!!debug.secondReminderHandledToday));
  setText('debug-journal-second-push-at', formatSavedAt(debug.secondReminderPushRequestedAt || debug.secondReminderAttemptedAt));
  setText('debug-journal-second-result', debug.secondReminderResult || '—');
  setText('debug-journal-second-skip', debug.secondReminderSkipReason || '—');
  setText('debug-journal-scheduler-send', yesNo(!!debug.schedulerDecidedToSend));
  setText('debug-journal-backend-auth', yesNo(!!debug.backendAuthAvailable));
  setText('debug-journal-backend-auth-error', debug.backendAuthError || '—');
  setText('debug-journal-push-executed', yesNo(!!debug.pushRequestExecuted));
  setText('debug-journal-push-accepted', yesNo(!!debug.pushBackendAccepted));
  setText('debug-journal-push-status', debug.lastPushRequestStatus || '—');
  setText('debug-journal-push-response', debug.lastPushRequestResponse || '—');
  setText('debug-journal-push-error', debug.lastPushRequestError || '—');
  setText('debug-journal-sw-received', debug.serviceWorkerReceivedPayload || 'unknown');
  setText('debug-journal-visible-shown', debug.visibleNotificationShown || 'unknown');
  setText('debug-journal-last-attempt', formatSavedAt(debug.lastJournalReminderAttempt));
  setText('debug-journal-last-result', debug.lastJournalReminderResult || '—');
  setText('debug-journal-last-error', debug.lastJournalReminderError || '—');
}
function mergeJournalReminderDebug(debug = {}) {
  Object.assign(JOURNAL_REMINDER_DEBUG, debug || {});
  renderJournalReminderDebug();
}
function readNotificationDebugDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open('focus-hub-notification-debug', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('events', { keyPath: 'id' });
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('events', 'readonly');
      const getReq = tx.objectStore('events').get('latest');
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    };
  });
}
async function refreshWorkerNotificationDebug() {
  const latest = await readNotificationDebugDb();
  if (!latest) return;
  mergeJournalReminderDebug({
    serviceWorkerReceivedPayload: latest.serviceWorkerReceivedPayload || 'unknown',
    visibleNotificationShown: latest.visibleNotificationShown || 'unknown'
  });
}
async function refreshPushBackendDebug() {
  try {
    const res = await apiFetch('./api/push/debug');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.backendAuthError || data?.error || 'push_backend_debug_failed');
    mergeJournalReminderDebug({
      backendAuthAvailable: !!data.backendAuthAvailable,
      backendAuthError: data.backendAuthError || ''
    });
  } catch (err) {
    mergeJournalReminderDebug({
      backendAuthAvailable: false,
      backendAuthError: shortError(err)
    });
  }
}
async function refreshJournalReminderDebug() {
  if (!currentUser) {
    renderJournalReminderDebug();
    return;
  }
  try {
    await syncReminderScheduleToBackend();
    const res = await apiFetch('./api/reminders/debug', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.uid })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'journal_debug_failed');
    mergeJournalReminderDebug(data.debug || {});
    await refreshPushBackendDebug();
    await refreshWorkerNotificationDebug();
  } catch (err) {
    mergeJournalReminderDebug({
      lastJournalReminderError: shortError(err)
    });
  }
}
function setTaskReminder(id) {
  const task = visibleDailyTasks().find(item => String(item.id) === String(id));
  if (!task || task.done) return;
  const current = task.remindAt ? new Date(task.remindAt) : null;
  const currentDate = current && !Number.isNaN(current.getTime()) ? current.toISOString().slice(0,10) : (task.date || todayStr());
  const currentTime = current && !Number.isNaN(current.getTime()) ? current.toTimeString().slice(0,5) : defaultReminderTime();
  const next = prompt('Przypomnienie: RRRR-MM-DD GG:MM', `${currentDate} ${currentTime}`);
  if (next === null) return;
  const parsed = new Date(next.trim().replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    toast('Nie udało się odczytać daty przypomnienia.');
    return;
  }
  task.reminderEnabled = true;
  task.remindAt = parsed.toISOString();
  task.reminderSentAt = '';
  task.reminderDismissedAt = '';
  save({ entity:'dailyTask', id:task.id, reason:'daily:reminder-set' });
  renderCurrentPage();
  toast('Przypomnienie ustawione.');
}
function clearTaskReminder(id) {
  const task = visibleDailyTasks().find(item => String(item.id) === String(id));
  if (!task) return;
  task.reminderEnabled = false;
  task.reminderDismissedAt = new Date().toISOString();
  task.reminderSentAt = '';
  save({ entity:'dailyTask', id:task.id, reason:'daily:reminder-clear' });
  renderCurrentPage();
  toast('Przypomnienie wyłączone.');
}
async function toggleSystemNotifications(enabled) {
  if (enabled) {
    const ok = await requestNotificationAccess();
    const input = document.getElementById('settings-notifications-enabled');
    if (input) input.checked = ok;
    return;
  }
  D.settings.notificationsEnabled = false;
  save({ reason:'settings:notifications' });
  await unregisterCurrentDevice();
  await syncReminderScheduleToBackend();
  renderAccount();
  toast('Powiadomienia zostały wyłączone.');
}
async function requestNotificationAccess() {
  const supported = await initMessagingClient();
  if (!supported) {
    toast('Powiadomienia są niedostępne na tym urządzeniu.');
    return false;
  }
  const ok = await syncMessagingRegistration({ force: true, requestPermission: true });
  if (ok) {
    toast('Powiadomienia zostały włączone.');
  } else {
    toast(Notification.permission === 'denied' ? 'Powiadomienia są zablokowane.' : 'Nie udało się włączyć powiadomień.');
  }
  renderAccount();
  return ok;
}
async function refreshNotificationRegistration() {
  if (!currentUser) {
    toast('Zaloguj się, żeby odświeżyć rejestrację powiadomień.');
    return;
  }
  if (!notificationsAllowed()) {
    toast('Najpierw włącz zgodę na powiadomienia.');
    return;
  }
  const ok = await syncMessagingRegistration({ force: true, requestPermission: false });
  toast(ok ? 'Rejestracja powiadomień odświeżona.' : 'Nie udało się odświeżyć rejestracji.');
}
async function sendNotificationTest() {
  if (!currentUser) {
    toast('Zaloguj się, żeby wysłać test powiadomień.');
    return;
  }
  if (!notificationsAllowed()) {
    toast('Test wymaga udzielonej zgody na powiadomienia.');
    return;
  }
  if (!D.settings.notificationsEnabled || !NOTIFICATION_RUNTIME.token || !['token_saved_successfully', 'aktywne'].includes(NOTIFICATION_RUNTIME.registrationStatus)) {
    toast('Test wymaga aktywnego urządzenia i zapisanego tokenu FCM.');
    syncNotificationUI();
    return;
  }
  try {
    const res = await apiFetch('./api/push/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.uid,
        deviceId: D.settings.deviceId,
        title: 'Focus Hub',
        body: 'To jest testowe powiadomienie.'
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.details || data?.error || 'push_test_failed');
    toast('Wysłano test powiadomienia.');
  } catch (err) {
    console.error(err);
    toast('Nie udało się wysłać testowego powiadomienia.');
  }
}
async function sendVisibleNotificationTest() {
  if (!currentUser) {
    toast('Zaloguj się, żeby wysłać widoczny test.');
    return;
  }
  if (!D.settings.notificationsEnabled || !NOTIFICATION_RUNTIME.token || !['token_saved_successfully', 'aktywne'].includes(NOTIFICATION_RUNTIME.registrationStatus)) {
    toast('Widoczny test wymaga aktywnego urządzenia i zapisanego tokenu FCM.');
    syncNotificationUI();
    return;
  }
  try {
    const res = await apiFetch('./api/push/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.uid,
        deviceId: D.settings.deviceId,
        title: 'Focus Hub',
        body: 'Widoczny test powiadomienia.',
        tag: `visible-test-${Date.now()}`
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.details || data?.error || 'visible_push_test_failed');
    mergeJournalReminderDebug({
      pushRequestExecuted: true,
      backendAuthAvailable: data.backendAuthAvailable !== false,
      backendAuthError: data.backendAuthAvailable === false ? (data.details || data.error || '') : '',
      pushBackendAccepted: !!data.push?.ok,
      lastPushRequestStatus: data.push?.ok ? 'success' : 'failure',
      lastPushRequestResponse: JSON.stringify(data.push || {}).slice(0, 500),
      lastPushRequestError: '',
      serviceWorkerReceivedPayload: 'unknown',
      visibleNotificationShown: 'unknown'
    });
    window.setTimeout(refreshWorkerNotificationDebug, 1500);
    toast('Wysłano widoczny test powiadomienia.');
  } catch (err) {
    mergeJournalReminderDebug({
      pushRequestExecuted: true,
      backendAuthAvailable: false,
      backendAuthError: shortError(err),
      pushBackendAccepted: false,
      lastPushRequestStatus: 'failure',
      lastPushRequestError: shortError(err)
    });
    toast('Nie udało się wysłać widocznego testu.');
  }
}
async function testJournalReminderNow(phase = 'first') {
  if (!currentUser) {
    toast('Zaloguj się, żeby uruchomić test dziennika.');
    return;
  }
  const selectedPhase = phase === 'second' ? 'second' : 'first';
  try {
    await syncReminderScheduleToBackend();
    const res = await apiFetch('./api/reminders/test-journal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.uid, phase: selectedPhase })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'journal_reminder_test_failed');
    mergeJournalReminderDebug(data.debug || {});
    window.setTimeout(refreshWorkerNotificationDebug, 1500);
    const result = data.result?.result || data.debug?.lastJournalReminderResult || '';
    if (result === `${selectedPhase}_push_requested`) toast(selectedPhase === 'second' ? 'Wysłano żądanie push dla drugiego przypomnienia.' : 'Wysłano żądanie push dla pierwszego przypomnienia.');
    else if (result === `${selectedPhase}_skipped_entry_exists`) toast('Dziennik na dziś ma już wpis.');
    else if (result === `${selectedPhase}_disabled`) toast('Przypomnienia o dzienniku są wyłączone.');
    else if (result === `${selectedPhase}_push_already_requested`) toast('Żądanie push dla tej fazy było już wykonane.');
    else if (result === `${selectedPhase}_push_failed`) toast('Żądanie push dla tej fazy nie powiodło się.');
    else toast(`Test dziennika: ${result || 'sprawdzono'}.`);
  } catch (err) {
    console.error(err);
    mergeJournalReminderDebug({
      lastJournalReminderAttempt: new Date().toISOString(),
      lastJournalReminderResult: 'error',
      lastJournalReminderError: shortError(err)
    });
    toast('Nie udało się uruchomić testu dziennika.');
  }
}
function fmtShort(s) { if(!s) return ''; return new Date(s).toLocaleDateString('pl-PL',{day:'numeric',month:'short'}); }
function daysSince(s) { if(!s) return 999; return Math.floor((Date.now() - new Date(s)) / 86400000); }
function escapeHtml(str) {
  return String(str ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
function escapeJsString(str) {
  return String(str ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}
function hasAnyData() {
  return !!(visibleProjects().length || D.pride.length || visibleJournalEntries().length || visibleDailyTasks().length || visibleRituals().length);
}
function daysSinceBackup() {
  if (!D.settings.lastBackupAt) return 999;
  return Math.floor((Date.now() - new Date(D.settings.lastBackupAt)) / 86400000);
}
function backupIsDue() {
  if (!hasAnyData()) return false;
  const every = parseInt(D.settings.backupReminderDays || 3, 10);
  if (!D.settings.lastBackupAt) return true;
  return daysSinceBackup() >= every;
}
function backupStatusLabel() {
  if (!hasAnyData()) return 'Na razie nie ma czego archiwizować.';
  if (!D.settings.lastBackupAt) return 'Nie masz jeszcze żadnej kopii zapasowej tego huba.';
  const d = daysSinceBackup();
  if (d === 0) return 'Ostatni backup: dziś.';
  if (d === 1) return 'Ostatni backup: wczoraj.';
  return `Ostatni backup: ${d} dni temu.`;
}
function fullBackupPayload() {
  return storage().exportBackup(D).payload;
}
function meaningfulDatesSet() {
  const set = new Set();
  visibleJournalEntries().forEach(j => { if (j.date) set.add(j.date); });
  visibleDailyTasks().forEach(t => { if (t.date && (t.done || t.text)) set.add(t.date); });
  visibleProjects().forEach(p => { if (p.touched) set.add(p.touched); });
  return set;
}
function meaningfulStreak() {
  const set = meaningfulDatesSet();
  let streak = 0;
  let d = new Date();
  for (let i = 0; i < 730; i++) {
    const key = d.toISOString().slice(0,10);
    if (set.has(key)) streak += 1; else break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
// ════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════
function updateSidebar() {
  const lim = D.settings.limit;
  const used = activeProjects().length;
  const viz = document.getElementById('slot-viz');
  viz.innerHTML = Array.from({length: lim}, (_,i) =>
    `<div class="slot-block ${i < used ? 'used' : ''}"></div>`
  ).join('');
  document.getElementById('slot-count').textContent = `${used} / ${lim} slotów`;
}

// ════════════════════════════════════════
// HUB
// ════════════════════════════════════════
function renderStartFinishStats() {
  const started = visibleProjects().length;
  const finished = visibleProjects().filter(p => p.status === 'done').length;
  const archived = visibleProjects().filter(p => p.status === 'archived').length;
  const open = Math.max(0, started - finished - archived);
  const rate = started ? Math.round((finished / started) * 100) : 0;
  document.getElementById('start-finish-stats').innerHTML = `
    <div class="hub-stat"><div class="hub-num">${started}</div><div class="hub-label">Zaczęte</div></div>
    <div class="hub-stat"><div class="hub-num" style="color:var(--blue);">${finished}</div><div class="hub-label">Skończone</div></div>
    <div class="hub-stat"><div class="hub-num" style="color:${rate >= 50 ? 'var(--lime)' : 'var(--amber)'};">${rate}%</div><div class="hub-label">Domknięcia</div></div>
  `;
  const note = document.getElementById('start-finish-note');
  if (!started) note.textContent = 'Brak projektów do podsumowania.';
  else if (finished >= started / 2) note.textContent = `Ukończone projekty: ${finished}. Otwarte bez finału: ${open}.`;
  else note.textContent = `Otwarte projekty bez finału: ${open}.`;
}

function renderStats() {
  if (!D.settings.showAdvancedStats) {
    const kpis = document.getElementById('stats-kpis'); if (kpis) kpis.innerHTML = '<div class="hub-stat glass-upgrade"><div class="hub-num">Ukryte</div><div class="hub-label">Włącz sekcje analityczne w Konto</div></div>';
    const summary = document.getElementById('stats-category-summary'); if (summary) summary.innerHTML = '';
    return;
  }
  const all = visibleDailyTasks();
  const done = all.filter(t => t.done).length;
  const added = all.length;
  const open = added - done;
  const rate = added ? Math.round((done / added) * 100) : 0;
  const thisWeek = dateRangeTasks(7);
  const thisMonth = dateRangeTasks(30);
  document.getElementById('stats-kpis').innerHTML = `
    <div class="hub-stat glass-upgrade"><div class="hub-num">${thisWeek.length}</div><div class="hub-label">Dodane w 7 dni</div></div>
    <div class="hub-stat glass-upgrade"><div class="hub-num" style="color:var(--blue);">${thisMonth.filter(t=>t.done).length}</div><div class="hub-label">Zrobione w 30 dni</div></div>
    <div class="hub-stat glass-upgrade"><div class="hub-num" style="color:${rate >= 70 ? 'var(--lime)' : rate >= 45 ? 'var(--amber)' : 'var(--red)'};">${rate}%</div><div class="hub-label">Domknięcie małych zadań</div></div>
    <div class="hub-stat glass-upgrade"><div class="hub-num" style="color:${open > done ? 'var(--amber)' : 'var(--lime)'};">${open}</div><div class="hub-label">Otwarte teraz</div></div>
    <div class="hub-stat glass-upgrade"><div class="hub-num">${meaningfulStreak()}</div><div class="hub-label">Streak działania</div></div>`;

  const categories = summarizeTaskCategories(all.filter(t => !t.done));
  document.getElementById('stats-category-summary').innerHTML = categories.length ? categories.map(([cat, info]) => {
    const reasons = Object.entries(info.reasons).sort((a,b) => b[1]-a[1]).slice(0,2).map(([reason,count]) => `<span class="pill-mini bad">${escapeHtml(reason)} × ${count}</span>`).join(' ');
    return `<div class="review-item"><strong>${escapeHtml(cat)}</strong><div class="review-meta">otwarte: ${info.open}</div><div class="pill-row" style="margin-top:8px;">${reasons || '<span class="pill-mini">brak oznaczonych powodów</span>'}</div></div>`;
  }).join('') : `<div class="empty-slot" style="min-height:auto;padding:18px;">Brak otwartych spraw.</div>`;

  const nudge = document.getElementById('stats-nudge');
  if (!added) { nudge.style.display='block'; nudge.className='nudge-box'; nudge.textContent='Brak zadań do podsumowania.'; }
  else if (open > done) { nudge.style.display='block'; nudge.className='nudge-box warn'; nudge.textContent=`Otwarte zadania: ${open}. Wybierz, co zrobić, przenieść albo odpuścić.`; }
  else { nudge.style.display='block'; nudge.className='nudge-box'; nudge.textContent=`Zrobione: ${done}. Otwarte: ${open}.`; }
}
function periodSummary(days) {
  const tasks = dateRangeTasks(days);
  const done = tasks.filter(t => t.done);
  const open = tasks.filter(t => !t.done);
  const reasons = {};
  open.forEach(t => { const r = t.reason || 'brak oznaczonego powodu'; reasons[r] = (reasons[r] || 0) + 1; });
  const topReasons = Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,3);
  return { tasks, done, open, topReasons };
}
function taskPills(tasks, emptyText) {
  return tasks.length
    ? tasks.slice(0, 3).map(task => `<span class="pill-mini">${escapeHtml(task.text)}</span>`).join(' ')
    : `<span class="pill-mini">${escapeHtml(emptyText)}</span>`;
}
function reviewHTML(summary) {
  if (!summary.tasks.length) return `<div class="review-item">Brak danych z ostatniego tygodnia.</div>`;
  const done = taskPills(summary.done, 'brak');
  const open = taskPills(summary.open, 'brak');
  const reasons = summary.topReasons.map(([reason,count]) => `<span class="pill-mini bad">${escapeHtml(reason)} · ${count}</span>`).join(' ') || '<span class="pill-mini">brak oznaczonych blokad</span>';
  const oldestOpen = [...summary.open].sort((a,b) => (a.date || '').localeCompare(b.date || '')).slice(0,3);
  return `
    <div class="review-item"><strong>Dowiezione (max 3)</strong><div class="pill-row" style="margin-top:8px;">${done}</div></div>
    <div class="review-item"><strong>Niedowiezione (max 3)</strong><div class="pill-row" style="margin-top:8px;">${open}</div></div>
    <div class="review-item"><strong>Co blokowało</strong><div class="pill-row" style="margin-top:8px;">${reasons}</div></div>
    <div class="review-item"><strong>Co odpuścić</strong><div class="review-meta">${oldestOpen.length ? 'Najstarsze otwarte sprawy wymagają decyzji.' : 'Brak spraw do odpuszczenia.'}</div><div class="pill-row" style="margin-top:8px;">${taskPills(oldestOpen, 'brak')}</div></div>
    <div class="review-item"><strong>Co przenieść</strong><div class="review-meta">Otwarte zadania możesz przenieść w widoku Nadchodzące / Plan.</div></div>
    <div class="review-item"><strong>Jedna korekta na następny tydzień</strong><div class="review-meta">Wpisz ją w tygodniowym review.</div></div>`;
}
function renderReview() {
  if (!D.settings.showAdvancedStats) {
    document.getElementById('review-week').innerHTML = '<div class="review-item">Review jest ukryty. Włącz go w Konto → Personalizacja.</div>';
    document.getElementById('review-month').innerHTML = '';
    document.getElementById('review-open-reasons').innerHTML = '';
    return;
  }
  const week = periodSummary(7);
  const month = periodSummary(30);
  const latestWeekly = [...(D.weeklyReview || [])].sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '')).at(0);
  const weeklyEntry = latestWeekly ? `<div class="review-item"><strong>Ostatni zapis review</strong><div class="review-meta">${escapeHtml(latestWeekly.weekKey)}</div><div style="margin-top:8px;"><strong>Dowiezione:</strong> ${escapeHtml(latestWeekly.finished)}</div><div style="margin-top:8px;"><strong>Odpuszczam:</strong> ${escapeHtml(latestWeekly.dropped)}</div><div style="margin-top:8px;"><strong>Korekta:</strong> ${escapeHtml(latestWeekly.goal)}</div></div>` : '';
  document.getElementById('review-week').innerHTML = weeklyEntry + reviewHTML(week);
  document.getElementById('review-month').innerHTML = reviewHTML(month);
  const open = visibleDailyTasks().filter(t => !t.done).slice().sort((a,b) => (a.date || '').localeCompare(b.date || '')).slice(0,10);
  document.getElementById('review-open-reasons').innerHTML = open.length ? open.map(t => `<div class="review-item"><strong>${escapeHtml(t.text)}</strong><div class="review-meta">${escapeHtml(t.date)} · ${escapeHtml(taskCategory(t))} · ${escapeHtml(t.reason || 'brak oznaczonego powodu')}</div></div>`).join('') : `<div class="review-item">Nie ma teraz otwartych małych zadań.</div>`;
}
function saveWeeklyReview() {
  const finished = document.getElementById('weekly-review-finished')?.value.trim() || '';
  const dropped = document.getElementById('weekly-review-drop')?.value.trim() || '';
  const goal = document.getElementById('weekly-review-goal')?.value.trim() || '';
  if (!finished || !dropped || !goal) {
    toast('Uzupełnij trzy pola review.');
    return;
  }
  const weekKey = currentWeekKey(new Date());
  const existing = (D.weeklyReview || []).find(entry => entry.weekKey === weekKey);
  const payload = { weekKey, finished, dropped, goal, createdAt: nowIso(), updatedAt: nowIso(), updatedByDevice: D.settings.deviceId || '' };
  if (existing) Object.assign(existing, payload);
  else (D.weeklyReview ||= []).push({ id: String(Date.now()), ...payload });
  save({ reason:'review:update' });
  closeModal('modal-weekly-review');
  renderReview();
  toast('Zapisano review tygodnia.');
}

function exportFullBackup() {
  D.settings.lastBackupAt = new Date().toISOString();
  D = normalizeAppState(D);
  const backup = storage().exportBackup(D);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(backup.blob);
  a.download = backup.filename;
  a.click();
  URL.revokeObjectURL(a.href);
  save({ reason:'backup:export' });
  renderHub();
  renderAccount();
  const current = document.querySelector('.page.on')?.id?.replace('page-','');
  if (current === 'daily') renderDaily();
  toast('Backup zapisany do pliku JSON.');
}
async function importFullBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const incoming = await storage().importBackup(file);
    if (!confirm('Zaimportować backup i zastąpić obecne dane?')) return;
    D = incoming;
    ensureDisplayNameFromAuth(currentUser);
    save({ reason:'backup:import' });
    prepJournalDefaults();
    prepDailyDefaults();
    renderAll();
    nav('hub');
    toast('Backup zaimportowany.');
  } catch (e) {
    console.error(e);
    alert('Nie udało się wczytać pliku backupu.');
  } finally {
    event.target.value = '';
  }
}

// ════════════════════════════════════════
// ════════════════════════════════════════
// PRIDE WALL
// ════════════════════════════════════════
function openAddPride() {
  document.getElementById('pr-name').value = '';
  document.getElementById('pr-icon').value = '';
  document.getElementById('pr-note').value = '';
  openModal('modal-pride');
}
function savePride() {
  const name = document.getElementById('pr-name').value.trim();
  if (!name) { toast('Podaj nazwę.'); return; }
  D.pride.push({
    id: Date.now(),
    name,
    icon: document.getElementById('pr-icon').value.trim() || '🏆',
    note: document.getElementById('pr-note').value.trim(),
    date: todayStr(),
  });
  save({ reason:'pride:create' });
  closeModal('modal-pride');
  renderPride();
  toast('🏆 Dodano do ściany dumy!');
}


function updateFeatureVisibility() {
  const showAdvanced = !!D.settings.showAdvancedStats;
  const mode = D.settings.appMode || 'standard';
  const minimal = mode === 'minimal';
  document.querySelectorAll('.nav-item[data-page="active"], .nav-item[data-page="backlog"], .nav-item[data-page="archive"], .nav-item[data-page="pride"], .mobile-menu-link[data-page="active"], .mobile-menu-link[data-page="backlog"], .mobile-menu-link[data-page="archive"], .mobile-menu-link[data-page="pride"]').forEach(el => { el.style.display = minimal ? 'none' : ''; });
  document.querySelectorAll('.nav-item[data-page="stats"], .mobile-menu-link[data-page="stats"]').forEach(el => { el.style.display = showAdvanced && !minimal ? '' : 'none'; });
  document.querySelectorAll('.nav-item[data-page="review"], .mobile-menu-link[data-page="review"]').forEach(el => { el.style.display = showAdvanced && !minimal ? '' : 'none'; });
  const current = document.querySelector('.page.on')?.id?.replace('page-','') || 'hub';
  if ((minimal && ['active','backlog','archive','pride','stats','review'].includes(current)) || (!showAdvanced && ['stats','review'].includes(current))) nav(isPhoneUI() ? 'daily' : 'hub');
  const focusCard = document.getElementById('morning-focus-card'); if (focusCard) focusCard.style.display = D.settings.showMorningFocus ? '' : 'none';
  const startFinishCard = document.getElementById('start-finish-card'); if (startFinishCard) startFinishCard.style.display = (D.settings.appMode !== 'minimal' && D.settings.showAdvancedStats) ? '' : 'none';
}
function renderRitualManager() {
  const wrap = document.getElementById('ritual-manage-list');
  if (!wrap) return;
  const rituals = visibleRituals();
  if (!rituals.length) {
    wrap.innerHTML = '<div class="stat-note">Nie masz jeszcze rytuałów.</div>';
    return;
  }
  wrap.innerHTML = rituals.map(ritual => `<div class="ritual-manage-row">
    <input type="text" id="ritual-text-${escapeHtml(ritual.id)}" value="${escapeHtml(ritual.text)}">
    <select id="ritual-time-${escapeHtml(ritual.id)}">
      <option value="any" ${ritual.timeOfDay === 'any' ? 'selected' : ''}>Dowolnie</option>
      <option value="morning" ${ritual.timeOfDay === 'morning' ? 'selected' : ''}>Rano</option>
      <option value="evening" ${ritual.timeOfDay === 'evening' ? 'selected' : ''}>Wieczór</option>
    </select>
    <label class="setting-option" style="margin:0;">
      <input type="checkbox" id="ritual-active-${escapeHtml(ritual.id)}" ${ritual.active !== false ? 'checked' : ''}>
      <span class="setting-option-copy"><span class="setting-option-title">Aktywny</span></span>
    </label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" type="button" data-action="updateRitual" data-id="${escapeHtml(ritual.id)}">Zapisz</button>
      <button class="btn btn-red btn-sm" type="button" data-action="deleteRitual" data-id="${escapeHtml(ritual.id)}">Usuń</button>
    </div>
  </div>`).join('');
}
function addRitual() {
  const textEl = document.getElementById('ritual-new-text');
  const timeEl = document.getElementById('ritual-new-time');
  const text = textEl?.value.trim() || '';
  if (!text) { toast('Wpisz nazwę rytuału.'); return; }
  D.rituals = D.rituals || [];
  const stamp = nowIso();
  const id = String(Date.now()) + Math.random().toString(36).slice(2,5);
  D.rituals.push({
    id,
    text,
    timeOfDay: ['morning','evening','any'].includes(timeEl?.value) ? timeEl.value : 'any',
    active: true,
    createdAt: stamp,
    updatedAt: stamp,
    updatedByDevice: D.settings.deviceId || ''
  });
  save({ entity:'ritual', id, reason:'ritual:create' });
  if (textEl) textEl.value = '';
  if (timeEl) timeEl.value = 'any';
  renderAccount();
  if (document.querySelector('.page.on')?.id === 'page-daily') renderDaily();
  toast('Dodano rytuał.');
}
function updateRitual(id) {
  const ritual = visibleRituals().find(item => String(item.id) === String(id));
  if (!ritual) return;
  const text = document.getElementById(`ritual-text-${String(id)}`)?.value.trim() || '';
  if (!text) { toast('Nazwa rytuału nie może być pusta.'); return; }
  const timeOfDay = document.getElementById(`ritual-time-${String(id)}`)?.value || 'any';
  ritual.text = text;
  ritual.timeOfDay = ['morning','evening','any'].includes(timeOfDay) ? timeOfDay : 'any';
  ritual.active = !!document.getElementById(`ritual-active-${String(id)}`)?.checked;
  save({ entity:'ritual', id:ritual.id, reason:'ritual:update' });
  renderAccount();
  if (document.querySelector('.page.on')?.id === 'page-daily') renderDaily();
  toast('Zapisano rytuał.');
}
function deleteRitual(id) {
  const ritual = visibleRituals().find(item => String(item.id) === String(id));
  if (!ritual) return;
  if (!confirm(`Usunąć rytuał "${ritual.text}"?`)) return;
  markEntityDeleted(ritual);
  save({ entity:'ritual', id:ritual.id, reason:'ritual:delete' });
  renderAccount();
  if (document.querySelector('.page.on')?.id === 'page-daily') renderDaily();
  toast('Usunięto rytuał.');
}
function renderAccount() {
  const emailEl = document.getElementById('account-email');
  const syncEl = document.getElementById('account-sync-text');
  if (emailEl) emailEl.textContent = currentUser?.email || 'lokalnie / brak konta';
  if (syncEl) syncEl.textContent = APP_RUNTIME.syncText || 'Zapisano lokalnie';
  setText('account-schema-version', String(D.schemaVersion || CURRENT_SCHEMA_VERSION));
  setText('account-last-backup-text', formatSavedAt(D.settings.lastBackupAt));
  updateUserChip();
  const lim = document.getElementById('settings-limit'); if (lim) lim.value = D.settings.limit || 3;
  const am = document.getElementById('settings-app-mode'); if (am) am.value = D.settings.appMode || 'standard';
  const mf = document.getElementById('settings-show-morning-focus'); if (mf) mf.checked = !!D.settings.showMorningFocus;
  const st = document.getElementById('settings-show-advanced-stats'); if (st) st.checked = !!D.settings.showAdvancedStats;
  const ns = document.getElementById('settings-notifications-enabled'); if (ns) ns.checked = !!D.settings.notificationsEnabled;
  const tr = document.getElementById('settings-task-reminders-enabled'); if (tr) tr.checked = !!D.settings.taskReminderEnabled;
  const jr = document.getElementById('settings-journal-reminder-enabled'); if (jr) jr.checked = !!D.settings.journalReminderEnabled;
  const jrt = document.getElementById('settings-journal-reminder-time'); if (jrt) jrt.value = D.settings.journalReminderTime || '21:30';
  const jf = document.getElementById('settings-journal-followup-enabled'); if (jf) jf.checked = !!D.settings.journalReminderFollowupEnabled;
  const jft = document.getElementById('settings-journal-followup-time'); if (jft) jft.value = D.settings.journalReminderFollowupTime || '22:30';
  const eo = document.getElementById('settings-evening-open-tasks-enabled'); if (eo) eo.checked = !!D.settings.eveningReminderEnabled;
  const eot = document.getElementById('settings-evening-open-tasks-time'); if (eot) eot.value = D.settings.eveningReminderTime || '19:00';
  const bd = document.getElementById('settings-badge-enabled'); if (bd) bd.checked = !!D.settings.badgeEnabled;
  syncThemeForm();
  renderRitualManager();
  syncNotificationUI();
  if (currentUser) refreshJournalReminderDebug();
  updateFeatureVisibility();
}
function setAppMode(mode) {
  const next = APP_MODES[mode];
  if (!next) return;
  D.settings.appMode = mode;
  D.settings.showMorningFocus = next.defaults.showMorningFocus;
  D.settings.showAdvancedStats = next.defaults.showAdvancedStats;
  D.settings.limit = next.defaults.limit;
  save({ reason:'settings:app-mode' });
  renderAll();
  toast(`Tryb aplikacji: ${next.label}.`);
}
function setProjectLimit(value) {
  const next = Math.max(1, Math.min(20, parseInt(value || 3, 10) || 3));
  D.settings.limit = next;
  save({ reason:'settings:project-limit' });
  renderAll();
}
function toggleSetting(key, value) {
  D.settings[key] = !!value;
  save({ reason:'settings:toggle' });
  syncNotificationUI();
  updateFeatureVisibility();
  renderAll();
}
function setReminderSetting(key, value) {
  if (key === 'journalReminderTime') D.settings[key] = value || '21:30';
  else if (key === 'journalReminderFollowupTime') D.settings[key] = value || '22:30';
  else if (key === 'eveningReminderTime') D.settings[key] = value || '19:00';
  else D.settings[key] = !!value;
  save({ reason:'settings:reminder' });
  if (currentUser && ['journalReminderEnabled','journalReminderTime','journalReminderFollowupEnabled','journalReminderFollowupTime','taskReminderEnabled','eveningReminderEnabled','eveningReminderTime','badgeEnabled'].includes(key)) {
    writeDeviceRegistration({
      active: !!(D.settings.notificationsEnabled && NOTIFICATION_RUNTIME.token),
      token: NOTIFICATION_RUNTIME.token,
      lastRegistrationAt: NOTIFICATION_RUNTIME.lastRegistrationAt,
      lastError: NOTIFICATION_RUNTIME.registrationError
    }).catch((err) => console.error('Device settings sync failed', err));
    if (key === 'badgeEnabled' && NOTIFICATION_RUNTIME.token) {
      registerDeviceTokenWithBackend(NOTIFICATION_RUNTIME.token).catch((err) => console.error('Backend badge setting sync failed', err));
    }
  }
  renderAccount();
}
function confirmWipeAppData() {
  const okay = confirm('Usunąć wszystkie dane Focus Huba z tego konta? Ta operacja jest trwała i obejmuje projekty, zadania, dziennik oraz ustawienia.');
  if (!okay) return;
  const second = prompt('Aby potwierdzić, wpisz USUŃ');
  if ((second || '').trim().toUpperCase() !== 'USUŃ') { toast('Anulowano usuwanie danych.'); return; }
  resetAppData();
}
async function resetAppData() {
  try { await unregisterCurrentDevice({ clearToken: true }); } catch(e) {}
  resetProjectDraftState?.();
  D = defaultState();
  D.settings.deviceId = makeDeviceId();
  ensureDisplayNameFromAuth(currentUser);
  save({ reason:'app:reset' });
  renderAll();
  toast('Usunięto wszystkie dane aplikacji.');
  nav(isPhoneUI() ? 'daily' : 'hub');
}

// ════════════════════════════════════════
// MODALS
// ════════════════════════════════════════
const MODAL_FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
let lastModalTrigger = null;
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  lastModalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  const modal = overlay.querySelector('.modal');
  const firstTarget = modal?.querySelector(MODAL_FOCUSABLE) || modal;
  requestAnimationFrame(() => firstTarget?.focus?.({ preventScroll: true }));
}
function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  if (lastModalTrigger && document.contains(lastModalTrigger)) {
    lastModalTrigger.focus({ preventScroll: true });
  }
  lastModalTrigger = null;
}
document.querySelectorAll('.overlay').forEach(o => {
  o.setAttribute('aria-hidden', 'true');
  o.addEventListener('click', e => {
    if (e.target !== o) return;
    if (o.dataset.locked === 'true') return;
    closeModal(o.id);
  });
});
document.addEventListener('keydown', (event) => {
  const overlay = document.querySelector('.overlay.open');
  if (!overlay) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(overlay.id);
    return;
  }
  if (event.key !== 'Tab') return;
  const modal = overlay.querySelector('.modal');
  if (!modal) return;
  const focusable = [...modal.querySelectorAll(MODAL_FOCUSABLE)]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    modal.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

const dailyDomain = createDailyDomain({
  getState: () => D, document, window, todayStr, isoDateOffset, nowIso, escapeHtml, isPhoneUI,
  visibleDailyTasks, visibleProjects, visibleRituals, save, renderAll, renderCurrentPage, renderStartFinishStats,
  toast, openModal, closeModal, nav, focusJournalInput, reminderChipHTML, collectTaskReminderFromForm,
  resetTaskReminderForm, syncTaskReminderForm, markEntityDeleted
});
const {
  setDailyPriorityTask, getMorningFocus, maybeRollDailyTasks, rollOpenTasksForward, prepDailyDefaults,
  prepMorningFocusDefaults, prefillMorningFocusFromTasks, saveMorningFocus, clearMorningFocus,
  toggleAutoRoll, ensureDailySelectedDate, toggleRitual, renderDaily, addDailyTask, fillDailyExamples,
  toggleDailyTask, setDailyReason, deleteDailyTask, clearDoneDailyTasks, dismissDayClose, confirmDayClose,
  taskCategory, dateRangeTasks, summarizeTaskCategories, renderUpcoming, addUpcomingTask, jumpUpcomingDate,
  moveTaskToToday
} = dailyDomain;

const journalDomain = createJournalDomain({
  getState: () => D, document, window, navigator, Blob, URL, todayStr, nowIso, fmtShort, escapeHtml,
  visibleJournalEntries, save, toast, nav, getMorningFocus, markEntityDeleted
});
const {
  renderDayClosePanel, prepJournalDefaults, updateMoodMeter, resetJournalForm, fillJournalExample,
  saveJournalEntry, editJournalEntry, deleteJournalEntry, renderJournalExport, copyJournalExport,
  downloadJournalExport, renderJournal
} = journalDomain;

const projectsDomain = createProjectsDomain({
  getState: () => D, document, todayStr, nowIso, fmtShort, daysSince, escapeHtml, isPhoneUI,
  visibleProjects, save, renderCurrentPage, toast, openModal, closeModal, nav, updateSidebar,
  prepDailyDefaults, backupIsDue, backupStatusLabel, messageCopy, CAT_COLORS
});
const {
  activeProjects, renderHub, renderActive, renderBacklog, renderArchive, renderPride,
  openNewProject, openEditProject, selectCat, saveProject, markDone, toggleProjectStep,
  promoteToActive, startArchive, confirmArchive, resetProjectDraftState
} = projectsDomain;

const GLOBAL_ACTIONS = {
  loginUser, registerUser, logoutUser, continueLocalMode,
  nav, mobileNav, toggleMobileMenu,
  mobileQuickAdd, focusDailyTaskInput, focusJournalInput,
  exportFullBackup, importFullBackup, rollOpenTasksForward,
  openNewProject, saveProject, closeModal, openAddPride, savePride,
  addDailyTask, fillDailyExamples, clearDoneDailyTasks, toggleDailyTask,
  addRitual, updateRitual, deleteRitual, toggleRitual,
  setDailyPriorityTask, dismissDayClose, confirmDayClose, saveWeeklyReview,
  saveMorningFocus, prefillMorningFocusFromTasks, clearMorningFocus,
  setDailyReason, deleteDailyTask, fillJournalExample, saveJournalEntry,
  resetJournalForm, renderJournalExport, copyJournalExport, downloadJournalExport, updateMoodMeter,
  editJournalEntry, deleteJournalEntry,
  startArchive, confirmArchive, toggleAutoRoll, selectCat, resetAppData, renderAccount, toggleProjectStep,
  syncTaskReminderForm, setTaskReminder, clearTaskReminder,
  requestNotificationAccess, sendNotificationTest, sendVisibleNotificationTest, testJournalReminderNow, refreshJournalReminderDebug,
  addUpcomingTask, jumpUpcomingDate, moveTaskToToday, renderUpcoming, renderAll,
  openEditProject, markDone, promoteToActive, setThemeMode, setThemePreset, updateCustomTheme, setProjectLimit, toggleSetting, confirmWipeAppData,
  setAppMode, setReminderSetting, promptInstallApp,
  toggleSystemNotifications, refreshNotificationRegistration
};
Object.assign(window, GLOBAL_ACTIONS);
Object.assign(globalThis, GLOBAL_ACTIONS);

window.addEventListener('resize', () => {
  const current = document.querySelector('.page.on')?.id?.replace('page-','') || defaultLandingPage();
  updateMobileNav(current);
  const addBtn = document.getElementById('tb-add-btn');
  if (addBtn) addBtn.style.display = !isPhoneUI() && ['hub','active','backlog'].includes(current) ? '' : 'none';
});
window.addEventListener('focus', flushDueTaskReminders);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flushDueTaskReminders();
});
const CLICK_ACTIONS = {
  loginUser, registerUser, continueLocalMode, openNewProject, mobileQuickAdd,
  focusDailyTaskInput, addDailyTask, clearDoneDailyTasks, saveMorningFocus,
  prefillMorningFocusFromTasks, clearMorningFocus, addUpcomingTask, openAddPride,
  logoutUser, addRitual, promptInstallApp, requestNotificationAccess,
  refreshNotificationRegistration, confirmWipeAppData, saveJournalEntry,
  resetJournalForm, renderJournalExport, copyJournalExport, downloadJournalExport,
  exportFullBackup, saveProject, confirmArchive, savePride, saveWeeklyReview, dismissDayClose,
  confirmDayClose, renderDaily, renderUpcoming, renderDayClosePanel
};
function bindActionDelegation() {
  return bindDelegatedActions({
    document,
    actions: GLOBAL_ACTIONS,
    clickActions: CLICK_ACTIONS,
    defaultLandingPage,
    toast
  });
}

bootstrapApp().catch((err) => {
  console.error(err);
  setSyncStatus('error');
  openAuthOverlay();
});

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let toastT;
function toast(msg, action = null) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  if (action?.label && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      clearTimeout(toastT);
      el.classList.remove('show');
      action.onClick();
    }, { once:true });
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), action?.duration || 3000);
}
