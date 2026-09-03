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

    // Render initial findings (anomalies) + Anomaly graph
    // Invalidate cache so a fresh fetch happens
    if (typeof _graphData    !== 'undefined') _graphData    = null;
    if (typeof _findingsData !== 'undefined') _findingsData = null;
    if (typeof _wantedLens   !== 'undefined') _wantedLens   = null;
    renderFindings('anomalies');
    // Delay graph render slightly so DOM is settled and lens state is set
    setTimeout(() => {
      if (typeof renderGraphForLens === 'function') renderGraphForLens('anomalies');
    }, 100);

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
  // Report → in-page view (no navigation, no new tab)
  const btn = document.getElementById('btn-report');
  if (btn) btn.onclick = () => showView('report');

  const ai = document.getElementById('btn-ai-report');
  if (ai) ai.onclick = () => {
    showView('report');
    // Trigger AI section load after report view is open
    setTimeout(loadInlineAIReport, 300);
  };

  // Wire up the AI Insights button inside the report view
  const aiInline = document.getElementById('btn-report-ai-inline');
  if (aiInline) aiInline.onclick = loadInlineAIReport;
}

// ── View switching (Analysis ↔ TDA Explorer) ─────────────────────────────────

let _activeView = 'analysis';

const VIEWS = ['work', 'view-tda-explorer', 'view-report', 'view-gov-aid-report'];

function showView(name) {
  _activeView = name;

  // Hide all switchable views
  const work = document.querySelector('.work');
  if (work) work.style.display = 'none';
  VIEWS.filter(v => v !== 'work').forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (name === 'tda-explorer') {
    const el = document.getElementById('view-tda-explorer');
    if (el) el.style.display = 'flex';
    buildTDAFeatureList();
    drawTDAExplorerGraph();

  } else if (name === 'gov-aid-report') {
    const el = document.getElementById('view-gov-aid-report');
    if (el) el.style.display = 'flex';
    // Load iframe on first open (use data-loaded flag — empty src returns base URL not '')
    const iframe = document.getElementById('gov-aid-iframe');
    if (iframe && !iframe.getAttribute('data-loaded')) {
      iframe.src = `${API}/gov-aid-report`;
      iframe.setAttribute('data-loaded', '1');
    }

  } else if (name === 'report') {
    const el = document.getElementById('view-report');
    if (el) el.style.display = 'flex';
    loadInlineReport();

  } else {
    // analysis (default)
    if (work) work.style.display = '';
  }

  // Update nav highlight
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  const navMap = {
    'tda-explorer': 'btn-explorer',
    'report':       'btn-report',
    'analysis':     null,
  };
  const btnId = navMap[name];
  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  } else {
    const btn = document.querySelector('.navbtn[data-nav="analysis"]');
    if (btn) btn.classList.add('active');
  }
}

async function loadInlineReport() {
  const pre = document.getElementById('report-content');
  if (!pre) return;
  pre.textContent = 'Loading report…';
  try {
    const data = await fetch(`${API}/api/report`).then(r => r.json());
    pre.textContent = data.report || 'No report data.';
  } catch(e) {
    pre.textContent = 'Report unavailable — check the API server.';
  }
}

async function loadInlineAIReport() {
  const btn     = document.getElementById('btn-report-ai-inline');
  const section = document.getElementById('report-ai-section');
  const textEl  = document.getElementById('report-ai-text');
  if (!btn || !section || !textEl) return;
  btn.textContent = 'Loading AI insights…';
  btn.disabled    = true;
  try {
    const data = await fetch(`${API}/api/report/ai`).then(r => r.json());
    if (data.ai_section) {
      textEl.innerHTML = data.ai_section.replace(/\n/g, '<br>');
      section.style.display = 'block';
      btn.textContent = '✓ AI Insights loaded';
    } else {
      textEl.innerHTML = `<span style="color:var(--faint)">${data.ai_note || 'No AI insights — set OPENAI_API_KEY in .env'}</span>`;
      section.style.display = 'block';
      btn.textContent = 'AI Insights';
      btn.disabled    = false;
    }
  } catch(e) {
    btn.textContent = 'AI unavailable';
    btn.disabled    = false;
  }
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

  // Wait 2 frames + delay so flex/grid layout is fully computed before measuring
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 80));

  try {
    const [graphData, findingsData] = await Promise.all([
      fetch(`${API}/api/tda/graph`).then(r => r.json()),
      fetch(`${API}/api/findings`).then(r => r.json()),
    ]);

    // Compute graph dimensions from window size + known fixed column widths
    // (container.offsetWidth is unreliable for flex/grid items during transition)
    const FEAT_COL = 190, CFG_COL = 270, PADDING = 40;
    const svgW = Math.max(window.innerWidth - FEAT_COL - CFG_COL - PADDING, 400);
    const svgH = Math.max(window.innerHeight - 100 - 60, 350); // minus header/nav/caption
    svgEl.setAttribute('width',  svgW);
    svgEl.setAttribute('height', svgH);
    svgEl.style.width  = svgW + 'px';
    svgEl.style.height = svgH + 'px';

    // Draw directly into #tda-explorer-graph by temporarily aliasing the ID
    const mainSvg = document.getElementById('graph-svg');
    if (mainSvg) mainSvg.id = '__graph_hidden__';
    svgEl.id = 'graph-svg';

    drawTopologyScatter(graphData, findingsData);

    // Restore IDs
    svgEl.id = 'tda-explorer-graph';
    if (mainSvg) mainSvg.id = 'graph-svg';

    // Populate H₁ loop list
    const h1list = document.getElementById('tda-h1-list');
    const h1     = findingsData.meta?.tda?.h1_features || [];
    if (h1list) {
      h1list.innerHTML = h1.slice(0, 5).map((lp, i) =>
        `<div style="padding:3px 0;border-bottom:1px solid var(--line)">
           Loop ${i+1}: pers <b style="color:var(--tda)">${(lp.persistence||0).toFixed(4)}</b>
           &nbsp;birth ${(lp.birth||0).toFixed(3)} → death ${(lp.death||0).toFixed(3)}
         </div>`
      ).join('') || '<div style="color:var(--faint)">No H₁ loops detected</div>';
    }
  } catch(e) {
    d3.select('#tda-explorer-graph').selectAll('*').remove();
    d3.select('#tda-explorer-graph').append('text')
      .attr('x','50%').attr('y','50%').attr('fill','#878e9c').attr('font-size',12)
      .attr('text-anchor','middle').attr('dominant-baseline','middle')
      .text('Graph unavailable — ' + e.message);
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
