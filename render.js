export function createRenderController({
  pageRenderers,
  renderGlobalUI,
  getCurrentPageId,
  toast,
  escapeHtml,
  document
}) {
  function safeRender(fn, fallbackId) {
    try { fn(); }
    catch (e) {
      console.error(e);
      if (fallbackId) {
        const el = document.getElementById(fallbackId);
        if (el) el.innerHTML = `<div class="review-item">Wystąpił błąd renderowania: ${escapeHtml(e.message || 'nieznany błąd')}</div>`;
      }
      toast('Wystąpił błąd widoku. Odśwież stronę.');
    }
  }

  function renderPageContent(page = getCurrentPageId()) {
    const render = pageRenderers(safeRender)[page];
    if (render) render();
  }

  function renderCurrentPage() {
    renderGlobalUI();
    renderPageContent();
  }

  function renderAll() {
    Object.values(pageRenderers(safeRender)).forEach(render => {
      try { render(); } catch (e) { console.error(e); }
    });
    renderGlobalUI();
  }

  return {
    safeRender,
    renderPageContent,
    renderCurrentPage,
    renderAll
  };
}
