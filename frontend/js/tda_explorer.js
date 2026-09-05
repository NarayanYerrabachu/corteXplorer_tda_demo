// ── TDA Explorer ──────────────────────────────────────────────────────────────

function buildFeatureChecks(cols) {
  const grid = document.getElementById('feature-checks');
  if (!grid) return;
  const preferred = ['Cost_Overran_in %', 'CPI_Score', 'Evaluation_Lag_Days', 'Project_Success', 'Initial_Budget_USD'];
  grid.innerHTML = cols.map(c => `
    <label class="tda-check">
      <input type="checkbox" value="${esc(c)}" ${preferred.includes(c) ? 'checked' : ''}>
      ${esc(c.replace(/_/g, ' '))}
    </label>`).join('');
}

// Monotonic run token: a stale/slow response must never overwrite a newer run's result.
let _tdaRunSeq = 0;

async function runTDA() {
  const lens        = document.getElementById('tda-lens')?.value        || 'pca';
  const n_intervals = parseInt(document.getElementById('tda-intervals')?.value  || '15');
  const overlap     = parseFloat(document.getElementById('tda-overlap')?.value   || '0.45');
  // Support both old feature-checks (overlay) and new tda-feat-list (full view)
  const checkedOld  = [...document.querySelectorAll('#feature-checks input:checked')].map(i => i.value);
  const checkedNew  = [...document.querySelectorAll('#tda-feat-list input:checked')].map(i => i.value);
  const features    = checkedNew.length ? checkedNew : checkedOld;

  const mySeq   = ++_tdaRunSeq;             // claim latest-run ownership
  const lensSel = document.getElementById('tda-lens');
  const runBtn  = document.getElementById('btn-run-tda') || document.querySelector('[onclick*="runTDA"]');
  if (lensSel) lensSel.disabled = true;     // block overlapping runs from the dropdown
  if (runBtn)  runBtn.disabled  = true;
  if (typeof toast === 'function') toast(`Running TDA (${lens})…`);

  try {
    const result = await fetch(`${API}/api/tda/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lens, n_intervals, overlap, features }),
    }).then(r => r.json());
    if (mySeq !== _tdaRunSeq) return;       // a newer run superseded us — drop this result

    const tda = result.meta?.tda || {};
    setEl('tda-betti0', tda.betti_0 ?? 1);
    setEl('tda-betti1', tda.betti_1 ?? 0);
    setEl('tda-pers',   (tda.max_persistence || 0).toFixed(4));
    setEl('stat-loops', tda.betti_1 ?? 0);

    // Refresh findings, graph data, and redraw
    const fresh = await fetch(`${API}/api/findings`).then(r => r.json());
    if (mySeq !== _tdaRunSeq) return;
    if (typeof _findings     !== 'undefined') Object.assign(_findings, fresh);
    if (typeof _graphData    !== 'undefined') { _graphData = null; _findingsData = null; }
    if (typeof renderFindings       === 'function') renderFindings(_currentLens || 'anomalies');
    if (typeof drawTDAExplorerGraph === 'function') drawTDAExplorerGraph();
    if (typeof toast                === 'function') toast(`TDA complete ✓ (${lens})`);
  } catch (e) {
    if (mySeq === _tdaRunSeq && typeof toast === 'function') toast('TDA run failed: ' + e.message);
  } finally {
    if (mySeq === _tdaRunSeq) {             // only re-enable once the latest run settles
      if (lensSel) lensSel.disabled = false;
      if (runBtn)  runBtn.disabled  = false;
    }
  }
}
