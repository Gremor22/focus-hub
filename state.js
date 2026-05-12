export function createStateStore({
  getCurrent,
  setCurrent,
  defaultState,
  clone,
  applyChangeMetadata,
  saveLocalCache,
  pushStateToCloud,
  renderCurrentPage
}) {
  const subscribers = new Set();

  function getState() {
    return getCurrent();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function notifyStateSubscribers(metadata = {}) {
    const current = getCurrent();
    subscribers.forEach(listener => {
      try { listener(current, metadata); } catch (error) { console.error('State subscriber failed', error); }
    });
  }

  function setState(nextState, metadata = {}) {
    const next = applyChangeMetadata(nextState || defaultState(), metadata);
    setCurrent(next);
    saveLocalCache({ skipNormalize: true });
    pushStateToCloud(metadata.reason || 'save', { skipLocal: true });
    notifyStateSubscribers(metadata);
    if (metadata.render) renderCurrentPage();
    return getCurrent();
  }

  function updateState(mutator, metadata = {}) {
    const draft = clone(getCurrent());
    const result = typeof mutator === 'function' ? mutator(draft) : draft;
    return setState(result || draft, metadata);
  }

  return {
    getState,
    subscribe,
    notifyStateSubscribers,
    setState,
    updateState
  };
}

export function stateHash(obj) {
  try { return JSON.stringify(obj); } catch (_e) { return String(Date.now()); }
}

export function remoteSnapshotDecision(currentState, incomingState, { forceApply = false, mergeAppState } = {}) {
  const incomingHash = stateHash(incomingState);
  const runtimeHash = stateHash(currentState);
  const shouldApply = !!forceApply || incomingHash !== runtimeHash;
  const nextState = shouldApply && typeof mergeAppState === 'function'
    ? mergeAppState(currentState, incomingState)
    : currentState;
  return {
    incomingHash,
    runtimeHash,
    mergedHash: stateHash(nextState),
    shouldApply,
    shouldWriteRemote: false,
    state: nextState
  };
}

export function localPushDecision(state, remoteHash, pendingHash = '', { clone, normalizeAppState } = {}) {
  const cleanState = normalizeAppState(clone(state));
  const hash = stateHash(cleanState);
  return {
    cleanState,
    hash,
    shouldPush: hash !== remoteHash || !!pendingHash
  };
}

export function syncStatusAfterRemoteWrite(pendingHash, remoteHash) {
  return pendingHash && pendingHash !== remoteHash
    ? { mode: '', text: 'Synchronizowanie...' }
    : { mode: 'ok', text: 'Zsynchronizowano' };
}

export function syncStatusView(status) {
  const views = {
    local: { mode: '', text: 'Zapisano lokalnie' },
    syncing: { mode: '', text: 'Synchronizowanie...' },
    synced: { mode: 'ok', text: 'Zsynchronizowano' },
    offline: { mode: 'bad', text: 'Brak połączenia' },
    error: { mode: 'bad', text: 'Błąd synchronizacji' }
  };
  return views[status] || views.local;
}
