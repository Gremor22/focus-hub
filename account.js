const THEME_PRESETS = {
  lime: { label:'Neon Lime', accent:'#c8f040', blue:'#40a8f0', amber:'#f0b840', red:'#f04840' },
  ocean: { label:'Ocean', accent:'#5cc8ff', blue:'#3f8cff', amber:'#ffb65c', red:'#ff6b7a' },
  orchid: { label:'Orchid', accent:'#c98cff', blue:'#6ca8ff', amber:'#ffbf69', red:'#ff6b9d' }
};

function accountStateProxy(getState) {
  return new Proxy({}, {
    get(_target, prop) { return getState()[prop]; },
    set(_target, prop, value) { getState()[prop] = value; return true; },
    has(_target, prop) { return prop in getState(); }
  });
}

export function createAccountDomain(ctx) {
  const D = accountStateProxy(ctx.getState);
  const {
    document, window, URL, currentSchemaVersion, appModes, getCurrentUser, getSyncText,
    storage, normalizeAppState, replaceState, ensureDisplayNameFromAuth, save, renderHub,
    renderDaily, renderAll, nav, prepJournalDefaults, prepDailyDefaults, toast, formatSavedAt,
    setText, escapeHtml, visibleProjects, visibleJournalEntries, visibleDailyTasks, visibleRituals,
    isPhoneUI, syncNotificationUI, refreshJournalReminderDebug, renderRitualManager
  } = ctx;

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

  function updateUserChip() {
    const currentUser = getCurrentUser();
    const accEmail = document.getElementById('account-email');
    const accSync = document.getElementById('account-sync-text');
    const localSave = document.getElementById('account-local-save-text');
    const cloudSync = document.getElementById('account-cloud-sync-text');
    if (accEmail) accEmail.textContent = currentUser?.email || 'lokalnie / brak konta';
    if (accSync) accSync.textContent = getSyncText() || 'Zapisano lokalnie';
    if (localSave) localSave.textContent = formatSavedAt(D.settings?.lastLocalSaveAt);
    if (cloudSync) cloudSync.textContent = formatSavedAt(D.settings?.lastCloudSyncAt);
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
  function exportFullBackup() {
    D.settings.lastBackupAt = new Date().toISOString();
    const normalized = normalizeAppState(D);
    replaceState(normalized);
    const backup = storage().exportBackup(normalized);
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
      replaceState(incoming);
      ensureDisplayNameFromAuth(getCurrentUser());
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

  function renderAccount() {
    const currentUser = getCurrentUser();
    const emailEl = document.getElementById('account-email');
    const syncEl = document.getElementById('account-sync-text');
    if (emailEl) emailEl.textContent = currentUser?.email || 'lokalnie / brak konta';
    if (syncEl) syncEl.textContent = getSyncText() || 'Zapisano lokalnie';
    setText('account-schema-version', String(D.schemaVersion || currentSchemaVersion));
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
    const next = appModes[mode];
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

  return {
    activeThemeColors, applyThemeSettings, setThemeMode, setThemePreset, updateCustomTheme,
    updateUserChip, updateFeatureVisibility, backupIsDue, backupStatusLabel,
    exportFullBackup, importFullBackup, renderAccount, setAppMode, setProjectLimit, toggleSetting
  };
}
