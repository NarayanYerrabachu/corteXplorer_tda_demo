// ── Findings rendering ────────────────────────────────────────────────────────

let _findings = {};
let _currentLens = 'anomalies';
let _selectedFinding = null;

function setLens(name) {
  _currentLens = name;
  document.querySelectorAll('.lens').forEach(b => b.setAttribute('aria-selected', 'false'));
  const el = document.getElementById(`lens-${name}`);
  if (el) el.setAttribute('aria-selected', 'true');
  renderFindings(name);
  // Update graph to match the active lens
  if (typeof renderGraphForLens === 'function') renderGraphForLens(name);
}

function getLensData(name) {
  const map = {
    suspicious:    _findings.suspicious    || [],
    anomalies:     _findings.anomalies     || [],
    topology:      _findings.topology      || [],
    drift:         _findings.drift         || [],
    relationships: _findings.relationships || [],
    clusters:      _findings.themes        || [],
  };
  return map[name] || [];
}

function getLensTitle(name) {
  return ({
    suspicious: 'SUSPICIOUS', anomalies: 'ANOMALIES', topology: 'TOPOLOGY',
    drift: 'DRIFT', relationships: 'RELATIONSHIPS', clusters: 'CLUSTERS',
  })[name] || name.toUpperCase();
}

function renderFindings(lens) {
  const items = getLensData(lens);
  setEl('lens-title', getLensTitle(lens));
  setEl('lens-count', items.length + ' findings');
  const list = document.getElementById('findings-list');
  if (!items.length) {
    list.innerHTML = `<div class="src-empty">No ${lens} findings.</div>`;
    return;
  }
  list.innerHTML = items.map((f, i) => buildCard(f, i)).join('');
  list.querySelectorAll('.find').forEach((el, i) => {
    el.addEventListener('click', () => selectFinding(items[i], el));
  });
  list.querySelectorAll('.trace-btn').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = items[i];
      if (item.kind === 'theme') {
        // Cluster: show cluster detail, not a single project trace
        selectFinding(item, list.querySelectorAll('.find')[i]);
      } else {
        const pid = item.sources?.[0];
        if (pid) loadAudit(pid);
      }
    });
  });

  // Auto-select the first finding so it's highlighted and its Audit Trail is
  // loaded immediately (on initial load and whenever the lens changes).
  const firstEl = list.querySelector('.find');
  if (firstEl && items[0]) selectFinding(items[0], firstEl);
}

// Distinct color per finding kind
const KIND_COLOR = {
  anomaly:      'var(--signal)',    // amber  #E0A33E
  suspicious:   'var(--danger)',    // red    #E05252
  topology:     'var(--tda)',       // purple #9B7FD4
  drift:        'var(--drift)',     // blue   #4EA8DE
  relationship: 'var(--relate)',    // teal   #5E9CA6
  theme:        'var(--theme)',     // grey   #A9B4C4
};

function buildCard(f, i) {
  const kind       = f.kind  || 'anomaly';
  const score      = f.score || 0;
  const pct        = Math.min(100, Math.round(score * 100));
  const titleColor = KIND_COLOR[kind] || 'var(--text)';
  const barColor   = kind === 'suspicious' ? 'var(--danger)'
                   : kind === 'topology'   ? 'var(--tda)'
                   : kind === 'drift'      ? 'var(--drift)'
                   : kind === 'relationship' ? 'var(--relate)'
                   : 'var(--signal)';
  let chips = '';

  if (kind === 'anomaly' || kind === 'suspicious') {
    const ex    = f.extra || {};
    const iso   = ex.iso_score  != null ? ex.iso_score.toFixed(4)  : '–';
    const topo  = ex.topo_score != null ? ex.topo_score.toFixed(4) : '–';
    const flags = (ex.flagged_by || []).slice(0, 3).map(x => `<span>${esc(x)}</span>`).join('');
    chips = `<div class="chips signal">iso: ${iso} &nbsp; ae: N/A &nbsp; topo: ${topo}</div>`;
    if (flags) chips += `<div class="chips signal" style="margin-top:4px">flagged by: ${flags}</div>`;
    if (kind === 'suspicious') {
      const reasons = (ex.reasons || []).map(r => `<span>${esc(r)}</span>`).join('');
      if (reasons) chips += `<div class="chips danger">${reasons}</div>`;
    }
  } else if (kind === 'topology') {
    const lp = f.extra || {};
    chips = `<div class="chips tda"><span>birth ${(lp.birth||0).toFixed(4)}</span><span>death ${(lp.death||0).toFixed(4)}</span><span>pers ${(lp.persistence||0).toFixed(4)}</span></div>`;
  } else if (kind === 'relationship') {
    const ex = f.extra || {};
    chips = `<div class="chips relate"><span>${esc(ex.type || 'co-occurrence')}</span><span>weight ${ex.weight || ''}</span></div>`;
  } else if (kind === 'drift') {
    const ex = f.extra || {};
    const arrow = ex.direction === 'increased' ? '↑' : '↓';
    chips = `<div class="chips drift"><span>${arrow} ${esc(ex.feature || '')}</span><span>Δ ${(ex.delta || 0).toFixed(4)}</span></div>`;
  } else if (kind === 'theme') {
    const ex = f.extra || {};
    chips = `<div class="chips"><span style="color:var(--theme);border:1px solid rgba(169,180,196,.3);border-radius:2px;padding:0 5px;background:rgba(169,180,196,.07)">${ex.n_records || ''} projects</span></div>`;
  }

  const srcCount = (f.sources || []).length;
  const traceBtn = srcCount > 0
    ? (kind === 'theme'
        ? `<button class="trace-btn" style="color:var(--theme);border-color:rgba(169,180,196,.3)">→ view cluster detail</button>`
        : `<button class="trace-btn">${srcCount} source · click to trace</button>`)
    : '';

  return `
  <div class="find k-${kind}" aria-selected="false" data-idx="${i}"
       style="border-left-color:${titleColor}40">
    <div class="ft">
      <span class="title" style="color:${titleColor}">${esc(f.title || '')}</span>
      <div class="sev">
        <div class="bar"><i style="width:${pct}%;background:${barColor}"></i></div>
        <span class="v" style="color:${barColor}">${score.toFixed(3)}</span>
      </div>
    </div>
    <div class="meta">${esc((f.detail || '').slice(0, 130))}</div>
    ${chips}
    ${traceBtn}
  </div>`;
}

function selectFinding(f, el) {
  document.querySelectorAll('.find').forEach(c => c.setAttribute('aria-selected', 'false'));
  el.setAttribute('aria-selected', 'true');
  _selectedFinding = f;

  const btn = document.getElementById('btn-sum-selected');
  if (btn) btn.disabled = false;

  // Clusters get a dedicated detail panel
  if (f.kind === 'theme') {
    _showClusterDetail(f);
    return;
  }

  // Relationship / drift / topology — show inline summary
  const pid = (f.sources || [])[0];
  if (pid && typeof loadAudit === 'function') {
    loadAudit(pid);
  } else if (typeof switchRTab === 'function') {
    const body = document.getElementById('audit-content');
    if (body) {
      body.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px">${esc(f.title||'').slice(0,60)}</div>
        <div class="audit-step"><span class="step-icon">📊</span>
          <div class="step-body"><div class="label">Score</div>
          <div class="val">${(f.score||0).toFixed(4)}</div></div></div>
        <div class="audit-step"><span class="step-icon">ℹ️</span>
          <div class="step-body"><div class="label">Detail</div>
          <div class="val">${esc(f.detail||'')}</div></div></div>
        <div class="audit-verified">✓ TRACEABLE</div>`;
      switchRTab('audit');
    }
  }
}

// exposed so graph.js bar click can call it directly
function _showClusterDetail(f) {
  const ex      = f.extra || {};
  const stats   = ex.stats || {};
  const sources = f.sources || [];
  const nRec    = ex.n_records || sources.length;
  const cid     = ex.cluster_id ?? '?';

  // Build stat rows
  const statRows = Object.entries(stats).map(([col, s]) => {
    const label = col.replace(/_/g,' ').replace('Cost Overran in %','Cost Overrun').replace('Project Success','Success Rate').replace('Evaluation Lag Days','Eval Lag');
    const mean  = typeof s.mean === 'number' ? s.mean.toFixed(3) : '–';
    const std   = typeof s.std  === 'number' ? s.std.toFixed(3)  : '–';
    return `
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px">
        <span style="color:var(--mute);font-family:'IBM Plex Mono',monospace">${esc(label)}</span>
        <span style="color:var(--text)">mean <b style="color:var(--theme)">${mean}</b> &nbsp; σ ${std}</span>
      </div>`;
  }).join('');

  // Source project chips
  const chips = sources.slice(0, 15).map(pid =>
    `<span style="font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--tda);
      background:rgba(155,127,212,.08);border:1px solid rgba(155,127,212,.25);
      border-radius:2px;padding:1px 6px;cursor:pointer"
      onclick="autoInterrogate('${esc(pid)}')">${esc(pid)}</span>`
  ).join(' ');

  const body = document.getElementById('audit-content');
  if (!body) return;

  body.innerHTML = `
    <div style="padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--line)">
      <div style="font-size:11px;color:var(--theme);font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">CLUSTER ${cid}</div>
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">${esc(f.title||'')}</div>
      <div style="font-size:12px;color:var(--mute)">${nRec.toLocaleString()} aid projects &nbsp;·&nbsp; ${sources.length} sample records</div>
    </div>

    ${statRows ? `
    <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-family:'IBM Plex Mono',monospace;margin-bottom:8px">CLUSTER STATISTICS</div>
    ${statRows}
    <div style="margin-top:14px"></div>` : ''}

    <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-family:'IBM Plex Mono',monospace;margin-bottom:8px">SAMPLE PROJECTS</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">${chips || '<span style="color:var(--faint)">No sources</span>'}</div>

    <button class="sum-btn" style="font-size:11px" onclick="summarize('selected')">AI: Summarize this cluster</button>
    <div class="audit-verified" style="margin-top:10px">✓ TRACEABLE — ${nRec.toLocaleString()} projects</div>`;

  if (typeof switchRTab === 'function') switchRTab('audit');
}

function renderFindingsRaw(items, title) {
  setEl('lens-title', title);
  setEl('lens-count', items.length + ' results');
  const list = document.getElementById('findings-list');
  if (!items.length) { list.innerHTML = '<div class="src-empty">No results.</div>'; return; }
  list.innerHTML = items.map((f, i) => buildCard(f, i)).join('');
  list.querySelectorAll('.find').forEach((el, i) => {
    el.addEventListener('click', () => selectFinding(items[i], el));
  });
}
