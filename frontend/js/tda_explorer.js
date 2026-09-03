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

async function runTDA() {
  const lens        = document.getElementById('tda-lens')?.value        || 'pca';
  const n_intervals = parseInt(document.getElementById('tda-intervals')?.value  || '15');
  const overlap     = parseFloat(document.getElementById('tda-overlap')?.value   || '0.45');
  // Support both old feature-checks (overlay) and new tda-feat-list (full view)
  const checkedOld  = [...document.querySelectorAll('#feature-checks input:checked')].map(i => i.value);
  const checkedNew  = [...document.querySelectorAll('#tda-feat-list input:checked')].map(i => i.value);
  const features    = checkedNew.length ? checkedNew : checkedOld;

  if (typeof toast === 'function') toast('Running TDA pipeline…');

  try {
    const result = await fetch(`${API}/api/tda/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lens, n_intervals, overlap, features }),
    }).then(r => r.json());

    const tda = result.meta?.tda || {};
    setEl('tda-betti0', tda.betti_0 ?? 1);
    setEl('tda-betti1', tda.betti_1 ?? 0);
    setEl('tda-pers',   (tda.max_persistence || 0).toFixed(4));
    setEl('stat-loops', tda.betti_1 ?? 0);

    // Refresh findings from new pipeline state
    const fresh = await fetch(`${API}/api/findings`).then(r => r.json());
    if (typeof _findings !== 'undefined') {
      Object.assign(_findings, fresh);
    }
    if (typeof renderFindings === 'function') renderFindings(_currentLens || 'anomalies');
    if (typeof renderGraph    === 'function') renderGraph();
    if (typeof toast          === 'function') toast('TDA complete ✓');
  } catch (e) {
    if (typeof toast === 'function') toast('TDA run failed: ' + e.message);
  }
}
