// ── Main app bootstrap (index.html) ──────────────────────────────────────────

async function init() {
  try {
    const [findingsRes, datasetRes, cyclesRes] = await Promise.all([
      fetch(`${API}/api/findings`).then(r => r.json()),
      fetch(`${API}/api/dataset`).then(r => r.json()),
      fetch(`${API}/api/tda/cycles`).then(r => r.json()),
    ]);

    _findings    = findingsRes;
    _featureCols = findingsRes.meta?.numeric_features || [];

    // Header stats
    setEl('stat-records', (datasetRes.total_records || 0).toLocaleString());
    setEl('stat-loops',    cyclesRes.betti_1 || 0);

    // TDA metrics panel
    setEl('tda-betti0', cyclesRes.betti_0        || 1);
    setEl('tda-betti1', cyclesRes.betti_1        || 0);
    setEl('tda-pers',   (cyclesRes.max_persistence || 0).toFixed(4));

    // Lens counts
    setEl('ct-suspicious',    (_findings.suspicious    || []).length);
    setEl('ct-anomalies',     (_findings.anomalies     || []).length);
    setEl('ct-topology',      (_findings.topology      || []).length);
    setEl('ct-drift',         (_findings.drift         || []).length);
    setEl('ct-relationships', (_findings.relationships || []).length);
    setEl('ct-clusters',      (_findings.themes        || []).length);

    // Feature checkboxes in TDA Explorer
    buildFeatureChecks(_featureCols);

    // Render initial findings (anomalies) + matching graph
    // Invalidate any cached graph data so fresh fetch happens
    if (typeof _graphData !== 'undefined') { _graphData = null; _findingsData = null; }
    renderFindings('anomalies');
    if (typeof renderGraphForLens === 'function') renderGraphForLens('topology'); // start with topology scatter

    // Init chat overlay
    initChatOverlay();

  } catch (e) {
    toast('⚠ Cannot connect to API at ' + API);
    const list = document.getElementById('findings-list');
    if (list) list.innerHTML = `<div class="src-empty">Cannot connect to CorteXplorer API.<br><code>${API}</code><br>Start with: <code>bash run.sh</code></div>`;
  }
}

// ── Summarize ─────────────────────────────────────────────────────────────────

async function summarize(mode) {
  const el = document.getElementById('summarize-content');
  if (el) el.textContent = 'Generating summary…';
  if (typeof switchRTab === 'function') switchRTab('summarize');

  let body = { kind: 'overview' };
  if (mode === 'selected' && _selectedFinding) {
    const src = (_selectedFinding.sources || [])[0];
    if (_selectedFinding.kind === 'theme') {
      body = { kind: 'cluster', id: String(_selectedFinding.extra?.cluster_id ?? 0) };
    } else if (_selectedFinding.kind === 'anomaly' && src) {
      body = { kind: 'anomaly', id: src };
    } else if (src) {
      body = { kind: 'record', id: src };
    }
  }

  try {
    const data = await fetch(`${API}/api/summarize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).then(r => r.json());
    if (el) el.innerHTML = `<div class="sum-text">${esc(data.summary || '').replace(/\n/g, '<br>')}</div>`;
  } catch (e) {
    if (el) el.textContent = 'Summary unavailable.';
  }
}

// ── Interrogate ───────────────────────────────────────────────────────────────

async function autoInterrogate(id) {
  const body = document.getElementById('int-body');
  if (!body) return;
  body.innerHTML = 'Loading…';
  try {
    const data = await fetch(`${API}/api/interrogate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ target: 'record', id }),
    }).then(r => r.json());
    body.innerHTML = `
      <div style="font-size:12.5px;line-height:1.6;color:var(--mute)">${esc(data.explanation).replace(/\n/g,'<br>')}</div>
      <div class="audit-verified" style="margin-top:12px">✓ TRACEABLE</div>`;
  } catch (e) {
    body.innerHTML = '<div class="src-empty">Interrogation failed.</div>';
  }
}

async function sendInterrogate() {
  const inp  = document.getElementById('int-input');
  const q    = inp?.value?.trim();
  if (!q) return;
  if (inp) inp.value = '';
  const body = document.getElementById('int-body');
  if (body) body.innerHTML = 'Thinking…';
  try {
    const data = await fetch(`${API}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: q }),
    }).then(r => r.json());
    if (body) body.innerHTML = `
      <div style="font-size:12.5px;line-height:1.6;color:var(--text)">${esc(data.answer).replace(/\n/g,'<br>')}</div>
      <div class="audit-verified" style="margin-top:8px">✓ TRACEABLE</div>`;
  } catch (e) {
    if (body) body.innerHTML = '<div class="src-empty">Interrogation unavailable.</div>';
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

function initSearch() {
  const inp = document.getElementById('search-input');
  if (!inp) return;
  inp.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim();
    if (!q) return;
    try {
      const data = await fetch(`${API}/api/query`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: q, top_k: 20 }),
      }).then(r => r.json());
      document.querySelectorAll('.lens').forEach(b => b.setAttribute('aria-selected', 'false'));
      renderFindingsRaw(data.results, `SEARCH: "${q}"`);
    } catch (e) {
      toast('Search failed');
    }
  });
}

// ── Report buttons ────────────────────────────────────────────────────────────

function initReportButtons() {
  const btn = document.getElementById('btn-report');
  if (btn) btn.onclick = async () => {
    try {
      const data = await fetch(`${API}/api/report`).then(r => r.json());
      const win  = window.open('', '_blank');
      win.document.write(`<pre style="background:#13151A;color:#D9DCE3;padding:24px;font-family:monospace;font-size:12px;line-height:1.6">${data.report}</pre>`);
      win.document.close();
    } catch (e) { toast('Report unavailable'); }
  };

  const ai = document.getElementById('btn-ai-report');
  if (ai) ai.onclick = async () => {
    toast('Generating AI report…');
    try {
      const data = await fetch(`${API}/api/report/ai`).then(r => r.json());
      const content = data.report +
        (data.ai_section ? '\n\n── AI INSIGHTS ──\n' + data.ai_section : '\n\n' + (data.ai_note || ''));
      const win = window.open('', '_blank');
      win.document.write(`<pre style="background:#13151A;color:#D9DCE3;padding:24px;font-family:monospace;font-size:12px;line-height:1.6">${content}</pre>`);
      win.document.close();
    } catch (e) { toast('AI report unavailable'); }
  };
}

// ── View switching (Analysis ↔ TDA Explorer) ─────────────────────────────────

let _activeView = 'analysis';

function showView(name) {
  _activeView = name;
  const work    = document.querySelector('.work');
  const explorer = document.getElementById('view-tda-explorer');
  if (name === 'tda-explorer') {
    if (work)     work.style.display    = 'none';
    if (explorer) explorer.style.display = 'flex';
    // Populate feature list if not yet done
    buildTDAFeatureList();
    // Draw topology graph in explorer panel
    drawTDAExplorerGraph();
  } else {
    if (work)     work.style.display    = '';
    if (explorer) explorer.style.display = 'none';
  }
  // Update nav active state
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  const activeBtn = name === 'tda-explorer'
    ? document.getElementById('btn-explorer')
    : document.querySelector('.navbtn[data-nav="analysis"]');
  if (activeBtn) activeBtn.classList.add('active');
}

function buildTDAFeatureList() {
  const list = document.getElementById('tda-feat-list');
  if (!list || list.children.length > 0) return; // already built
  const preferred = ['Cost_Overran_in %','CPI_Score','Evaluation_Lag_Days','Project_Success','Initial_Budget_USD'];
  const cols = _featureCols.length ? _featureCols : preferred;
  list.innerHTML = cols.map(c => `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px 8px;
                  border-radius:3px;background:var(--panel);border:1px solid var(--line);
                  font-size:11.5px;color:var(--mute);font-family:'IBM Plex Mono',monospace">
      <input type="checkbox" value="${esc(c)}" ${preferred.includes(c)?'checked':''}
             style="accent-color:var(--tda)">
      <span>${esc(c.replace(/_/g,' '))}</span>
    </label>`).join('');
}

async function drawTDAExplorerGraph() {
  const svgEl = document.getElementById('tda-explorer-graph');
  if (!svgEl || typeof d3 === 'undefined') return;
  try {
    const [graphData, findingsData] = await Promise.all([
      fetch(`${API}/api/tda/graph`).then(r => r.json()),
      fetch(`${API}/api/findings`).then(r => r.json()),
    ]);
    const scoreMap = {};
    (findingsData.anomalies || []).forEach(a =>
      (a.sources||[]).forEach(s => { scoreMap[s] = a.score||0; })
    );
    // Use the tda-explorer-graph SVG (different from main graph-svg)
    const origSvg = document.getElementById('graph-svg');
    // Temporarily swap so drawTopologyScatter uses the explorer SVG
    if (origSvg) origSvg.id = '_graph-svg-hidden';
    svgEl.id = 'graph-svg';
    drawTopologyScatter(graphData, findingsData);
    svgEl.id = 'tda-explorer-graph';
    if (origSvg) origSvg.id = 'graph-svg';

    // Populate H1 list
    const h1list = document.getElementById('tda-h1-list');
    const h1 = findingsData.meta?.tda?.h1_features || [];
    if (h1list) {
      h1list.innerHTML = h1.slice(0,5).map((lp, i) =>
        `<div>Loop ${i+1}: pers <b style="color:var(--tda)">${(lp.persistence||0).toFixed(4)}</b>
         &nbsp; birth ${(lp.birth||0).toFixed(3)} → death ${(lp.death||0).toFixed(3)}</div>`
      ).join('') || '<div style="color:var(--faint)">No H₁ loops detected</div>';
    }
  } catch(e) {
    const svgD = d3.select('#tda-explorer-graph');
    svgD.selectAll('*').remove();
    svgD.append('text').attr('x','50%').attr('y','50%')
      .attr('fill','#878e9c').attr('font-size',12).attr('text-anchor','middle')
      .attr('dominant-baseline','middle').text('Graph unavailable');
  }
}

function initExplorerToggle() {
  const btn = document.getElementById('btn-explorer');
  if (btn) btn.onclick = () => {
    if (_activeView === 'tda-explorer') showView('analysis');
    else showView('tda-explorer');
  };
}

// ── Interrogate toggle ────────────────────────────────────────────────────────

function initInterrogateToggle() {
  const btn = document.getElementById('btn-interrogate');
  if (btn) btn.onclick = () => {
    document.getElementById('interrogate-panel')?.classList.toggle('open');
    if (_selectedFinding) {
      const src = (_selectedFinding.sources || [])[0];
      if (src) autoInterrogate(src);
    }
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────
// Scripts sit at bottom of <body> so DOM is already ready — call directly.

let _featureCols = [];

initSearch();
initReportButtons();
initExplorerToggle();
initInterrogateToggle();
init();
