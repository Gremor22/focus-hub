function projectsStateProxy(getState) {
  return new Proxy({}, {
    get(_target, prop) { return getState()[prop]; },
    set(_target, prop, value) { getState()[prop] = value; return true; },
    has(_target, prop) { return prop in getState(); }
  });
}

export function projectSteps(project) {
  return Array.isArray(project?.steps) ? project.steps.filter(step => (step?.text || '').trim()) : [];
}
export function projectProgress(project) {
  const steps = projectSteps(project);
  if (!steps.length) return Number(project?.progress || 0) || 0;
  return Math.round((steps.filter(step => step.done).length / steps.length) * 100);
}
export function projectProgressText(project) {
  const steps = projectSteps(project);
  if (!steps.length) return `${projectProgress(project)}%`;
  return `${steps.filter(step => step.done).length}/${steps.length} kroków`;
}

export function createProjectsDomain(ctx) {
  const D = projectsStateProxy(ctx.getState);
  const {
    document, todayStr, nowIso, fmtShort, daysSince, escapeHtml, isPhoneUI,
    visibleProjects, save, renderCurrentPage, toast, openModal, closeModal, nav, updateSidebar,
    prepDailyDefaults, backupIsDue, backupStatusLabel, messageCopy, CAT_COLORS
  } = ctx;
  let editingId = null;
  let archivingId = null;
  let selectedCat = 'Gry';

  function activeProjects() { return visibleProjects().filter(p => p.status === 'active'); }
  function limitReached() { return activeProjects().length >= D.settings.limit; }
  function touchDotClass(s) {
    const d = daysSince(s);
    if (d <= 2) return '';
    if (d <= 7) return 'old';
    return 'stale';
  }
  function touchLabel(s) {
    const d = daysSince(s);
    if (d === 0) return 'dziś';
    if (d === 1) return 'wczoraj';
    if (d <= 7) return `${d} dni temu`;
    if (d <= 30) return `${Math.floor(d/7)} tyg. temu`;
    return `${Math.floor(d/30)} mies. temu`;
  }
  function catColor(cat) { return CAT_COLORS[cat] || '#c8f040'; }
  function projectCardSteps(project) {
    const steps = projectSteps(project);
    if (!steps.length) return [];
    const firstOpenIdx = steps.findIndex(step => !step.done);
    const start = firstOpenIdx >= 0 ? firstOpenIdx : Math.max(0, steps.length - 1);
    return steps.slice(start, start + (isPhoneUI() ? 1 : 2));
  }
  function collectProjectStepsFromForm() {
    const steps = Array.from({ length: 5 }, (_, idx) => ({
      id: `step-${idx}`,
      text: document.getElementById(`mp-step-${idx}`)?.value.trim() || '',
      done: !!document.getElementById(`mp-step-done-${idx}`)?.checked
    })).filter(step => step.text);
    return steps;
  }
  function fillProjectStepsForm(project) {
    const steps = projectSteps(project);
    Array.from({ length: 5 }, (_, idx) => {
      const step = steps[idx];
      const textEl = document.getElementById(`mp-step-${idx}`);
      const doneEl = document.getElementById(`mp-step-done-${idx}`);
      if (textEl) textEl.value = step?.text || '';
      if (doneEl) doneEl.checked = !!step?.done;
    });
  }

function ensureProjectHistory(project) {
  if (!project.history || !Array.isArray(project.history)) project.history = [];
  return project.history;
}
function snapshotProject(project, note = '') {
  if (!project) return;
  const history = ensureProjectHistory(project);
  const today = todayStr();
  const entry = { date: today, progress: Number(project.progress || 0), status: project.status || 'active', note: note || '' };
  const last = history[history.length - 1];
  if (last && last.date === today) {
    if (Number(last.progress) === entry.progress && last.status === entry.status && (last.note || '') === entry.note) return;
    history[history.length - 1] = entry;
    return;
  }
  if (last && Number(last.progress) === entry.progress && last.status === entry.status) return;
  history.push(entry);
}
function hubContextSentence(active, done, archived) {
  const total = visibleProjects().length;
  const activeCount = active.length;
  const lastTouch = [...visibleProjects()]
    .map((p) => p.touched || p.created || '')
    .filter(Boolean)
    .sort()
    .pop();
  const touchLabelText = lastTouch ? touchLabel(lastTouch) : 'nigdy';
  if (!total) return `Nie masz jeszcze żadnego projektu. Dodaj pierwszy projekt.`;
  if (activeCount === 1) return `Masz 1 aktywny projekt. Kiedy ostatnio zrobiłeś coś konkretnego?`;
  if (activeCount > 1) return `Masz ${activeCount} aktywne projekty.`;
  if (done && !activeCount) return `Brak aktywnych projektów. Ukończone projekty: ${done}.`;
  if (archived && !activeCount) return `Aktywne sloty są puste. W archiwum: ${archived}.`;
  return `Masz wolne sloty. Ostatnia zmiana: ${touchLabelText}.`;
}
function drawProjectHistory(canvasId, history) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !history || !history.length) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const pad = { t: 18, r: 18, b: 28, l: 28 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.font = '11px Inconsolata';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + innerH * (i / 4);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    const val = Math.round(100 * (1 - i / 4));
    ctx.fillText(String(val) + '%', 0, y + 4);
  }
  if (history.length === 1) {
    const ptX = pad.l + innerW / 2;
    const ptY = pad.t + innerH - (innerH * (Number(history[0].progress || 0) / 100));
    ctx.fillStyle = 'rgba(200,240,64,0.9)';
    ctx.beginPath(); ctx.arc(ptX, ptY, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(fmtShort(history[0].date), ptX - 18, h - 8);
    return;
  }
  ctx.strokeStyle = 'rgba(200,240,64,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((item, idx) => {
    const x = pad.l + innerW * (idx / (history.length - 1));
    const y = pad.t + innerH - (innerH * (Number(item.progress || 0) / 100));
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  history.forEach((item, idx) => {
    const x = pad.l + innerW * (idx / Math.max(1, history.length - 1));
    const y = pad.t + innerH - (innerH * (Number(item.progress || 0) / 100));
    ctx.fillStyle = 'rgba(64,168,240,0.95)';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    if (history.length <= 6 || idx % Math.ceil(history.length / 5) === 0 || idx === history.length - 1) ctx.fillText(fmtShort(item.date), x - 18, h - 8);
  });
}
function renderProjectHistoryBox(project) {
  const box = document.getElementById('project-history-box');
  const list = document.getElementById('project-history-list');
  if (!box || !list) return;
  const history = (project && project.history) ? project.history.slice(-12) : [];
  if (!project || !history.length) {
    box.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  box.style.display = '';
  drawProjectHistory('project-history-canvas', history);
  list.innerHTML = history.slice().reverse().map(item => `<div class="project-history-item"><div><strong>${Number(item.progress || 0)}%</strong> · ${escapeHtml(statusLabel(item.status))}</div><div class="project-history-meta">${escapeHtml(item.date)}${item.note ? ' · ' + escapeHtml(item.note) : ''}</div></div>`).join('');
}

function renderHub() {
  updateSidebar();
  const active = activeProjects();
  const lim = D.settings.limit;
  const name = D.settings.name;

  // limit bar
  const lb = document.getElementById('hub-limit-bar');
  if (active.length >= lim) {
    lb.classList.add('show');
    document.getElementById('hub-limit-count').textContent = `${active.length}/${lim}`;
  } else lb.classList.remove('show');

  // stats
  const done = visibleProjects().filter(p => p.status === 'done').length;
  const archived = visibleProjects().filter(p => p.status === 'archived').length;
  const contextSentence = hubContextSentence(active, done, archived);
  const detailsPage = D.settings.showAdvancedStats ? 'stats' : 'account';
  const detailsLabel = D.settings.showAdvancedStats ? 'Szczegóły' : 'Ustawienia';
  document.getElementById('hub-stats').innerHTML = `
    <div class="hub-summary-card">
      <div>
        <div class="hub-summary-text">${escapeHtml(contextSentence)}</div>
        <div class="hub-summary-meta">Aktywne sloty: ${active.length}/${lim} · liczby są dostępne po wejściu głębiej.</div>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="nav" data-page="${detailsPage}">${detailsLabel}</button>
    </div>
  `;

  const topBackupBar = document.getElementById('hub-backup-bar');
  if (topBackupBar) {
    if (backupIsDue()) {
      topBackupBar.classList.add('show');
      document.getElementById('hub-backup-text').innerHTML = `<strong>${backupStatusLabel()}</strong> Zrób eksport, żeby nie stracić danych po czyszczeniu przeglądarki.`;
    } else {
      topBackupBar.classList.remove('show');
    }
  }

  // active cards
  const grid = document.getElementById('hub-active');
  const slots = [];
  active.forEach(p => slots.push(projCardHTML(p)));
  // empty slots
  const backlogCount = visibleProjects().filter(p => p.status === 'backlog').length;
  for (let i = active.length; i < lim; i++) {
    const hasIdeas = backlogCount > 0;
    slots.push(`<div class="empty-slot" role="button" tabindex="0" aria-label="${hasIdeas ? 'Otwórz pomysły' : 'Dodaj nowy projekt'}" data-action="${hasIdeas ? 'nav' : 'openNewProject'}"${hasIdeas ? ' data-page="backlog"' : ''}>
      <div class="empty-slot-icon">+</div>
      <div class="empty-slot-label">Wolny slot</div>
      <div class="empty-slot-note">${hasIdeas ? `Masz ${backlogCount} ${backlogCount === 1 ? 'pomysł' : 'pomysłów'} czekających — gotowy żeby jeden awansować?` : 'Masz miejsce na jeden konkretny projekt.'}</div>
      <div class="empty-slot-link">${hasIdeas ? 'Przejdź do Pomysłów' : 'Dodaj projekt'}</div>
    </div>`);
  }
  grid.innerHTML = slots.join('');

  // backlog preview
  const bl = visibleProjects().filter(p => p.status === 'backlog').slice(0,3);
  const blEl = document.getElementById('hub-backlog-preview');
  if (!bl.length) {
    blEl.innerHTML = `<div style="color:var(--text3);font-size:0.8rem;padding:12px 0;">Pomysły są puste — to lista rzeczy, do których możesz wrócić, gdy zwolni się slot.</div>`;
  } else {
    blEl.innerHTML = bl.map(p => backlogItemHTML(p, true)).join('');
  }
}


// ACTIVE
// ════════════════════════════════════════
function renderActive() {
  updateSidebar();
  const active = activeProjects();
  const lim = D.settings.limit;
  document.getElementById('active-count').textContent = `${active.length} / ${lim}`;

  const lb = document.getElementById('active-limit-bar');
  if (active.length >= lim) {
    lb.classList.add('show');
    document.getElementById('active-limit-count').textContent = `${active.length}/${lim}`;
  } else lb.classList.remove('show');

  const el = document.getElementById('active-list');
  const empty = document.getElementById('active-empty');
  if (!active.length) { el.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';
  el.innerHTML = active.map(p => projCardHTML(p)).join('');
}

// ════════════════════════════════════════
// BACKLOG
// ════════════════════════════════════════
function renderBacklog() {
  const bl = visibleProjects().filter(p => p.status === 'backlog');
  document.getElementById('backlog-count').textContent = `${bl.length} pomysłów`;
  const el = document.getElementById('backlog-list');
  const empty = document.getElementById('backlog-empty');
  if (!bl.length) { el.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  el.innerHTML = bl.map(p => backlogItemHTML(p, false)).join('');
}

// ════════════════════════════════════════
// ARCHIVE
// ════════════════════════════════════════
function renderArchive() {
  const arc = visibleProjects().filter(p => p.status === 'archived').sort((a,b) => (b.archived||'').localeCompare(a.archived||''));
  document.getElementById('archive-count').textContent = `${arc.length} projektów`;
  const el = document.getElementById('archive-list');
  const empty = document.getElementById('archive-empty');
  if (!arc.length) { el.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  el.innerHTML = arc.map(p => `
    <div class="archive-item">
      <div class="arc-icon">${escapeHtml(p.icon || '📦')}</div>
      <div class="arc-info">
        <div class="arc-name">${escapeHtml(p.name)}</div>
        ${p.archiveReason ? `<div class="arc-reason">${escapeHtml(p.archiveReason)}</div>` : ''}
        <div class="arc-meta">Zarchiwizowano ${fmtShort(p.archived)} · ${p.progress}% postępu</div>
      </div>
      ${p.archiveLesson ? `<div class="arc-lesson">💡 ${escapeHtml(p.archiveLesson)}</div>` : ''}
    </div>
  `).join('');
}

// ════════════════════════════════════════
// PRIDE WALL
// ════════════════════════════════════════
function renderPride() {
  const items = [...D.pride].sort((a,b) => b.id - a.id);
  document.getElementById('pride-count').textContent = `${items.length} rzeczy`;
  const el = document.getElementById('pride-list');
  const empty = document.getElementById('pride-empty');
  if (!items.length) { el.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  el.innerHTML = items.map(p => `
    <div class="pride-item">
      <div class="pride-trophy">${escapeHtml(p.icon || '🏆')}</div>
      <div class="pride-info">
        <div class="pride-name">${escapeHtml(p.name)}</div>
        ${p.note ? `<div class="pride-note">${escapeHtml(p.note)}</div>` : ''}
      </div>
      <div class="pride-date">${fmtShort(p.date)}</div>
    </div>
  `).join('');
}



// ════════════════════════════════════════
// CARD HTML
// ════════════════════════════════════════
function projCardHTML(p) {
  const cc = catColor(p.cat);
  const dClass = touchDotClass(p.touched || p.created);
  const isDone = p.status === 'done';
  const daysLeft = p.due ? Math.max(0, Math.ceil((new Date(p.due) - new Date()) / 86400000)) : null;
  const steps = projectSteps(p);
  const visibleSteps = projectCardSteps(p);
  const progress = projectProgress(p);
  return `
    <div class="proj-card ${isDone?'done-card':''}" style="--cat-color:${cc}" role="button" tabindex="0" aria-label="Otwórz projekt ${escapeHtml(p.name)}" data-action="openEditProject" data-id="${escapeHtml(p.id)}">
      <div class="proj-top">
        <div class="proj-icon">${escapeHtml(p.icon || '📌')}</div>
        <div class="proj-meta">
          <div class="proj-cat">${escapeHtml(p.cat || 'Projekt')}</div>
          <div class="proj-name">${escapeHtml(p.name || p.title || 'Projekt')}</div>
        </div>
        <div class="proj-status-badge s-${p.status}">${statusLabel(p.status)}</div>
      </div>
      <div class="proj-prog">
        <div class="prog-track"><div class="prog-fill" style="width:${progress}%;background:${cc};"></div></div>
        <div class="prog-labels">
          <span>${projectProgressText(p)}</span>
          ${daysLeft !== null ? `<span style="color:${daysLeft<7?'var(--red)':'var(--text3)'};">za ${daysLeft} dni</span>` : ''}
        </div>
      </div>
      ${p.next ? `<div class="proj-next"><span class="next-arrow">→</span><span>${escapeHtml(p.next)}</span></div>` : ''}
      ${visibleSteps.length ? `<div class="project-steps-preview">${visibleSteps.map((step) => `<div class="project-step-chip ${step.done ? 'done' : ''}"><span>${step.done ? '✓' : '→'} ${escapeHtml(step.text)}</span></div>`).join('')}</div>` : ''}
      <div class="proj-footer">
        <div class="last-touch">
          <div class="touch-dot ${dClass}"></div>
          <span>ostatnio: ${touchLabel(p.touched || p.created)}</span>
        </div>
        <div style="display:flex;gap:6px;">
          ${p.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-action="markDone" data-id="${escapeHtml(p.id)}" data-stop="true" style="padding:3px 8px;font-size:0.62rem;">✓ Done</button>` : ''}
          ${p.status === 'active' ? `<button class="btn btn-red btn-sm" data-action="startArchive" data-id="${escapeHtml(p.id)}" data-stop="true" style="padding:3px 8px;font-size:0.62rem;">Archiwizuj</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function backlogItemHTML(p, compact) {
  return `
    <div class="backlog-item" role="button" tabindex="0" aria-label="Otwórz pomysł ${escapeHtml(p.name)}" data-action="openEditProject" data-id="${escapeHtml(p.id)}">
      <div class="bl-icon">${escapeHtml(p.icon || '💡')}</div>
      <div class="bl-name">${escapeHtml(p.name)}</div>
      ${!compact && p.why ? `<div class="bl-why">${escapeHtml(p.why)}</div>` : ''}
      <div class="bl-date">${fmtShort(p.created)}</div>
      <button class="bl-promote" data-action="promoteToActive" data-id="${escapeHtml(p.id)}" data-stop="true">
        ${limitReached() ? '🔒 Slot zajęty' : '↑ Awansuj'}
      </button>
    </div>
  `;
}

function statusLabel(s) {
  return { active:'Aktywny', backlog:'Pomysł', done:'Done ✓', archived:'Archiwum', paused:'Pauza' }[s] || s;
}


// ════════════════════════════════════════
// PROJECT CRUD
// ════════════════════════════════════════
function openNewProject(defaultStatus = 'active') {
  editingId = null;
  selectedCat = 'Gry';
  document.getElementById('mp-title').textContent = 'Nowy projekt';
  document.getElementById('mp-icon').value = '';
  document.getElementById('mp-name').value = '';
  document.getElementById('mp-why').value = '';
  document.getElementById('mp-next').value = '';
  document.getElementById('mp-notes').value = '';
  fillProjectStepsForm({ steps: [] });
  document.getElementById('mp-due').value = '';
  document.getElementById('mp-status').value = defaultStatus === 'backlog' ? 'backlog' : 'active';
  document.querySelectorAll('.cat-pill').forEach(p => { p.classList.remove('sel'); p.style.background=''; p.style.color=''; });
  document.querySelector('[data-cat="Gry"]').classList.add('sel');
  document.querySelector('[data-cat="Gry"]').style.background = catColor('Gry');
  document.querySelector('[data-cat="Gry"]').style.color = '#111';
  renderProjectHistoryBox(null);

  // show/hide archive btn
  document.getElementById('mp-footer').innerHTML = `
    <button class="btn btn-ghost" data-action="closeModal" data-modal="modal-proj">Anuluj</button>
    <button class="btn btn-lime" data-action="saveProject">Zapisz</button>
  `;
  openModal('modal-proj');
}

function openEditProject(id) {
  const p = visibleProjects().find(x => x.id === id);
  if (!p) return;
  editingId = id;
  selectedCat = p.cat || 'Gry';

  document.getElementById('mp-title').textContent = 'Edytuj projekt';
  document.getElementById('mp-icon').value = p.icon || '';
  document.getElementById('mp-name').value = p.name;
  document.getElementById('mp-why').value = p.why || '';
  document.getElementById('mp-next').value = p.next || '';
  document.getElementById('mp-notes').value = p.notes || '';
  fillProjectStepsForm(p);
  document.getElementById('mp-due').value = p.due || '';
  document.getElementById('mp-status').value = p.status === 'archived' ? 'backlog' : p.status;

  document.querySelectorAll('.cat-pill').forEach(pill => {
    const isSel = pill.dataset.cat === selectedCat;
    pill.classList.toggle('sel', isSel);
    pill.style.background = isSel ? catColor(selectedCat) : '';
    pill.style.color = isSel ? '#111' : '';
  });

  renderProjectHistoryBox(p);
  const isArchived = p.status === 'archived';
  document.getElementById('mp-footer').innerHTML = `
    <div style="display:flex;gap:8px;flex:1;">
      ${!isArchived && p.status !== 'done' ? `<button class="btn btn-red btn-sm" data-action="startArchiveClose" data-id="${escapeHtml(id)}">Archiwizuj</button>` : ''}
      ${p.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-action="markDoneClose" data-id="${escapeHtml(id)}">✓ Done</button>` : ''}
    </div>
    <button class="btn btn-ghost" data-action="closeModal" data-modal="modal-proj">Anuluj</button>
    <button class="btn btn-lime" data-action="saveProject">Zapisz</button>
  `;
  openModal('modal-proj');
}

function selectCat(btn) {
  document.querySelectorAll('.cat-pill').forEach(p => { p.classList.remove('sel'); p.style.background=''; p.style.color=''; });
  btn.classList.add('sel');
  selectedCat = btn.dataset.cat;
  btn.style.background = catColor(selectedCat);
  btn.style.color = '#111';
}

function saveProject() {
  const name = document.getElementById('mp-name').value.trim();
  if (!name) { toast('Podaj nazwę projektu.'); return; }
  const nextStep = document.getElementById('mp-next').value.trim();
  if (!nextStep) {
    toast(messageCopy('nextStepRequired'));
    document.getElementById('mp-next')?.focus();
    return;
  }
  const steps = collectProjectStepsFromForm();
  if (steps.length < 3 || steps.length > 5) {
    toast(messageCopy('stepsRequired'));
    document.getElementById('mp-step-0')?.focus();
    return;
  }

  const status = document.getElementById('mp-status').value;
  // Limit check
  if (!editingId && status === 'active' && limitReached()) {
    toast(messageCopy('limitReached', { limit: D.settings.limit }));
    return;
  }
  // check if promoting would exceed limit
  if (editingId) {
    const old = visibleProjects().find(x => x.id === editingId);
    if (old && old.status !== 'active' && status === 'active' && limitReached()) {
      toast(messageCopy('noSlot', { limit: D.settings.limit }));
      return;
    }
  }

  const proj = {
    name,
    icon: document.getElementById('mp-icon').value.trim() || '📌',
    cat: selectedCat,
    status,
    why: document.getElementById('mp-why').value.trim(),
    next: nextStep,
    notes: document.getElementById('mp-notes').value.trim(),
    steps,
    progress: Math.round((steps.filter(step => step.done).length / steps.length) * 100),
    due: document.getElementById('mp-due').value,
    touched: todayStr(),
    updatedAt: nowIso(),
    updatedByDevice: D.settings.deviceId || '',
  };

  let changedId = editingId;
  if (editingId) {
    const p = visibleProjects().find(x => x.id === editingId);
    if (p) {
      const beforeProgress = Number(p.progress || 0);
      const beforeStatus = p.status;
      Object.assign(p, proj);
      if (beforeProgress !== Number(p.progress || 0) || beforeStatus !== p.status) snapshotProject(p, 'edycja');
    }
  } else {
    changedId = String(Date.now());
    const newProj = { id: changedId, created: todayStr(), ...proj, history: [] };
    snapshotProject(newProj, 'start');
    D.projects.push(newProj);
  }

  save({ entity:'project', id:changedId, reason:'project:save' });
  closeModal('modal-proj');
  updateSidebar();
  prepDailyDefaults();
  const curPage = document.querySelector('.page.on')?.id?.replace('page-','') || 'hub';
  nav(curPage);
  toast(editingId ? '✓ Projekt zaktualizowany.' : '+ Projekt dodany.');
}

function markDone(id) {
  const p = visibleProjects().find(x => x.id === id);
  if (!p) return;
  p.status = 'done';
  p.steps = projectSteps(p).map(step => ({ ...step, done: true }));
  p.progress = 100;
  p.touched = todayStr();
  snapshotProject(p, 'done');
  save({ entity:'project', id:p.id, reason:'project:done' });
  updateSidebar();
  prepDailyDefaults();
  const curPage = document.querySelector('.page.on')?.id?.replace('page-','') || 'hub';
  nav(curPage);
  toast('🎉 Projekt ukończony! Dodaj go do ściany dumy →');
}
function toggleProjectStep(id, stepIndex) {
  const project = visibleProjects().find(item => item.id === id);
  if (!project) return;
  const steps = projectSteps(project);
  if (!steps[stepIndex]) return;
  steps[stepIndex].done = !steps[stepIndex].done;
  project.steps = steps;
  project.progress = projectProgress(project);
  project.touched = todayStr();
  snapshotProject(project, 'krok');
  save({ entity:'project', id:project.id, reason:'project:step' });
  renderCurrentPage();
}

function promoteToActive(id) {
  if (limitReached()) { toast(messageCopy('noSlot', { limit: D.settings.limit })); return; }
  const p = visibleProjects().find(x => x.id === id);
  if (!p) return;
  p.status = 'active';
  p.touched = todayStr();
  snapshotProject(p, 'wznowienie');
  save({ entity:'project', id:p.id, reason:'project:promote' });
  updateSidebar();
  prepDailyDefaults();
  const curPage = document.querySelector('.page.on')?.id?.replace('page-','') || 'hub';
  nav(curPage);
  toast(`↑ "${p.name}" awansowany do aktywnych.`);
}

// ════════════════════════════════════════
// ARCHIVE FLOW
// ════════════════════════════════════════
function startArchive(id) {
  archivingId = id;
  document.getElementById('arc-reason').value = '';
  document.getElementById('arc-lesson').value = '';
  openModal('modal-archive');
}
function confirmArchive() {
  const p = visibleProjects().find(x => x.id === archivingId);
  if (!p) return;
  p.status = 'archived';
  p.archived = todayStr();
  p.archiveReason = document.getElementById('arc-reason').value.trim();
  p.archiveLesson = document.getElementById('arc-lesson').value.trim();
  save({ entity:'project', id:p.id, reason:'project:archive' });
  closeModal('modal-archive');
  updateSidebar();
  prepDailyDefaults();
  const curPage = document.querySelector('.page.on')?.id?.replace('page-','') || 'hub';
  nav(curPage);
  toast('Projekt zarchiwizowany.');
}



  function resetProjectDraftState() {
    editingId = null;
    archivingId = null;
    selectedCat = 'Gry';
  }

  return {
    projectCardSteps, collectProjectStepsFromForm, fillProjectStepsForm, activeProjects, limitReached,
    touchDotClass, touchLabel, catColor, ensureProjectHistory, snapshotProject, hubContextSentence,
    drawProjectHistory, renderProjectHistoryBox, renderHub, renderActive, renderBacklog, renderArchive, renderPride,
    projCardHTML, backlogItemHTML, statusLabel, openNewProject, openEditProject, selectCat, saveProject,
    markDone, toggleProjectStep, promoteToActive, startArchive, confirmArchive, resetProjectDraftState
  };
}
