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
      const pid = items[i].sources?.[0];
      if (pid) loadAudit(pid);
    });
  });
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
  const traceBtn = srcCount > 0 ? `<button class="trace-btn">${srcCount} source · click to trace</button>` : '';

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
