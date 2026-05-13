function dailyStateProxy(getState) {
  return new Proxy({}, {
    get(_target, prop) { return getState()[prop]; },
    set(_target, prop, value) { getState()[prop] = value; return true; },
    has(_target, prop) { return prop in getState(); }
  });
}

export function createDailyDomain(ctx) {
  const D = dailyStateProxy(ctx.getState);
  const {
    document, todayStr, isoDateOffset, nowIso, escapeHtml, isPhoneUI,
    visibleDailyTasks, visibleProjects, visibleRituals, save, renderAll, renderCurrentPage,
    renderStartFinishStats, toast, openModal, closeModal, nav, focusJournalInput,
    reminderChipHTML, collectTaskReminderFromForm, resetTaskReminderForm, syncTaskReminderForm, markEntityDeleted
  } = ctx;

function getDailyPriorityTask(date = getDailySelectedDate()) {
  const taskId = D.dailyPriority?.[date];
  return visibleDailyTasks().find(task => String(task.id) === String(taskId) && task.date === date) || null;
}
function setDailyPriorityTask(id) {
  const task = visibleDailyTasks().find(t => String(t.id) === String(id));
  if (!task) return;
  D.dailyPriority = D.dailyPriority || {};
  D.dailyPriority[task.date] = task.id;
  save({ entity:'dailyTask', id:task.id, reason:'daily:priority' });
  renderDaily();
  toast('Ustawiono priorytet dnia.');
}
function clearMissingDailyPriority(date) {
  const existing = getDailyPriorityTask(date);
  if (existing) return;
  if (D.dailyPriority?.[date]) delete D.dailyPriority[date];
}
function completedTasksForDate(date) {
  return visibleDailyTasks().filter(task => task.date === date && task.done);
}
function prefillJournalForDayClose(date) {
  const tasks = completedTasksForDate(date);
  document.getElementById('jr-date').value = date;
  if (!document.getElementById('jr-note').value.trim()) {
    document.getElementById('jr-note').value = tasks.length
      ? `Ukończone zadania:\n- ${tasks.map(task => task.text).join('\n- ')}`
      : '';
  }
}
function latestOpenDailyDateBeforeToday() {
  const today = todayStr();
  const dates = [...new Set(visibleDailyTasks().filter(t => !t.done && t.date && t.date < today).map(t => t.date))].sort();
  return dates.length ? dates[dates.length - 1] : '';
}

function getMorningFocus(date = todayStr()) {
  D.morningFocus = D.morningFocus || {};
  return D.morningFocus[date] || { priorities:['','',''], note:'', savedAt:'' };
}
function setMorningFocus(date, payload) {
  D.morningFocus = D.morningFocus || {};
  D.morningFocus[date] = { priorities:[...(payload.priorities || ['','',''])].slice(0,3), note: payload.note || '', savedAt: new Date().toISOString() };
}
function maybeRollDailyTasks() {
  if (D.settings.autoRollDaily === false) return false;
  const today = todayStr();
  if (D.settings.lastDailyRollDate === today) return false;
  const sourceDate = latestOpenDailyDateBeforeToday();
  if (!sourceDate) { D.settings.lastDailyRollDate = today; save({ reason:'daily:auto-roll-check' }); return false; }
  const moved = rollOpenTasksForward(false, sourceDate);
  D.settings.lastDailyRollDate = today;
  D.settings.lastDailyRollFrom = sourceDate || '';
  save({ reason:'daily:auto-roll' });
  if (moved > 0) toast(`Przeniosłem ${moved} otwarte zad${moved===1?'anie':'ania'} z ${sourceDate} na dziś.`);
  return moved > 0;
}
function rollOpenTasksForward(showToast = true, sourceDate = '') {
  const today = todayStr();
  const from = sourceDate || latestOpenDailyDateBeforeToday();
  if (!from || from >= today) { if (showToast) toast('Nie ma starszych otwartych zadań do przeniesienia.'); return 0; }
  const existingKeys = new Set(visibleDailyTasks().filter(t => t.date === today && !t.done).map(t => `${t.text}__${t.lane}__${t.projectId||''}`));
  let moved = 0;
  visibleDailyTasks().forEach(task => {
    if (!task.done && task.date === from) {
      const key = `${task.text}__${task.lane}__${task.projectId||''}`;
      if (existingKeys.has(key)) return;
      task.date = today;
      task.rolledFrom = task.rolledFrom || from;
      task.rolledAt = new Date().toISOString();
      task.rollCount = Number(task.rollCount || 0) + 1;
      existingKeys.add(key);
      moved += 1;
    }
  });
  if (moved) {
    D.settings.lastDailyRollDate = today;
    D.settings.lastDailyRollFrom = from;
    save({ entities: visibleDailyTasks().filter(task => task.rolledAt && task.date === today).map(task => ({ entity:'dailyTask', id:task.id })), reason:'daily:roll-forward' });
    if (showToast) { renderDaily(); toast(`Przeniesiono ${moved} otwarte zad${moved===1?'anie':'ania'} na dziś.`); }
  } else if (showToast) toast('Nie było nic nowego do przeniesienia.');
  return moved;
}

// ════════════════════════════════════════
// DAILY
// ════════════════════════════════════════
function prepDailyDefaults() {
  const pSel = document.getElementById('daily-task-project');
  if (pSel) {
    const current = pSel.value;
    pSel.innerHTML = '<option value="">Brak</option>' + visibleProjects().filter(p => p.status !== 'archived').map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    pSel.value = current || '';
  }
  syncTaskReminderForm('daily');
}
function prepMorningFocusDefaults() {
  const focus = getMorningFocus(todayStr());
  const p = focus.priorities || ['','',''];
  const f1 = document.getElementById('focus-1'); if (f1) f1.value = p[0] || '';
  const f2 = document.getElementById('focus-2'); if (f2) f2.value = p[1] || '';
  const f3 = document.getElementById('focus-3'); if (f3) f3.value = p[2] || '';
  const note = document.getElementById('focus-note'); if (note) note.value = focus.note || '';
}
function prefillMorningFocusFromTasks() {
  const tasks = todayDailyTasks().filter(t => !t.done);
  const picks = [
    ...(tasks.filter(t => t.lane === 'must').slice(0,2)),
    ...(tasks.filter(t => t.lane !== 'must').slice(0,3))
  ].slice(0,3);
  ['focus-1','focus-2','focus-3'].forEach((id, idx) => { const el = document.getElementById(id); if (el) el.value = picks[idx] ? picks[idx].text : ''; });
  const note = document.getElementById('focus-note');
  if (note && !note.value.trim()) note.value = 'Krótka notatka do dnia.';
  toast(picks.length ? 'Uzupełniłem focus na podstawie listy dnia.' : 'Nie ma jeszcze otwartych zadań do podpowiedzi.');
}
function saveMorningFocus() {
  const priorities = ['focus-1','focus-2','focus-3'].map(id => document.getElementById(id)?.value.trim() || '');
  const note = document.getElementById('focus-note')?.value.trim() || '';
  if (!priorities.some(Boolean) && !note) { toast('Dodaj chociaż jedną rzecz do focusu dnia.'); return; }
  setMorningFocus(todayStr(), { priorities, note });
  save({ reason:'morning-focus:update' });
  renderDaily();
  toast('Zapisano focus dnia.');
}
function clearMorningFocus() {
  D.morningFocus = D.morningFocus || {};
  delete D.morningFocus[todayStr()];
  save({ reason:'morning-focus:clear' });
  prepMorningFocusDefaults();
  renderDaily();
  toast('Wyczyszczono focus dnia.');
}
function renderMorningFocusPanel() {
  const wrap = document.getElementById('morning-focus-list');
  const status = document.getElementById('morning-focus-status');
  const focus = getMorningFocus(todayStr());
  const priorities = (focus.priorities || []).filter(Boolean);
  if (!wrap || !status) return;
  if (!priorities.length && !focus.note) {
    wrap.innerHTML = '<div style="color:var(--text3);font-size:0.78rem;">Focus dnia nie został zapisany.</div>';
    status.textContent = 'Wybierz maksymalnie 3 rzeczy na dziś.';
    return;
  }
  status.textContent = priorities.length ? `Zapisano ${priorities.length}/3 priorytety.` : 'Zapisano notatkę do dnia.';
  wrap.innerHTML = priorities.map((txt, idx) => `<div class="morning-focus-item"><div class="morning-focus-num">${idx+1}</div><div><div class="morning-focus-text">${escapeHtml(txt)}</div></div></div>`).join('') + (focus.note ? `<div class="morning-focus-item"><div class="morning-focus-num">∞</div><div><div class="morning-focus-text">${escapeHtml(focus.note)}</div><div class="morning-focus-note">notatka do dnia</div></div></div>` : '');
}
function toggleAutoRoll(checked) {
  D.settings.autoRollDaily = !!checked;
  save({ reason:'settings:auto-roll' });
  renderDaily();
  toast(checked ? 'Włączono automatyczne przenoszenie otwartych zadań.' : 'Wyłączono automatyczne przenoszenie otwartych zadań.');
}
function getDailySelectedDate() {
  const input = document.getElementById('daily-task-date');
  return (input && input.value) ? input.value : todayStr();
}
function ensureDailySelectedDate() {
  const input = document.getElementById('daily-task-date');
  if (input && !input.value) input.value = todayStr();
}
function todayDailyTasks() {
  const selected = getDailySelectedDate();
  return visibleDailyTasks().filter(t => t.date === selected).sort((a,b) =>
    Number(a.done) - Number(b.done) ||
    (a.createdAt || '').localeCompare(b.createdAt || '')
  );
}
function ritualTimeLabel(value = 'any') {
  if (value === 'morning') return 'rano';
  if (value === 'evening') return 'wieczór';
  return 'dowolnie';
}
function activeRituals() {
  return visibleRituals().filter(ritual => ritual.active !== false);
}
function ritualDone(date, ritualId) {
  return !!D.ritualLog?.[date]?.[ritualId];
}
function setRitualDone(date, ritualId, done) {
  D.ritualLog = D.ritualLog || {};
  D.ritualLog[date] = D.ritualLog[date] || {};
  if (done) D.ritualLog[date][ritualId] = true;
  else delete D.ritualLog[date][ritualId];
  if (!Object.keys(D.ritualLog[date]).length) delete D.ritualLog[date];
}
function renderDailyRituals() {
  const list = document.getElementById('daily-ritual-list');
  const progress = document.getElementById('daily-ritual-progress');
  if (!list || !progress) return;
  const date = getDailySelectedDate();
  const rituals = activeRituals();
  const doneCount = rituals.filter(ritual => ritualDone(date, ritual.id)).length;
  progress.textContent = `${doneCount} / ${rituals.length}`;
  if (!rituals.length) {
    list.innerHTML = `<div style="color:var(--text3);font-size:0.78rem;">Dodaj rytuały w Konto.</div>`;
    return;
  }
  list.innerHTML = rituals.map(ritual => {
    const done = ritualDone(date, ritual.id);
    return `<label class="ritual-item ${done ? 'done' : ''}">
      <input type="checkbox" ${done ? 'checked' : ''} data-action="toggleRitual" data-id="${escapeHtml(ritual.id)}">
      <span class="ritual-text">${escapeHtml(ritual.text)}</span>
      <span class="ritual-chip">${ritualTimeLabel(ritual.timeOfDay)}</span>
    </label>`;
  }).join('');
}
function toggleRitual(id) {
  const date = getDailySelectedDate();
  setRitualDone(date, id, !ritualDone(date, id));
  save({ reason:'ritual-log:update' });
  renderDailyRituals();
}
function dailyTaskHTML(task) {
  const project = task.projectId ? visibleProjects().find(p => p.id === task.projectId) : null;
  const stateText = task.done ? 'zrobione' : 'otwarte';
  const isPriority = getDailyPriorityTask(task.date)?.id === task.id;
  return `<div class="daily-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}">
    <input type="checkbox" ${task.done ? 'checked' : ''} data-action="toggleDailyTask" data-id="${escapeHtml(task.id)}">
    <div class="daily-task-main">
      <div class="daily-task-text ${task.done ? 'done' : ''}">${escapeHtml(task.text)}</div>
      <div class="daily-task-meta">${project ? 'projekt: ' + escapeHtml(project.name) + ' · ' : ''}${stateText}${task.rolledFrom ? ' · przeniesione z: ' + escapeHtml(task.rolledFrom) : ''}${task.reason ? ' · powód: ' + escapeHtml(task.reason) : ''}</div>
      ${reminderChipHTML(task)}
      <div class="daily-task-actions">
        ${!task.done ? `<button class="daily-delete" data-action="setDailyPriorityTask" data-id="${escapeHtml(task.id)}">${isPriority ? 'Priorytet ✓' : 'Priorytet'}</button>` : ''}
        ${!task.done ? `<button class="daily-delete" data-action="setDailyReason" data-id="${escapeHtml(task.id)}">Powód</button>` : ''}
        ${!task.done ? `<button class="daily-delete" data-action="setTaskReminder" data-id="${escapeHtml(task.id)}">Przypomnienie</button>` : ''}
        ${task.reminderEnabled ? `<button class="daily-delete" data-action="clearTaskReminder" data-id="${escapeHtml(task.id)}">Wyłącz przypomnienie</button>` : ''}
        <button class="daily-delete btn-red" data-action="deleteDailyTask" data-id="${escapeHtml(task.id)}">Usuń</button>
      </div>
    </div>
  </div>`;
}
function renderDaily() {
  prepDailyDefaults();
  prepMorningFocusDefaults();
  const tasks = todayDailyTasks();
  clearMissingDailyPriority(getDailySelectedDate());
  const must = tasks.filter(t => t.lane === 'must');
  const quick = tasks.filter(t => t.lane === 'quick');
  const optional = tasks.filter(t => t.lane === 'optional');
  const done = tasks.filter(t => t.done).length;
  const selected = getDailySelectedDate();
  const dayLabel = selected === todayStr() ? 'dziś' : new Date(selected + 'T12:00:00').toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  document.getElementById('daily-count').textContent = `${done}/${tasks.length} odhaczonych · ${dayLabel}`;
  const sumEl = document.getElementById('daily-task-summary');
  if (sumEl) sumEl.innerHTML = `
    <span class="daily-info-chip">otwarte: ${tasks.filter(t=>!t.done).length}</span>
    <span class="daily-info-chip">must: ${must.length}</span>
    <span class="daily-info-chip">szybkie: ${quick.length}</span>
    <span class="daily-info-chip">opcjonalne: ${optional.length}</span>`;
  [['must', must], ['quick', quick], ['optional', optional]].forEach(([lane, arr]) => {
    const el = document.getElementById('daily-lane-' + lane);
    const laneBox = el?.closest('.daily-lane');
    if (laneBox) {
      const shouldHide = lane === 'optional' && !arr.length && isPhoneUI();
      laneBox.classList.toggle('is-empty', shouldHide);
      laneBox.style.display = shouldHide ? 'none' : '';
    }
    el.innerHTML = arr.length ? arr.map(dailyTaskHTML).join('') : `<div style="color:var(--text3);font-size:0.78rem;">Brak zadań.</div>`;
  });

  const autoRoll = document.getElementById('auto-roll-toggle');
  if (autoRoll) autoRoll.checked = D.settings.autoRollDaily !== false;
  const rollStatus = document.getElementById('rollover-status');
  if (rollStatus) {
    const lastFrom = D.settings.lastDailyRollFrom;
    rollStatus.textContent = D.settings.autoRollDaily === false
      ? 'Automatyczne przenoszenie jest wyłączone.'
      : (lastFrom ? `Ostatnio sprawdzono otwarte zadania z: ${lastFrom}.` : 'Otwarte zadania z poprzedniego dnia mogą być automatycznie przenoszone na dziś.');
  }
  renderDailyPriorityCard(tasks);
  renderDailyRituals();
  renderMorningFocusPanel();
  renderStartFinishStats();
  maybePromptDayClose(selected);
}
function addDailyTask() {
  const text = document.getElementById('daily-task-text').value.trim();
  if (!text) { toast('Wpisz zadanie do listy.'); return; }
  const lane = document.getElementById('daily-task-lane').value;
  const projectId = document.getElementById('daily-task-project').value || '';
  const pickedDate = getDailySelectedDate();
  const reminder = collectTaskReminderFromForm('daily', pickedDate);
  D.daily = D.daily || [];
  const stamp = nowIso();
  const newTask = { id: String(Date.now()) + Math.random().toString(36).slice(2,5), date: pickedDate, text, lane, done: false, projectId, reason:'', createdAt: stamp, updatedAt: stamp, updatedByDevice: D.settings.deviceId || '', ...reminder };
  D.daily.push(newTask);
  save({ entity:'dailyTask', id:newTask.id, reason:'daily:create' });
  document.getElementById('daily-task-text').value = '';
  document.getElementById('daily-task-project').value = '';
  resetTaskReminderForm('daily');
  renderDaily();
  toast(newTask.reminderEnabled ? 'Dodano do listy. Przypomnienie ustawione.' : 'Dodano do listy.');
}
function fillDailyExamples() {
  const pickedDate = getDailySelectedDate();
  if (visibleDailyTasks().some(t => t.date === pickedDate)) { toast('Lista na ten dzień nie jest pusta.'); return; }
  const samples = [
    ['must', 'Spakuj do auta bagaże'],
    ['quick', 'Wstaw pranie'],
    ['quick', 'Umyj się'],
    ['optional', 'Sprawdź jedną rzecz do magisterki']
  ];
  D.daily = D.daily || [];
  const stamp = nowIso();
  const ids = [];
  samples.forEach(([lane, text], idx) => {
    const id = String(Date.now()) + idx + Math.random().toString(36).slice(2,5);
    ids.push(id);
    D.daily.push({ id, date: pickedDate, text, lane, done: false, projectId: '', reason:'', createdAt: stamp, updatedAt: stamp, updatedByDevice: D.settings.deviceId || '' });
  });
  save({ entities: ids.map(id => ({ entity:'dailyTask', id })), reason:'daily:examples' });
  renderDaily();
  toast('Wstawiłem przykładową listę dnia.');
}
function toggleDailyTask(id) {
  const task = visibleDailyTasks().find(t => String(t.id) === String(id));
  if (!task) return;
  const date = task.date;
  const beforeTasks = visibleDailyTasks().filter(t => t.date === date);
  const hadOpen = beforeTasks.some(t => !t.done);
  task.done = !task.done;
  if (task.done) {
    task.reason = '';
    task.reminderDismissedAt = task.reminderDismissedAt || new Date().toISOString();
  } else {
    task.reminderSentAt = '';
    task.reminderDismissedAt = '';
  }
  if (!task.done && D.dailyPriority?.[date] === task.id) delete D.dailyPriority[date];
  save({ entity:'dailyTask', id:task.id, reason:'daily:toggle' });
  if (task.done && date === todayStr() && hadOpen) maybePromptDayClose(date);
  renderAll();
  renderCurrentPage();
  if (task.done) requestAnimationFrame(() => {
    const el = document.querySelector(`.daily-task[data-task-id="${CSS.escape(String(id))}"]`);
    if (!el) return;
    el.classList.add('just-done');
    setTimeout(() => el.classList.remove('just-done'), 360);
  });
}
function setDailyReason(id) {
  const task = visibleDailyTasks().find(t => String(t.id) === String(id));
  if (!task) return;
  const next = prompt('Dlaczego to dziś nie idzie? Np. brak czasu / za duże / nie było potrzebne / czekam na coś', task.reason || '');
  if (next === null) return;
  task.reason = next.trim();
  save({ entity:'dailyTask', id:task.id, reason:'daily:reason' });
  renderDaily();
}
function deleteDailyTask(id) {
  const task = visibleDailyTasks().find(t => String(t.id) === String(id));
  if (!task) return;
  if (!isPhoneUI() && !confirm('Usunąć to zadanie z listy dnia?')) return;
  const removed = { ...task };
  markEntityDeleted(task);
  save({ entity:'dailyTask', id:task.id, reason:'daily:delete' });
  renderDaily();
  toast('Task usunięty.', {
    label: 'Cofnij',
    duration: 4000,
    onClick: () => {
      D.daily = D.daily || [];
      const existing = (D.daily || []).find(t => String(t.id) === String(removed.id));
      if (existing) Object.assign(existing, removed, { deletedAt: '' });
      else D.daily.push({ ...removed, deletedAt: '' });
      save({ entity:'dailyTask', id:removed.id, reason:'daily:restore' });
      renderCurrentPage();
      toast('Przywrócono task.');
    }
  });
}
function clearDoneDailyTasks() {
  const removedTasks = visibleDailyTasks().filter(t => t.date === todayStr() && t.done);
  removedTasks.forEach(markEntityDeleted);
  const removed = removedTasks.length;
  save({ entities: removedTasks.map(task => ({ entity:'dailyTask', id:task.id })), reason:'daily:clear-done' });
  renderDaily();
  toast(removed ? 'Usunąłem zrobione zadania z dziś.' : 'Nie ma zrobionych zadań do usunięcia.');
}
function renderDailyPriorityCard(tasks) {
  const box = document.getElementById('daily-priority-card');
  if (!box) return;
  const selectedDate = getDailySelectedDate();
  const priority = getDailyPriorityTask(selectedDate);
  const openTasks = tasks.filter(task => !task.done);
  if (!openTasks.length) {
    box.innerHTML = `
      <div class="priority-kicker">Najważniejsze dziś</div>
      <div class="priority-main">Dziś nie masz już otwartych zadań.</div>
      <div class="priority-note">Możesz zamknąć dzień w Dzienniku.</div>`;
    return;
  }
  if (!priority) {
    box.innerHTML = `
      <div class="priority-kicker">Najważniejsze dziś</div>
      <div class="priority-main">Wybierz jedno zadanie jako główne.</div>
      <div class="priority-note">To pole pomaga ustawić kolejność dnia.</div>
      <div class="priority-pick-list">${openTasks.slice(0, 5).map(task => `<button class="priority-pick-btn" type="button" data-action="setDailyPriorityTask" data-id="${escapeHtml(task.id)}"><span class="priority-task-pill">${task.lane === 'must' ? 'Must' : task.lane === 'quick' ? 'Szybkie' : 'Opcjonalne'}</span><span>${escapeHtml(task.text)}</span></button>`).join('')}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="priority-kicker">Najważniejsze dziś</div>
    <div class="priority-main">${escapeHtml(priority.text)}</div>
    <div class="priority-note">${priority.projectId ? `Projekt: ${escapeHtml((visibleProjects().find(project => project.id === priority.projectId) || {}).name || 'projekt')}.` : ''}</div>
    <div class="priority-pick-list">${openTasks.map(task => `<button class="priority-pick-btn ${priority.id === task.id ? 'on' : ''}" type="button" data-action="setDailyPriorityTask" data-id="${escapeHtml(task.id)}"><span>${priority.id === task.id ? '✓' : '○'}</span><span>${escapeHtml(task.text)}</span></button>`).join('')}</div>`;
}
function maybePromptDayClose(date) {
  if (date !== todayStr()) return;
  if (document.getElementById('modal-day-close')?.classList.contains('open')) return;
  const tasks = visibleDailyTasks().filter(task => task.date === date);
  if (!tasks.length) return;
  if (tasks.some(task => !task.done)) return;
  if (D.settings.lastDayCloseDismissedDate === date) return;
  if (D.settings.lastDayCloseConfirmedDate === date) return;
  const summary = document.getElementById('day-close-summary');
  if (summary) summary.innerHTML = tasks.map(task => `<div class="day-close-chip">${escapeHtml(task.text)}</div>`).join('');
  openModal('modal-day-close');
}
function dismissDayClose() {
  D.settings.lastDayCloseDismissedDate = todayStr();
  save({ reason:'settings:day-close-dismiss' });
  closeModal('modal-day-close');
}
function confirmDayClose() {
  const date = todayStr();
  D.settings.lastDayCloseConfirmedDate = date;
  save({ reason:'settings:day-close-confirm' });
  prefillJournalForDayClose(date);
  closeModal('modal-day-close');
  nav('journal');
  focusJournalInput();
}

function taskCategory(task) {
  const project = task.projectId ? visibleProjects().find(p => p.id === task.projectId) : null;
  return project ? project.cat : ({ must:'codzienne must', quick:'małe szybkie', optional:'opcjonalne' }[task.lane] || 'inne');
}
function dateRangeTasks(days) {
  const start = new Date();
  start.setHours(0,0,0,0);
  start.setDate(start.getDate() - (days - 1));
  return visibleDailyTasks().filter(t => new Date((t.date || todayStr()) + 'T00:00:00') >= start);
}
function summarizeTaskCategories(tasks) {
  const map = {};
  tasks.forEach(t => {
    const key = taskCategory(t);
    map[key] = map[key] || { added:0, done:0, open:0, reasons:{} };
    map[key].added += 1;
    if (t.done) map[key].done += 1; else map[key].open += 1;
    if (!t.done && t.reason) map[key].reasons[t.reason] = (map[key].reasons[t.reason] || 0) + 1;
  });
  return Object.entries(map).sort((a,b) => b[1].added - a[1].added);
}


function prepUpcomingDefaults() {
  const dateEl = document.getElementById('upcoming-task-date');
  if (dateEl && !dateEl.value) dateEl.value = isoDateOffset(todayStr(), 1);
  const pSel = document.getElementById('upcoming-task-project');
  if (pSel) {
    const cur = pSel.value;
    pSel.innerHTML = '<option value="">Brak</option>' + visibleProjects().filter(p => p.status !== 'archived').map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    pSel.value = cur || '';
  }
  syncTaskReminderForm('upcoming');
}
function upcomingTasks() {
  const today = todayStr();
  return visibleDailyTasks().filter(t => (t.date || '') > today).sort((a,b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
}
function tasksForDate(date) {
  return visibleDailyTasks().filter(t => (t.date || '') === date).sort((a,b)=>Number(a.done)-Number(b.done) || (a.createdAt||'').localeCompare(b.createdAt||''));
}
function upcomingTaskHTML(task) {
  const project = task.projectId ? visibleProjects().find(p => p.id === task.projectId) : null;
  return `<div class="daily-task">
    <div class="daily-task-main">
      <div class="daily-task-text ${task.done ? 'done' : ''}">${escapeHtml(task.text)}</div>
      <div class="daily-task-meta">${task.date}${project ? ' · projekt: ' + escapeHtml(project.name) : ''}${task.done ? ' · zrobione' : ''}</div>
      ${reminderChipHTML(task)}
      <div class="daily-task-actions">
        ${task.date !== todayStr() ? `<button class="daily-delete" data-action="moveTaskToToday" data-id="${escapeHtml(task.id)}">Na dziś</button>` : ''}
        ${!task.done ? `<button class="daily-delete" data-action="setTaskReminder" data-id="${escapeHtml(task.id)}">Przypomnienie</button>` : ''}
        ${task.reminderEnabled ? `<button class="daily-delete" data-action="clearTaskReminder" data-id="${escapeHtml(task.id)}">Wyłącz przypomnienie</button>` : ''}
        <button class="daily-delete btn-red" data-action="deleteDailyTask" data-id="${escapeHtml(task.id)}">Usuń</button>
      </div>
    </div>
  </div>`;
}
function renderUpcomingGroup(elId, tasks, emptyText) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!tasks.length) { el.innerHTML = `<div class="empty-slot" style="min-height:auto;padding:14px;">${escapeHtml(emptyText)}</div>`; return; }
  const groups = {};
  tasks.forEach(t => { (groups[t.date] ||= []).push(t); });
  el.innerHTML = Object.keys(groups).sort().map(date => `<div class="upcoming-group"><div class="upcoming-group-date">${escapeHtml(date)}</div>${groups[date].map(upcomingTaskHTML).join('')}</div>`).join('');
}
function renderUpcoming() {
  prepUpcomingDefaults();
  const today = todayStr();
  const selected = document.getElementById('upcoming-task-date')?.value || isoDateOffset(today,1);
  const selectedTasks = tasksForDate(selected);
  const tomorrow = isoDateOffset(today,1);
  const weekEnd = isoDateOffset(today,7);
  const future = upcomingTasks();
  const tomorrowTasks = future.filter(t => t.date === tomorrow);
  const weekTasks = future.filter(t => t.date > tomorrow && t.date <= weekEnd);
  const laterTasks = future.filter(t => t.date > weekEnd);
  const countEl = document.getElementById('upcoming-count');
  if (countEl) countEl.textContent = `${future.length} zadań w planie`;
  const summary = document.getElementById('upcoming-selected-summary');
  if (summary) summary.innerHTML = `
    <span class="daily-info-chip">data: ${escapeHtml(selected)}</span>
    <span class="daily-info-chip">zadań: ${selectedTasks.length}</span>
    <span class="daily-info-chip">otwarte: ${selectedTasks.filter(t=>!t.done).length}</span>
    <span class="daily-info-chip">zrobione: ${selectedTasks.filter(t=>t.done).length}</span>`;
  const list = document.getElementById('upcoming-selected-list');
  if (list) list.innerHTML = selectedTasks.length ? selectedTasks.map(upcomingTaskHTML).join('') : `<div class="empty-slot" style="min-height:auto;padding:14px;">Brak zadań dla tej daty.</div>`;
  renderUpcomingGroup('upcoming-tomorrow', tomorrowTasks, 'Na jutro nic nie zaplanowano.');
  renderUpcomingGroup('upcoming-week', weekTasks, 'Na najbliższe 7 dni nic nie zaplanowano.');
  renderUpcomingGroup('upcoming-later', laterTasks, 'Brak dalszych zadań.');
}
function addUpcomingTask() {
  const date = document.getElementById('upcoming-task-date')?.value || '';
  const text = document.getElementById('upcoming-task-text')?.value.trim() || '';
  const lane = document.getElementById('upcoming-task-lane')?.value || 'must';
  const projectId = document.getElementById('upcoming-task-project')?.value || '';
  if (!date || !text) { toast('Podaj datę i treść zadania.'); return; }
  const reminder = collectTaskReminderFromForm('upcoming', date);
  D.daily = D.daily || [];
  const stamp = nowIso();
  const newTask = { id: String(Date.now()) + Math.random().toString(36).slice(2,6), date, text, lane, done:false, projectId, reason:'', createdAt:stamp, updatedAt:stamp, updatedByDevice: D.settings.deviceId || '', ...reminder };
  D.daily.push(newTask);
  save({ entity:'dailyTask', id:newTask.id, reason:'daily:create-upcoming' });
  const textEl = document.getElementById('upcoming-task-text'); if (textEl) textEl.value='';
  resetTaskReminderForm('upcoming');
  renderUpcoming();
  toast(newTask.reminderEnabled ? 'Dodano do planu. Przypomnienie ustawione.' : 'Dodano do planu.');
}
function jumpUpcomingDate(days) {
  const el = document.getElementById('upcoming-task-date');
  if (!el) return;
  el.value = isoDateOffset(todayStr(), days);
  renderUpcoming();
}
function moveTaskToToday(id) {
  const task = visibleDailyTasks().find(t => String(t.id) === String(id));
  if (!task) return;
  task.date = todayStr();
  task.rolledFrom = task.rolledFrom || 'plan';
  save({ entity:'dailyTask', id:task.id, reason:'daily:move-today' });
  renderUpcoming();
  if (document.querySelector('.page.on')?.id === 'page-daily') renderDaily();
  toast('Przeniesiono zadanie na dziś.');
}



  return {
    getDailyPriorityTask, setDailyPriorityTask, clearMissingDailyPriority, completedTasksForDate,
    prefillJournalForDayClose, latestOpenDailyDateBeforeToday, getMorningFocus, setMorningFocus,
    maybeRollDailyTasks, rollOpenTasksForward, prepDailyDefaults, prepMorningFocusDefaults,
    prefillMorningFocusFromTasks, saveMorningFocus, clearMorningFocus, renderMorningFocusPanel,
    toggleAutoRoll, getDailySelectedDate, ensureDailySelectedDate, todayDailyTasks, ritualTimeLabel,
    activeRituals, ritualDone, setRitualDone, renderDailyRituals, toggleRitual, dailyTaskHTML,
    renderDaily, addDailyTask, fillDailyExamples, toggleDailyTask, setDailyReason, deleteDailyTask,
    clearDoneDailyTasks, renderDailyPriorityCard, maybePromptDayClose, dismissDayClose, confirmDayClose,
    taskCategory, dateRangeTasks, summarizeTaskCategories, prepUpcomingDefaults, upcomingTasks, tasksForDate,
    upcomingTaskHTML, renderUpcomingGroup, renderUpcoming, addUpcomingTask, jumpUpcomingDate, moveTaskToToday
  };
}
