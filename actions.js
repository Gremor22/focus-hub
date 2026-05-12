function boolFromDataset(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function bindActionDelegation({
  document,
  actions,
  clickActions,
  defaultLandingPage,
  toast
}) {
  if (document.documentElement.dataset.actionDelegationBound === '1') return;
  document.documentElement.dataset.actionDelegationBound = '1';

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (el.dataset.stop === 'true' || action === 'stopPropagation') event.stopPropagation();
    try {
      if (action === 'stopPropagation') return;
      if (action === 'nav') return actions.nav(el.dataset.page || defaultLandingPage());
      if (action === 'mobileNav') return actions.mobileNav(el.dataset.page || defaultLandingPage());
      if (action === 'openJournalAndFocus') { actions.nav('journal'); actions.focusJournalInput(); return; }
      if (action === 'prefillFocusMobile') { actions.nav('daily'); actions.prefillMorningFocusFromTasks(); actions.toggleMobileMenu(false); return; }
      if (action === 'toggleMobileMenu') return actions.toggleMobileMenu(boolFromDataset(el.dataset.force));
      if (action === 'openNewProject') return actions.openNewProject(el.dataset.status || undefined);
      if (action === 'jumpUpcomingDate') return actions.jumpUpcomingDate(Number(el.dataset.delta || 0));
      if (action === 'closeModal') return actions.closeModal(el.dataset.modal || '');
      if (action === 'selectCat') return actions.selectCat(el);
      if (action === 'setThemePreset') return actions.setThemePreset(el.dataset.value || 'lime');
      if (action === 'startArchiveClose') { actions.startArchive(el.dataset.id || ''); actions.closeModal('modal-proj'); return; }
      if (action === 'markDoneClose') { actions.markDone(el.dataset.id || ''); actions.closeModal('modal-proj'); return; }
      if (['toggleRitual','toggleDailyTask','setDailyPriorityTask','setDailyReason','setTaskReminder','clearTaskReminder','deleteDailyTask','moveTaskToToday','editJournalEntry','deleteJournalEntry','openEditProject','markDone','startArchive','promoteToActive','updateRitual','deleteRitual'].includes(action)) {
        return actions[action]?.(el.dataset.id || '');
      }
      if (clickActions[action]) return clickActions[action]();
    } catch (err) {
      console.error(err);
      toast('Nie udało się wykonać akcji.');
    }
  });

  document.addEventListener('change', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    try {
      if (action === 'renderDaily') return actions.renderDaily();
      if (action === 'renderUpcoming') return actions.renderUpcoming();
      if (action === 'renderDayClosePanel') return actions.renderDayClosePanel();
      if (action === 'importFullBackup') return actions.importFullBackup(event);
      if (action === 'syncTaskReminderForm') return actions.syncTaskReminderForm(el.dataset.prefix || '');
      if (action === 'setAppMode') return actions.setAppMode(el.value);
      if (action === 'setProjectLimit') return actions.setProjectLimit(el.value);
      if (action === 'toggleSetting') return actions.toggleSetting(el.dataset.key || '', !!el.checked);
      if (action === 'setReminderSetting') {
        const value = el.dataset.valueSource === 'checked' ? !!el.checked : el.value;
        return actions.setReminderSetting(el.dataset.key || '', value);
      }
      if (action === 'setThemeMode') return actions.setThemeMode(el.value);
      if (action === 'updateCustomTheme') return actions.updateCustomTheme();
      if (action === 'toggleSystemNotifications') return actions.toggleSystemNotifications(!!el.checked);
    } catch (err) {
      console.error(err);
      toast('Nie udało się zapisać ustawienia.');
    }
  });

  document.addEventListener('input', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'updateMoodMeter') actions.updateMoodMeter(el.value);
  });
}
