function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function schedulerStub(env, userId) {
  const id = env.REMINDER_SCHEDULER.idFromName(String(userId || 'anonymous'));
  return env.REMINDER_SCHEDULER.get(id);
}

function getServiceAccount(env) {
  let fromJson = {};
  let jsonError = '';
  const rawJson = env.FCM_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (rawJson) {
    try {
      fromJson = JSON.parse(rawJson);
    } catch {
      jsonError = 'invalid_fcm_service_account_json';
    }
  }
  const clientEmail = env.FCM_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL || fromJson.client_email || '';
  const privateKey = String(env.FCM_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || fromJson.private_key || '').replace(/\\n/g, '\n');
  const projectId = env.FCM_PROJECT_ID || env.FIREBASE_PROJECT_ID || fromJson.project_id || 'focus-hub-b8bfc';
  if ((!clientEmail || !privateKey) && jsonError) {
    throw new Error(jsonError);
  }
  if (!clientEmail || !privateKey || !projectId) {
    throw new Error('missing_fcm_service_account');
  }
  return { clientEmail, privateKey, projectId };
}

function getFcmBackendStatus(env) {
  try {
    const serviceAccount = getServiceAccount(env);
    return {
      available: true,
      projectId: serviceAccount.projectId,
      clientEmailPresent: !!serviceAccount.clientEmail,
      privateKeyPresent: !!serviceAccount.privateKey,
      error: ''
    };
  } catch (error) {
    return {
      available: false,
      projectId: env.FCM_PROJECT_ID || env.FIREBASE_PROJECT_ID || '',
      clientEmailPresent: !!(env.FCM_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL),
      privateKeyPresent: !!(env.FCM_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || env.FCM_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON),
      error: String(error?.message || error || 'missing_fcm_service_account')
    };
  }
}

function pemToArrayBuffer(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

let accessTokenCache = { token: '', expiresAt: 0 };

async function createSignedJwt(env) {
  const { clientEmail, privateKey } = getServiceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function getGoogleAccessToken(env) {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }
  const assertion = await createSignedJwt(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'google_access_token_failed');
  }
  const expiresIn = Number(data.expires_in || 3600);
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60000, (expiresIn - 120) * 1000)
  };
  return accessTokenCache.token;
}

function buildFcmRequest(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const body = {
    title: payload.title || 'Focus Hub',
    body: payload.body || 'Masz nowe powiadomienie.',
    url: typeof data.url === 'string' && data.url ? data.url : './',
    page: data.page ? String(data.page) : '',
    taskId: data.taskId ? String(data.taskId) : '',
    tag: payload.tag ? String(payload.tag) : '',
    badgeCount: payload.badgeCount == null ? '' : String(payload.badgeCount),
    icon: './icon-192.png',
    badge: './apple-touch-icon.png'
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== ''));
}

function tokenShouldBeRemoved(errorJson = {}) {
  const status = String(errorJson?.error?.status || '');
  const details = Array.isArray(errorJson?.error?.details) ? errorJson.error.details : [];
  const errorCode = details.find((item) => item?.errorCode)?.errorCode || '';
  return status === 'NOT_FOUND' || errorCode === 'UNREGISTERED';
}

async function sendFcmMessage(env, token, payload = {}) {
  const { projectId } = getServiceAccount(env);
  const accessToken = await getGoogleAccessToken(env);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      message: {
        token,
        data: buildFcmRequest(payload),
        webpush: {
          headers: {
            TTL: String(payload.ttl || 300),
            Urgency: payload.urgency || 'high'
          }
        }
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'fcm_send_failed');
    error.code = result?.error?.status || 'FCM_SEND_FAILED';
    error.status = response.status;
    error.removeToken = tokenShouldBeRemoved(result);
    error.details = result;
    throw error;
  }
  return { ok: true, status: response.status, result };
}

function pruneSentLog(sentLog = {}) {
  const cutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);
  return Object.fromEntries(Object.entries(sentLog).filter(([, sentAt]) => {
    const time = new Date(sentAt || '').getTime();
    return Number.isFinite(time) && time >= cutoff;
  }));
}

async function deliverToActiveDevices(env, devices = {}, payload = {}) {
  const entries = Object.entries(devices).filter(([, device]) => device?.active && device?.token);
  const nextDevices = { ...devices };
  const backendAuth = getFcmBackendStatus(env);
  const report = {
    requestStarted: entries.length > 0,
    backendAuthAvailable: backendAuth.available,
    backendAuthError: backendAuth.error,
    attempted: entries.length,
    accepted: 0,
    failed: 0,
    responses: []
  };
  if (!backendAuth.available) {
    report.failed = entries.length;
    report.responses = entries.map(([deviceId]) => ({
      deviceId,
      ok: false,
      status: 0,
      error: backendAuth.error || 'missing_fcm_service_account'
    }));
    return { devices: nextDevices, report };
  }
  await Promise.all(entries.map(async ([deviceId, device]) => {
    try {
      const devicePayload = device.badgeEnabled === false ? { ...payload, badgeCount: 0 } : payload;
      const response = await sendFcmMessage(env, device.token, devicePayload);
      report.accepted += 1;
      report.responses.push({
        deviceId,
        ok: true,
        status: response.status,
        name: response.result?.name || ''
      });
      nextDevices[deviceId] = {
        ...device,
        lastError: '',
        lastUpdatedAt: new Date().toISOString()
      };
    } catch (error) {
      report.failed += 1;
      report.responses.push({
        deviceId,
        ok: false,
        status: error.status || 0,
        error: String(error?.message || 'fcm_send_failed')
      });
      if (error.removeToken) {
        nextDevices[deviceId] = {
          ...device,
          active: false,
          lastError: 'unregistered_token',
          lastUpdatedAt: new Date().toISOString()
        };
      } else {
        nextDevices[deviceId] = {
          ...device,
          lastError: String(error?.message || 'fcm_send_failed'),
          lastUpdatedAt: new Date().toISOString()
        };
      }
    }
  }));
  return { devices: nextDevices, report };
}

function localParts(timestamp = Date.now(), timeZone = 'Europe/Warsaw') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: (Number(map.hour) * 60) + Number(map.minute)
  };
}

function timeToMinutes(value = '') {
  const [h, m] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

function journalLogKey(date, phase) {
  return `${date}:${phase}:push-v2`;
}

function normalizeJournalConfig(config = {}) {
  const journalDates = Array.isArray(config.journalDates) ? config.journalDates.filter(Boolean) : [];
  return {
    notificationsEnabled: config.notificationsEnabled !== false,
    journalReminderEnabled: config.journalReminderEnabled !== false,
    journalReminderTime: config.journalReminderTime || '21:30',
    journalReminderFollowupEnabled: false,
    journalReminderFollowupTime: '',
    timezone: config.timezone || 'Europe/Warsaw',
    journalDates,
    updatedAt: config.updatedAt || new Date().toISOString()
  };
}

function journalEntryExists(config, localDate) {
  return new Set(config?.journalDates || []).has(localDate);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/push/config' && request.method === 'GET') {
      return json({
        ok: true,
        vapidKey: env.FCM_VAPID_PUBLIC_KEY || ''
      });
    }

    if (url.pathname === '/api/push/debug' && request.method === 'GET') {
      const backend = getFcmBackendStatus(env);
      return json({
        ok: true,
        backendAuthAvailable: backend.available,
        backendAuthError: backend.error,
        fcmProjectId: backend.projectId,
        clientEmailPresent: backend.clientEmailPresent,
        privateKeyPresent: backend.privateKeyPresent
      });
    }

    if (url.pathname === '/api/push/register-device' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body?.userId || !body?.deviceId || !body?.token) {
        return json({ ok: false, error: 'invalid_payload' }, 400);
      }
      const stub = schedulerStub(env, body.userId);
      return stub.fetch('https://scheduler.internal/devices/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (url.pathname === '/api/push/unregister-device' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body?.userId || !body?.deviceId) {
        return json({ ok: false, error: 'invalid_payload' }, 400);
      }
      const stub = schedulerStub(env, body.userId);
      return stub.fetch('https://scheduler.internal/devices/unregister', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (url.pathname === '/api/push/test' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body?.userId || !body?.deviceId) {
        return json({ ok: false, error: 'invalid_payload' }, 400);
      }
      const stub = schedulerStub(env, body.userId);
      return stub.fetch('https://scheduler.internal/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (url.pathname === '/api/reminders/sync' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body?.userId || !Array.isArray(body?.reminders)) {
        return json({ ok: false, error: 'invalid_payload' }, 400);
      }
      const stub = schedulerStub(env, body.userId);
      return stub.fetch('https://scheduler.internal/reminders/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (url.pathname === '/api/reminders/debug' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body?.userId) return json({ ok: false, error: 'invalid_payload' }, 400);
      const stub = schedulerStub(env, body.userId);
      return stub.fetch('https://scheduler.internal/reminders/debug', { method: 'POST' });
    }

    if (url.pathname === '/api/reminders/test-journal' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body?.userId) return json({ ok: false, error: 'invalid_payload' }, 400);
      const stub = schedulerStub(env, body.userId);
      return stub.fetch('https://scheduler.internal/reminders/test-journal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phase: body.phase || '' })
      });
    }

    return env.ASSETS.fetch(request);
  }
};

export class ReminderScheduler {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await readJson(request) : null;

    if (url.pathname === '/devices/register') {
      const devices = (await this.state.storage.get('devices')) || {};
      devices[body.deviceId] = {
        deviceId: body.deviceId,
        token: body.token,
        platform: body.platform || 'web',
        permission: body.permission || 'granted',
        standalone: !!body.standalone,
        active: body.active !== false,
        badgeEnabled: body.badgeEnabled !== false,
        lastRegistrationAt: body.lastRegistrationAt || new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        lastError: ''
      };
      await this.state.storage.put('devices', devices);
      return json({ ok: true });
    }

    if (url.pathname === '/devices/unregister') {
      const devices = (await this.state.storage.get('devices')) || {};
      if (devices[body.deviceId]) {
        devices[body.deviceId] = {
          ...devices[body.deviceId],
          active: false,
          lastUpdatedAt: new Date().toISOString()
        };
      }
      await this.state.storage.put('devices', devices);
      return json({ ok: true });
    }

    if (url.pathname === '/test') {
      const devices = (await this.state.storage.get('devices')) || {};
      const device = devices[body.deviceId];
      if (!device?.token || !device?.active) return json({ ok: false, error: 'device_not_active' }, 400);
      const backend = getFcmBackendStatus(this.env);
      if (!backend.available) {
        return json({
          ok: false,
          error: 'push_backend_not_configured',
          details: backend.error,
          backendAuthAvailable: false,
          push: {
            ok: false,
            status: 0,
            error: backend.error
          }
        }, 500);
      }
      try {
        const pushResponse = await sendFcmMessage(this.env, device.token, {
          title: 'Focus Hub',
          body: body.body || 'To jest testowe powiadomienie.',
          tag: body.tag || 'test-notification',
          data: { url: './?page=account', page: 'account' }
        });
        devices[body.deviceId] = {
          ...device,
          lastError: '',
          lastUpdatedAt: new Date().toISOString()
        };
        await this.state.storage.put('devices', devices);
        return json({ ok: true, push: pushResponse });
      } catch (error) {
        if (error.removeToken) {
          devices[body.deviceId] = {
            ...device,
            active: false,
            lastError: 'unregistered_token',
            lastUpdatedAt: new Date().toISOString()
          };
          await this.state.storage.put('devices', devices);
        }
        return json({ ok: false, error: 'push_send_failed', details: String(error?.message || 'unknown_error') }, 500);
      }
    }

    if (url.pathname === '/reminders/sync') {
      const reminders = {};
      for (const item of body.reminders || []) {
        if (!item?.id || !item?.remindAt) continue;
        reminders[item.id] = item;
      }
      await this.state.storage.put('reminders', reminders);
      if (body.journalConfig) {
        await this.state.storage.put('journalConfig', normalizeJournalConfig(body.journalConfig));
      }
      const sentLog = pruneSentLog((await this.state.storage.get('sentLog')) || {});
      await this.state.storage.put('sentLog', sentLog);
      await this.syncAlarm(reminders, await this.state.storage.get('journalConfig'));
      return json({ ok: true, reminders: Object.keys(reminders).length, journal: !!body.journalConfig });
    }

    if (url.pathname === '/reminders/debug') {
      return json({ ok: true, debug: await this.getJournalDebug() });
    }

    if (url.pathname === '/reminders/test-journal') {
      const result = await this.runJournalReminder({ forcePhase: body.phase || 'first', source: 'manual-test' });
      return json({ ok: true, result, debug: await this.getJournalDebug() });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  }

  async alarm() {
    const reminders = (await this.state.storage.get('reminders')) || {};
    const sentLog = pruneSentLog((await this.state.storage.get('sentLog')) || {});
    const devices = (await this.state.storage.get('devices')) || {};
    const journalConfig = await this.state.storage.get('journalConfig');
    const now = Date.now();
    const nextReminders = { ...reminders };
    let nextDevices = { ...devices };

    for (const [id, reminder] of Object.entries(reminders)) {
      const remindAt = new Date(reminder.remindAt || '').getTime();
      if (!Number.isFinite(remindAt)) {
        delete nextReminders[id];
        continue;
      }
      if (sentLog[id]) {
        delete nextReminders[id];
        continue;
      }
      if (remindAt > now) continue;
      const delivery = await deliverToActiveDevices(this.env, nextDevices, reminder);
      nextDevices = delivery.devices;
      sentLog[id] = new Date().toISOString();
      delete nextReminders[id];
    }

    await this.state.storage.put('devices', nextDevices);
    await this.state.storage.put('sentLog', sentLog);
    await this.state.storage.put('reminders', nextReminders);
    await this.runJournalReminder({ now, source: 'alarm' });
    await this.syncAlarm(nextReminders, journalConfig);
  }

  async getJournalDebug() {
    const config = normalizeJournalConfig((await this.state.storage.get('journalConfig')) || {});
    const debug = (await this.state.storage.get('journalDebug')) || {};
    const sentLog = (await this.state.storage.get('journalSentLog')) || {};
    const local = localParts(Date.now(), config.timezone);
    const firstKey = journalLogKey(local.date, 'first');
    const secondKey = journalLogKey(local.date, 'second');
    const firstLog = sentLog[firstKey] || {};
    const secondLog = sentLog[secondKey] || {};
    const firstMinutes = timeToMinutes(config.journalReminderTime);
    const secondMinutes = timeToMinutes(config.journalReminderFollowupTime);
    const entryExists = journalEntryExists(config, local.date);
    return {
      journalReminderEnabled: !!config.journalReminderEnabled,
      journalReminderTime: config.journalReminderTime,
      journalReminderFollowupEnabled: !!config.journalReminderFollowupEnabled,
      journalReminderFollowupTime: config.journalReminderFollowupTime,
      timezone: config.timezone,
      computedLocalDate: local.date,
      journalEntryExistsToday: entryExists,
      firstReminderEligible: !!(config.notificationsEnabled && config.journalReminderEnabled && !entryExists && !firstLog.at && firstMinutes !== null && local.minutes >= firstMinutes),
      firstReminderHandledToday: !!firstLog.at,
      firstReminderAttemptedAt: firstLog.at || '',
      firstReminderPushRequestedAt: firstLog.result === 'first_push_requested' ? firstLog.at : '',
      firstReminderSkipReason: firstLog.skipReason || debug.firstReminderSkipReason || '',
      firstReminderResult: firstLog.result || debug.firstReminderResult || '',
      secondReminderEligible: !!(config.notificationsEnabled && config.journalReminderEnabled && config.journalReminderFollowupEnabled && !entryExists && !secondLog.at && secondMinutes !== null && local.minutes >= secondMinutes),
      secondReminderHandledToday: !!secondLog.at,
      secondReminderAttemptedAt: secondLog.at || '',
      secondReminderPushRequestedAt: secondLog.result === 'second_push_requested' ? secondLog.at : '',
      secondReminderSkipReason: secondLog.skipReason || debug.secondReminderSkipReason || '',
      secondReminderResult: secondLog.result || debug.secondReminderResult || '',
      schedulerDecidedToSend: !!debug.schedulerDecidedToSend,
      pushRequestExecuted: !!debug.pushRequestExecuted,
      backendAuthAvailable: !!debug.backendAuthAvailable,
      backendAuthError: debug.backendAuthError || '',
      pushBackendAccepted: !!debug.pushBackendAccepted,
      lastPushRequestStatus: debug.lastPushRequestStatus || '',
      lastPushRequestResponse: debug.lastPushRequestResponse || '',
      lastPushRequestError: debug.lastPushRequestError || '',
      serviceWorkerReceivedPayload: 'unknown',
      visibleNotificationShown: 'unknown',
      lastJournalReminderAttempt: debug.lastJournalReminderAttempt || '',
      lastJournalReminderResult: debug.lastJournalReminderResult || '',
      lastJournalReminderError: debug.lastJournalReminderError || ''
    };
  }

  async setJournalDebug(update = {}) {
    const current = (await this.state.storage.get('journalDebug')) || {};
    const next = { ...current, ...update };
    await this.state.storage.put('journalDebug', next);
    return next;
  }

  async runJournalReminder({ now = Date.now(), forcePhase = '', source = 'alarm' } = {}) {
    const config = normalizeJournalConfig((await this.state.storage.get('journalConfig')) || {});
    const local = localParts(now, config.timezone);
    const sentLog = (await this.state.storage.get('journalSentLog')) || {};
    const entryExists = journalEntryExists(config, local.date);
    const attemptAt = new Date(now).toISOString();
    const phases = [
      { phase: 'first', enabled: !!config.journalReminderEnabled, time: config.journalReminderTime },
      { phase: 'second', enabled: !!(config.journalReminderEnabled && config.journalReminderFollowupEnabled), time: config.journalReminderFollowupTime }
    ];
    const phaseResults = {};
    const requestedPhases = [];
    let lastPushReport = null;
    let error = '';

    try {
      for (const item of phases) {
        const key = journalLogKey(local.date, item.phase);
        const existing = sentLog[key] || {};
        const minutes = timeToMinutes(item.time);
        const forced = forcePhase === item.phase;
        const due = forced || (minutes !== null && local.minutes >= minutes);
        let result = `${item.phase}_not_due_yet`;
        let skipReason = '';

        if (!config.notificationsEnabled || !config.journalReminderEnabled || !item.enabled) {
          result = `${item.phase}_disabled`;
          skipReason = 'disabled';
        } else if (entryExists) {
          result = `${item.phase}_skipped_entry_exists`;
          skipReason = 'entry_exists';
          if (!existing.at) sentLog[key] = { at: attemptAt, result, skipReason };
        } else if (existing.at) {
          if (existing.result === `${item.phase}_sent` || existing.result === 'sent') {
            result = `${item.phase}_push_requested`;
            skipReason = 'legacy_sent_status';
          } else if (existing.result === `${item.phase}_push_requested`) {
            result = `${item.phase}_push_already_requested`;
            skipReason = 'push_already_requested';
          } else if (String(existing.result || '').includes('skipped_entry_exists')) {
            result = `${item.phase}_skipped_entry_exists`;
            skipReason = 'entry_exists';
          } else {
            result = `${item.phase}_push_already_requested`;
            skipReason = existing.skipReason || 'push_already_requested';
          }
        } else if (minutes === null) {
          result = `${item.phase}_invalid_time`;
          skipReason = 'invalid_time';
        } else if (!due) {
          result = `${item.phase}_not_due_yet`;
          skipReason = 'not_due_yet';
        } else {
          try {
            const pushReport = await this.sendJournalNotification(item.phase, local.date);
            lastPushReport = pushReport;
            result = pushReport.accepted > 0 ? `${item.phase}_push_requested` : `${item.phase}_push_failed`;
            skipReason = '';
            if (pushReport.accepted > 0) {
              sentLog[key] = { at: attemptAt, result, skipReason, pushReport };
              requestedPhases.push(item.phase);
            } else {
              skipReason = pushReport.responses?.[0]?.error || 'push_not_accepted';
              error = [error, `${item.phase}:${skipReason}`].filter(Boolean).join('; ');
            }
          } catch (err) {
            result = `${item.phase}_push_failed`;
            skipReason = String(err?.message || err || 'send_failed');
            error = [error, `${item.phase}:${skipReason}`].filter(Boolean).join('; ');
          }
        }

        phaseResults[item.phase] = {
          result,
          eligible: !!(!existing.at && config.notificationsEnabled && item.enabled && !entryExists && minutes !== null && due),
          handled: !!sentLog[key]?.at,
          attemptedAt: sentLog[key]?.at || '',
          pushRequestedAt: sentLog[key]?.result === `${item.phase}_push_requested` ? sentLog[key].at : '',
          skipReason
        };
      }
    } catch (err) {
      error = String(err?.message || err || 'journal_reminder_failed');
    }

    await this.state.storage.put('journalSentLog', sentLog);
    const result = forcePhase
      ? (phaseResults[forcePhase]?.result || `${forcePhase}_not_due_yet`)
      : (requestedPhases.length ? requestedPhases.map((phase) => `${phase}_push_requested`).join('+') : Object.values(phaseResults).map((item) => item.result).join('+'));
    await this.setJournalDebug({
      lastJournalReminderAttempt: attemptAt,
      lastJournalReminderResult: result,
      lastJournalReminderError: error,
      lastJournalReminderSource: source,
      lastJournalReminderPhase: forcePhase || requestedPhases.join(','),
      computedLocalDate: local.date,
      journalEntryExistsToday: entryExists,
      schedulerDecidedToSend: Object.values(phaseResults).some((item) => item.eligible),
      pushRequestExecuted: !!lastPushReport,
      backendAuthAvailable: lastPushReport ? !!lastPushReport.backendAuthAvailable : getFcmBackendStatus(this.env).available,
      backendAuthError: lastPushReport ? (lastPushReport.backendAuthError || '') : getFcmBackendStatus(this.env).error,
      pushBackendAccepted: !!(lastPushReport && lastPushReport.accepted > 0),
      lastPushRequestStatus: lastPushReport ? (lastPushReport.failed ? 'failure' : 'success') : '',
      lastPushRequestResponse: lastPushReport ? JSON.stringify(lastPushReport.responses || []).slice(0, 500) : '',
      lastPushRequestError: lastPushReport?.responses?.find((item) => !item.ok)?.error || '',
      firstReminderEligible: !!phaseResults.first?.eligible,
      firstReminderHandledToday: !!phaseResults.first?.handled,
      firstReminderAttemptedAt: phaseResults.first?.attemptedAt || '',
      firstReminderPushRequestedAt: phaseResults.first?.pushRequestedAt || '',
      firstReminderSkipReason: phaseResults.first?.skipReason || '',
      firstReminderResult: phaseResults.first?.result || '',
      secondReminderEligible: !!phaseResults.second?.eligible,
      secondReminderHandledToday: !!phaseResults.second?.handled,
      secondReminderAttemptedAt: phaseResults.second?.attemptedAt || '',
      secondReminderPushRequestedAt: phaseResults.second?.pushRequestedAt || '',
      secondReminderSkipReason: phaseResults.second?.skipReason || '',
      secondReminderResult: phaseResults.second?.result || ''
    });
    return { result, error, phases: phaseResults, localDate: local.date, source };
  }

  async sendJournalNotification(phase, localDate) {
    const devices = (await this.state.storage.get('devices')) || {};
    const activeCount = Object.values(devices).filter((device) => device?.active && device?.token).length;
    if (!activeCount) throw new Error('no_active_push_device');
    const payload = {
      title: 'Dziennik',
      body: phase === 'second' ? 'Dzisiejszy wpis w dzienniku jest jeszcze pusty.' : 'Dodaj wpis do dziennika na dziś.',
      tag: `journal-${localDate}-${phase}`,
      badgeCount: 1,
      data: { url: './?page=journal', page: 'journal' }
    };
    const nextDevices = await deliverToActiveDevices(this.env, devices, payload);
    await this.state.storage.put('devices', nextDevices.devices);
    return nextDevices.report;
  }

  nextJournalAlarmTime(configRaw, from = Date.now()) {
    const config = normalizeJournalConfig(configRaw || {});
    if (!config.notificationsEnabled || !config.journalReminderEnabled) return null;
    const local = localParts(from, config.timezone);
    const dates = [local.date];
    const tomorrow = new Date(from + 36 * 60 * 60 * 1000);
    dates.push(localParts(tomorrow.getTime(), config.timezone).date);
    const sentLogPromise = this.state.storage.get('journalSentLog');
    return sentLogPromise.then((sentLog = {}) => {
      const candidates = [];
      for (const date of dates) {
        const entryExists = journalEntryExists(config, date);
        if (entryExists) continue;
        const firstMinutes = timeToMinutes(config.journalReminderTime);
        const secondMinutes = timeToMinutes(config.journalReminderFollowupTime);
        const firstKey = journalLogKey(date, 'first');
        const secondKey = journalLogKey(date, 'second');
        if (!sentLog[firstKey] && firstMinutes !== null) candidates.push(this.localDateTimeToEpoch(date, firstMinutes, config.timezone));
        if (config.journalReminderFollowupEnabled && !sentLog[secondKey] && secondMinutes !== null) {
          candidates.push(this.localDateTimeToEpoch(date, secondMinutes, config.timezone));
        }
      }
      return candidates
        .filter((time) => Number.isFinite(time))
        .map((time) => Math.max(from + 1000, time))
        .sort((a, b) => a - b)[0] || null;
    });
  }

  localDateTimeToEpoch(date, minutes, timeZone) {
    const [year, month, day] = String(date).split('-').map(Number);
    const utcGuess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0);
    const local = localParts(utcGuess, timeZone);
    const desired = timeToMinutes(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    const localDateDelta = (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${local.date}T00:00:00Z`).getTime()) / 86400000;
    const minuteDelta = desired - local.minutes + (localDateDelta * 1440);
    return utcGuess + (minuteDelta * 60 * 1000);
  }

  async syncAlarm(reminders, journalConfig) {
    const entries = Object.values(reminders || {})
      .map((item) => new Date(item.remindAt || '').getTime())
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b);
    const nextJournal = await this.nextJournalAlarmTime(journalConfig, Date.now());
    if (nextJournal) entries.push(nextJournal);
    entries.sort((a, b) => a - b);

    if (!entries.length) {
      await this.state.storage.deleteAlarm();
      return;
    }

    const next = Math.max(Date.now() + 1000, entries[0]);
    await this.state.storage.setAlarm(next);
  }
}
