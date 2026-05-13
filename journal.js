function journalStateProxy(getState) {
  return new Proxy({}, {
    get(_target, prop) { return getState()[prop]; },
    set(_target, prop, value) { getState()[prop] = value; return true; },
    has(_target, prop) { return prop in getState(); }
  });
}

export function createJournalDomain(ctx) {
  const D = journalStateProxy(ctx.getState);
  const {
    document, window, navigator, Blob, URL, todayStr, nowIso, fmtShort, escapeHtml,
    visibleJournalEntries, save, toast, nav, getMorningFocus, markEntityDeleted
  } = ctx;

function renderDayClosePanel() {
  const wrap = document.getElementById('day-close-list');
  const status = document.getElementById('day-close-status');
  if (!wrap || !status) return;
  const date = document.getElementById('jr-date')?.value || todayStr();
  const current = visibleJournalEntries().find(x => String(x.id) === String(editingJournalId || ''));
  const savedClose = current?.closeDay || {};
  const focus = getMorningFocus(date);
  const priorities = (focus.priorities || []).filter(Boolean);
  if (!priorities.length) {
    wrap.innerHTML = '<div style="color:var(--text3);font-size:0.78rem;">Brak porannego focusu dla tej daty.</div>';
    status.textContent = 'Brak zapisanego focusu dla tej daty.';
    return;
  }
  status.textContent = `Focus dla tej daty: ${priorities.length}.`;
  wrap.innerHTML = priorities.map((txt, idx) => {
    const key = 'p' + idx;
    const val = savedClose[key]?.status || '';
    const reason = savedClose[key]?.reason || '';
    return `<div class="day-close-item">
      <div class="day-close-item-title">${idx+1}. ${escapeHtml(txt)}</div>
      <div class="row2">
        <div class="field" style="margin:0;">
          <label class="fl">Status</label>
          <select id="dc-status-${idx}">
            <option value="">Wybierz</option>
            <option value="done" ${val === 'done' ? 'selected' : ''}>Dowiezione</option>
            <option value="partial" ${val === 'partial' ? 'selected' : ''}>Częściowo</option>
            <option value="skip" ${val === 'skip' ? 'selected' : ''}>Odpuszczone</option>
            <option value="no" ${val === 'no' ? 'selected' : ''}>Nie zrobiłem</option>
          </select>
        </div>
        <div class="field" style="margin:0;">
          <label class="fl">Powód / komentarz</label>
          <input type="text" id="dc-reason-${idx}" value="${escapeHtml(reason)}">
        </div>
      </div>
    </div>`;
  }).join('');
}


// ════════════════════════════════════════
// JOURNAL
// ════════════════════════════════════════
let editingJournalId = null;

function journalEntriesSorted() {
  return [...visibleJournalEntries()].sort((a,b) => {
    const da = (a.date || '') + 'T00:00:00';
    const db = (b.date || '') + 'T00:00:00';
    return db.localeCompare(da) || (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

function prepJournalDefaults() {
  const dateEl = document.getElementById('jr-date');
  if (dateEl && !dateEl.value) dateEl.value = todayStr();
  updateMoodMeter(document.getElementById('jr-mood')?.value || 3);
  renderJournalExport();
}

function updateMoodMeter(value) {
  const v = parseInt(value || 3, 10);
  const el = document.getElementById('jr-mood-viz');
  if (!el) return;
  el.innerHTML = Array.from({length:5}, (_,i) => `<div class="mood-dot ${i < v ? 'on' : ''}"></div>`).join('');
}

function resetJournalForm() {
  editingJournalId = null;
  const today = todayStr();
  document.getElementById('jr-date').value = today;
  document.getElementById('jr-mood').value = 3;
  document.getElementById('jr-win').value = '';
  document.getElementById('jr-gratitude').value = '';
  document.getElementById('jr-acceptance').value = '';
  document.getElementById('jr-note').value = '';
  document.getElementById('jr-close-note').value = '';
  updateMoodMeter(3);
  renderDayClosePanel();
}

function fillJournalExample() {
  document.getElementById('jr-date').value = todayStr();
  document.getElementById('jr-mood').value = 3;
  document.getElementById('jr-win').value = 'Jedna sprawa została domknięta.';
  document.getElementById('jr-gratitude').value = 'Jedna rzecz, która dzisiaj pomogła.';
  document.getElementById('jr-acceptance').value = 'Krótka prawda o dniu.';
  document.getElementById('jr-note').value = 'Notatka na jutro.';
  updateMoodMeter(3);
}

function collectDayClose(date) {
  const focus = getMorningFocus(date);
  const priorities = (focus.priorities || []).filter(Boolean);
  const closeDay = {};
  priorities.forEach((txt, idx) => {
    const status = document.getElementById('dc-status-' + idx)?.value || '';
    const reason = document.getElementById('dc-reason-' + idx)?.value.trim() || '';
    if (status || reason) closeDay['p' + idx] = { text: txt, status, reason };
  });
  return { priorities, closeDay };
}
function saveJournalEntry() {
  const date = document.getElementById('jr-date').value;
  const mood = parseInt(document.getElementById('jr-mood').value || '3', 10);
  const win = document.getElementById('jr-win').value.trim();
  const gratitude = document.getElementById('jr-gratitude').value.trim();
  const acceptance = document.getElementById('jr-acceptance').value.trim();
  const note = document.getElementById('jr-note').value.trim();
  const closeNote = document.getElementById('jr-close-note').value.trim();

  if (!date) { toast('Wybierz datę wpisu.'); return; }
  const { priorities, closeDay } = collectDayClose(date);
  if (priorities.length && !Object.keys(closeDay).length) {
    toast('Najpierw zamknij dzień: oceń poranny focus, zanim zapiszesz wpis.');
    document.getElementById('day-close-list')?.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  if (!win && !gratitude && !acceptance && !note && !closeNote) { toast('Dodaj chociaż jedno pole do wpisu.'); return; }

  const stamp = nowIso();
  const payload = {
    date,
    mood,
    win,
    gratitude,
    acceptance,
    note,
    closeDay,
    closeNote,
    createdAt: stamp,
    updatedAt: stamp,
    updatedByDevice: D.settings.deviceId || '',
  };

  let changedId = editingJournalId;
  if (editingJournalId) {
    const item = visibleJournalEntries().find(x => String(x.id) === String(editingJournalId));
    if (item) Object.assign(item, payload, { createdAt: item.createdAt || payload.createdAt });
  } else {
    changedId = String(Date.now()) + Math.random().toString(36).slice(2,5);
    D.journal.push({ id: changedId, ...payload });
  }

  save({ entity:'journalEntry', id:changedId, reason:'journal:save' });
  renderJournal();
  resetJournalForm();
  toast(editingJournalId ? 'Wpis zaktualizowany.' : 'Wpis zapisany.');
}

function editJournalEntry(id) {
  const item = visibleJournalEntries().find(x => String(x.id) === String(id));
  if (!item) return;
  editingJournalId = id;
  document.getElementById('jr-date').value = item.date || todayStr();
  document.getElementById('jr-mood').value = item.mood || 3;
  document.getElementById('jr-win').value = item.win || '';
  document.getElementById('jr-gratitude').value = item.gratitude || '';
  document.getElementById('jr-acceptance').value = item.acceptance || '';
  document.getElementById('jr-note').value = item.note || '';
  document.getElementById('jr-close-note').value = item.closeNote || '';
  updateMoodMeter(item.mood || 3);
  renderDayClosePanel();
  const close = item.closeDay || {};
  Object.entries(close).forEach(([key,val]) => {
    const idx = key.replace('p','');
    const s = document.getElementById('dc-status-' + idx); if (s) s.value = val.status || '';
    const r = document.getElementById('dc-reason-' + idx); if (r) r.value = val.reason || '';
  });
  nav('journal');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteJournalEntry(id) {
  const item = visibleJournalEntries().find(x => String(x.id) === String(id));
  if (!item) return;
  if (!confirm('Usunąć ten wpis z dziennika?')) return;
  markEntityDeleted(item);
  save({ entity:'journalEntry', id:item.id, reason:'journal:delete' });
  renderJournal();
  toast('Wpis usunięty.');
}

function formatJournalExport() {
  const limit = Math.max(1, parseInt(document.getElementById('jr-export-limit')?.value || '7', 10));
  const entries = journalEntriesSorted().slice(0, limit);
  if (!entries.length) return 'Brak wpisów do eksportu.';
  const blocks = entries.map((entry, idx) => {
    const parts = [
      `## ${entry.date || todayStr()} · nastrój ${entry.mood || 3}/5`,
      entry.win ? `Małe zwycięstwo: ${entry.win}` : '',
      entry.gratitude ? `Wdzięczność: ${entry.gratitude}` : '',
      entry.acceptance ? `Akceptacja / prawda o dniu: ${entry.acceptance}` : '',
      entry.note ? `Dodatkowa notatka: ${entry.note}` : ''
    ].filter(Boolean);
    return parts.join('\n');
  });
  return `Dziennik — eksport\n\n` + blocks.join('\n\n');
}

function renderJournalExport() {
  const box = document.getElementById('journal-export-preview');
  if (!box) return;
  box.value = formatJournalExport();
}

async function copyJournalExport() {
  const text = formatJournalExport();
  renderJournalExport();
  try {
    await navigator.clipboard.writeText(text);
    toast('Skopiowano eksport dziennika do schowka.');
  } catch (e) {
    const box = document.getElementById('journal-export-preview');
    box.focus();
    box.select();
    toast('Nie udało się skopiować automatycznie — zaznaczyłem tekst.');
  }
}

function downloadJournalExport() {
  const text = formatJournalExport();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `focus-hub-dziennik-${todayStr()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderJournal() {
  const moodInput = document.getElementById('jr-mood');
  if (moodInput) updateMoodMeter(moodInput.value);
  const items = journalEntriesSorted();
  const list = document.getElementById('journal-list');
  const empty = document.getElementById('journal-empty');
  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    list.innerHTML = items.map(item => `
      <div class="journal-item">
        <div class="journal-top">
          <div>
            <div class="journal-date">${fmtShort(item.date)} <span style="color:var(--text3);font-family:var(--mono);font-size:0.72rem;">(${item.date})</span></div>
            <div class="journal-meta">
              <span class="journal-pill">nastrój ${item.mood || 3}/5</span>
              ${item.createdAt ? `<span class="journal-pill">zapisano ${new Date(item.createdAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</span>` : ''}
            </div>
          </div>
          <div class="journal-actions" style="margin-top:0;">
            <button class="btn btn-ghost btn-sm" data-action="editJournalEntry" data-id="${escapeHtml(item.id)}">Edytuj</button>
            <button class="btn btn-red btn-sm" data-action="deleteJournalEntry" data-id="${escapeHtml(item.id)}">Usuń</button>
          </div>
        </div>
        <div class="journal-body">
          ${item.win ? `<div class="journal-block"><span class="journal-label">Małe zwycięstwo</span>${escapeHtml(item.win)}</div>` : ''}
          ${item.gratitude ? `<div class="journal-block"><span class="journal-label">Wdzięczność</span>${escapeHtml(item.gratitude)}</div>` : ''}
          ${item.acceptance ? `<div class="journal-block"><span class="journal-label">Akceptacja / prawda o dniu</span>${escapeHtml(item.acceptance)}</div>` : ''}
          ${item.closeDay && Object.keys(item.closeDay).length ? `<div class="journal-block"><span class="journal-label">Wieczorne zamknięcie dnia</span>${Object.values(item.closeDay).map(v => `${escapeHtml(v.text)} — ${escapeHtml(({done:'dowiezione',partial:'częściowo',skip:'odpuszczone',no:'nie zrobiłem'}[v.status] || v.status || 'bez oceny'))}${v.reason ? ' (' + escapeHtml(v.reason) + ')' : ''}`).join('<br>')}</div>` : ''}
          ${item.closeNote ? `<div class="journal-block"><span class="journal-label">Wniosek po zamknięciu dnia</span>${escapeHtml(item.closeNote)}</div>` : ''}
          ${item.note ? `<div class="journal-block"><span class="journal-label">Dodatkowa notatka</span>${escapeHtml(item.note)}</div>` : ''}
        </div>
      </div>
    `).join('');
  }
  renderJournalExport();
}



  return {
    renderDayClosePanel, prepJournalDefaults, updateMoodMeter, resetJournalForm, fillJournalExample,
    collectDayClose, saveJournalEntry, editJournalEntry, deleteJournalEntry, formatJournalExport,
    renderJournalExport, copyJournalExport, downloadJournalExport, renderJournal, journalEntriesSorted
  };
}
