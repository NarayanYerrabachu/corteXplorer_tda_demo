// All graphs render directly into #graph-svg — no HTML layer switching needed.
// CSS arc-flow animations apply to SVG elements created via D3 because the
// @keyframes arcpulse rule is injected into <head> and matches by class name.

// ── Context-sensitive graph panel ────────────────────────────────────────────
// Renders different graph types based on the active lens:
//   topology     → Topology Mapper scatter (dots × time)
//   relationships → Bipartite relationship chart (country ↔ sector)
//   suspicious   → Suspicious records bubble chart
//   anomalies    → Anomaly score scatter
//   clusters     → Cluster bar chart
//   drift        → Temporal trend lines

let _graphData    = null;   // cached from API
let _findingsData = null;   // cached from API
let _wantedLens   = null;   // latest requested lens (cancels stale async renders)

// ── Entry point: called by findings.js when lens changes ──────────────────────
async function renderGraphForLens(lensName) {
  _wantedLens = lensName;   // record intent before any await
  try {
    if (!_graphData || !_findingsData) {
      const [g, f] = await Promise.all([
        fetch(`${API}/api/tda/graph`).then(r => r.json()),
        fetch(`${API}/api/findings`).then(r => r.json()),
      ]);
      _graphData    = g;
      _findingsData = f;
    }
    // Abort if a newer lens request arrived while we were fetching
    if (_wantedLens !== lensName) return;

    switch (lensName) {
      case 'topology':      drawTopologyScatter(_graphData, _findingsData); break;
      case 'relationships': drawBipartiteGraph(_findingsData.relationships || []); break;
      case 'suspicious':    drawSuspiciousChart(_findingsData.suspicious || []); break;
      case 'anomalies':     drawAnomalyScatter(_findingsData.anomalies || []); break;
      case 'clusters':      drawClusterChart(_findingsData.themes || []); break;
      case 'drift':         drawDriftChart(_findingsData.drift || []); break;
      default:              drawTopologyScatter(_graphData, _findingsData);
    }
    updateGraphCaption(lensName);
  } catch (e) {
    _graphError('Graph unavailable — ' + e.message);
  }
}

// Keep backward compat for app.js init call
async function renderGraph() {
  return renderGraphForLens(typeof _currentLens !== 'undefined' ? _currentLens : 'topology');
}

function updateGraphCaption(lens) {
  const el = document.getElementById('graph-caption');
  if (!el) return;
  const map = {
    topology:      'Each dot = one mapper node &nbsp;•&nbsp; X = time (jittered) &nbsp;•&nbsp; Click to inspect',
    relationships: 'Left = Countries &nbsp;•&nbsp; Right = DAC Sectors &nbsp;•&nbsp; Line width = co-occurrence weight',
    suspicious:    'Each dot = one suspicious project &nbsp;•&nbsp; X = overrun%, Y = anomaly score',
    anomalies:     'Each dot = one anomalous project &nbsp;•&nbsp; X = overrun%, Y = ISO Forest score',
    clusters:      'Each bar = one TDA cluster &nbsp;•&nbsp; Colored by dominant sector',
    drift:         'Lines show feature drift over time &nbsp;•&nbsp; Normalised to comparable scale',
  };
  el.innerHTML = map[lens] || map.topology;
}


// ── 1. TOPOLOGY SCATTER (Mapper) ──────────────────────────────────────────────

function drawTopologyScatter(graphData, findingsData) {
  const svgEl = _getSvg(); if (!svgEl) return;
  const { W, H, margin, innerW, innerH } = _dims(svgEl);

  // Score map from anomaly findings
  const scoreMap = {};
  (findingsData.anomalies || []).forEach(a =>
    (a.sources || []).forEach(s => { scoreMap[s] = a.score || 0; })
  );

  const mapperNodes = (graphData.mapper_nodes || []);
  const mapperEdges = (graphData.mapper_edges || []);
  const YEAR_MIN = 2005, YEAR_MAX = 2024;
  const totalIntervals = Math.max(...mapperNodes.map(n => n.interval || 0)) + 1 || 1;

  const enriched = mapperNodes.map((nd, i) => {
    const srcs     = nd.sources || [];
    const scores   = srcs.map(s => scoreMap[s] || 0.04);
    const avgScore = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0.04;
    const maxScore = scores.length ? Math.max(...scores) : 0.04;
    const fracAnom = scores.filter(s => s > 0.5).length / (scores.length || 1);
    const intFrac  = (nd.interval || i) / Math.max(totalIntervals - 1, 1);
    const yearX    = YEAR_MIN + intFrac * (YEAR_MAX - YEAR_MIN) + Math.sin(i * 7.3) * 0.5;
    const topoY    = Math.min(fracAnom * 0.5 + avgScore * 0.5, 1.0);
    const state    = maxScore > 0.6 || fracAnom > 0.4 ? 'anomalous'
                   : avgScore > 0.2 || fracAnom > 0.1  ? 'warning' : 'normal';
    return { ...nd, yearX, topoY, avgScore, maxScore, fracAnom, state,
             label: srcs[0] ? srcs[0].replace('AID-','#') : `N${i}` };
  });

  const stateColor  = { normal:'#4EA8DE', warning:'#E0A33E', anomalous:'#E05252' };
  const stateStroke = { normal:'#2a7db5', warning:'#b5651d', anomalous:'#8B1A1A' };

  const xDomain = [YEAR_MIN - 1, YEAR_MAX + 1];
  const yMax    = d3.max(enriched, d => d.topoY) || 0.5;
  const yDomain = [0, Math.max(yMax * 1.25, 0.1)];
  const xScale  = d3.scaleLinear().domain(xDomain).range([0, innerW]);
  const yScale  = d3.scaleLinear().domain(yDomain).range([innerH, 0]);
  const maxSize = Math.max(1, ...enriched.map(n => n.size || 1));
  const rScale  = d3.scaleSqrt().domain([1, maxSize]).range([4, 12]);

  const svg = d3.select(svgEl); svg.selectAll('*').remove();
  const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Title
  svg.append('text').attr('x', margin.left).attr('y', 16)
    .attr('fill','#D9DCE3').attr('font-size',11).attr('font-weight',600)
    .attr('font-family',"'Space Grotesk',sans-serif").text('Topology Graph (Mapper)');

  // Grid
  root.append('g').selectAll('line').data(yScale.ticks(5)).enter().append('line')
    .attr('x1',0).attr('x2',innerW).attr('y1',d=>yScale(d)).attr('y2',d=>yScale(d))
    .attr('stroke','rgba(42,47,58,.6)').attr('stroke-dasharray','3,3');

  // Edges
  const edgeG = root.append('g');
  mapperEdges.forEach(e => {
    const s = enriched[e.source], t = enriched[e.target];
    if (!s||!t) return;
    edgeG.append('line')
      .attr('x1',xScale(s.yearX)).attr('y1',yScale(s.topoY))
      .attr('x2',xScale(t.yearX)).attr('y2',yScale(t.topoY))
      .attr('stroke','rgba(169,180,196,.2)').attr('stroke-width',1);
  });

  // Tooltip
  const tip = _tooltip();
  const nodeG = root.append('g');
  enriched.forEach((nd, i) => {
    const cx  = xScale(nd.yearX), cy = yScale(nd.topoY);
    const r   = rScale(nd.size || 1);
    const col = stateColor[nd.state], str = stateStroke[nd.state];
    const g   = nodeG.append('g').attr('transform',`translate(${cx},${cy})`).style('cursor','pointer');
    if (nd.state === 'anomalous') {
      g.append('circle').attr('r',r+3).attr('fill','none')
        .attr('stroke','rgba(224,82,82,.3)').attr('stroke-width',1.5).attr('stroke-dasharray','3,2');
    }
    g.append('circle').attr('r',r).attr('fill',col).attr('fill-opacity',.85)
      .attr('stroke',str).attr('stroke-width',1.2);
    if (nd.state==='anomalous' && nd.avgScore===Math.max(...enriched.map(n=>n.avgScore))) {
      g.append('text').attr('dy',-r-5).attr('text-anchor','middle').attr('fill',col)
        .attr('font-size',9).attr('font-family',"'IBM Plex Mono',monospace").attr('font-weight',600)
        .text(nd.label);
    }
    g.on('mouseover',(ev)=>{
      g.select('circle:last-of-type').attr('r',r+2).attr('stroke-width',2);
      tip.style('display','block').style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-28)+'px')
        .html(`<b>${nd.label}</b><br>state: <span style="color:${col}">${nd.state}</span><br>score: ${nd.avgScore.toFixed(3)}<br>records: ${nd.size||0}<br>year ≈ ${Math.round(nd.yearX)}`);
    }).on('mousemove',(ev)=>tip.style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-28)+'px'))
      .on('mouseout',()=>{ g.select('circle:last-of-type').attr('r',r).attr('stroke-width',1.2); tip.style('display','none'); })
      .on('click',()=>showMapperNodeInfo(nd, stateColor));
  });

  _axes(root, xScale, yScale, innerH, innerW, 'time (approval year — jittered)', 'topology score');
  _legend(svg, W, H, [
    {label:'Normal States',   color:stateColor.normal},
    {label:'Warning States',  color:stateColor.warning},
    {label:'Anomalous States',color:stateColor.anomalous},
  ]);
}


// ── arc-flow CSS (injected once) ──────────────────────────────────────────────
(function injectArcCSS(){
  if (document.getElementById('arc-flow-css')) return;
  const s = document.createElement('style');
  s.id = 'arc-flow-css';
  s.textContent = `
    .arc-path{fill:none;stroke-linecap:round}
    @media(prefers-reduced-motion:no-preference){
      .arc-path.arc-flow{
        animation:arcpulse var(--pdur,2.2s) ease-in-out infinite var(--delay,0s);
      }
    }
    @keyframes arcpulse{
      0%  {stroke-opacity:var(--op,.4); filter:brightness(1)}
      30% {stroke-opacity:1;            filter:brightness(3.5)}
      55% {stroke-opacity:.85;          filter:brightness(1.6)}
      100%{stroke-opacity:var(--op,.4); filter:brightness(1)}
    }
    .arc-node-label{font-family:'Space Grotesk',sans-serif;dominant-baseline:middle}
    .gnode:hover .arc-node-dot{r:6;filter:brightness(1.8)}
    .gnode:hover .arc-node-label{font-weight:700;fill:var(--text)}
  `;
  document.head.appendChild(s);
})();

// ── 2. BIPARTITE RELATIONSHIP GRAPH ──────────────────────────────────────────

function drawBipartiteGraph(relationships) {
  const svgEl = _getSvg(); if (!svgEl) return;
  const { W, H } = _dims(svgEl);
  const cW = W;
  const top25    = relationships.slice(0, 25);
  const leftSet  = [...new Set(top25.map(r => r.extra?.a || ''))].filter(Boolean);
  const rightSet = [...new Set(top25.map(r => r.extra?.b || ''))].filter(Boolean);
  const maxW     = Math.max(1, ...top25.map(r => r.extra?.weight || 1));

  const nRows  = Math.max(leftSet.length, rightSet.length, 1);
  const PAD    = 28;
  const rowPx  = Math.max(22, Math.min(32, Math.floor((600 - PAD*2) / nRows)));
  const SVG_H  = nRows * rowPx + PAD * 2;
  const SVG_W  = Math.max(cW, 480);
  const lx = 155, rx = SVG_W - 140, cx = SVG_W / 2;

  const leftPos  = {}, rightPos = {};
  leftSet.forEach((n, i)  => { leftPos[n]  = { x: lx, y: PAD + rowPx * (i + 0.5) }; });
  rightSet.forEach((n, i) => { rightPos[n] = { x: rx, y: PAD + rowPx * (i + 0.5) }; });

  // Anomaly/suspicious color coding
  const anomIds = new Set((_findingsData?.anomalies || []).flatMap(a => a.sources || []));
  const suspIds = new Set((_findingsData?.suspicious || []).flatMap(s => s.sources || []));
  const edgeColor = (rel) => {
    const srcs = rel.sources || [];
    if (srcs.some(s => suspIds.has(s))) return 'var(--danger)';
    if (srcs.some(s => anomIds.has(s))) return 'var(--signal)';
    return 'var(--relate)';
  };
  const nodeColor = (name) => {
    const relForNode = top25.filter(r => r.extra?.a === name || r.extra?.b === name);
    const srcs = relForNode.flatMap(r => r.sources || []);
    if (srcs.some(s => suspIds.has(s))) return 'var(--danger)';
    if (srcs.some(s => anomIds.has(s))) return 'var(--signal)';
    return 'var(--relate)';
  };

  let svgStr = `<svg class="arcwrap-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" style="width:100%;display:block">`;

  // Draw arcs
  top25.forEach((rel, i) => {
    const a = rel.extra?.a, b = rel.extra?.b;
    if (!a || !b) return;
    const lp = leftPos[a], rp = rightPos[b];
    if (!lp || !rp) return;
    const w   = (0.5 + 1.8 * ((rel.extra?.weight || 1) / maxW)).toFixed(2);
    const col = edgeColor(rel);
    const op  = 0.4;
    const pdur = (1.6 + 1.8 * ((i % 7) / 7)).toFixed(2);
    const del  = (-(i % 13) * 0.22).toFixed(2);
    const d    = `M ${lp.x} ${lp.y} C ${cx} ${lp.y}, ${cx} ${rp.y}, ${rx} ${rp.y}`;

    // Invisible wide hit area
    svgStr += `<path d="${d}" fill="none" stroke="transparent" stroke-width="14"
      style="cursor:pointer" data-ea="${esc(a)}" data-eb="${esc(b)}"
      class="arc-hit" data-idx="${i}"/>`;
    // Animated visible arc
    svgStr += `<path class="arc-path arc-flow" d="${d}"
      stroke="${col}" stroke-width="${w}"
      style="--pdur:${pdur}s;--delay:${del}s;--op:${op};cursor:pointer"
      data-ea="${esc(a)}" data-eb="${esc(b)}" data-idx="${i}"/>`;
  });

  // Left nodes (countries)
  leftSet.forEach(name => {
    const p = leftPos[name]; if (!p) return;
    const col = nodeColor(name);
    const lbl = name.length > 18 ? name.slice(0, 17) + '…' : name;
    svgStr += `<g class="gnode" data-actor="${esc(name)}" style="cursor:pointer">
      <circle class="arc-node-dot" cx="${p.x}" cy="${p.y}" r="4"
        fill="${col}" fill-opacity="0.9" stroke="${col}" stroke-width="0.5"/>
      <text class="arc-node-label" x="${p.x - 10}" y="${p.y}"
        text-anchor="end" font-size="10.5" fill="var(--text)">${esc(lbl)}</text>
    </g>`;
  });

  // Right nodes (sectors)
  rightSet.forEach(name => {
    const p = rightPos[name]; if (!p) return;
    const col = nodeColor(name);
    const lbl = name.length > 18 ? name.slice(0, 17) + '…' : name;
    svgStr += `<g class="gnode" data-actor="${esc(name)}" style="cursor:pointer">
      <circle class="arc-node-dot" cx="${p.x}" cy="${p.y}" r="4"
        fill="${col}" fill-opacity="0.9" stroke="${col}" stroke-width="0.5"/>
      <text class="arc-node-label" x="${p.x + 10}" y="${p.y}"
        text-anchor="start" font-size="10.5" fill="var(--text)">${esc(lbl)}</text>
    </g>`;
  });

  // Column labels
  svgStr += `<text x="${lx - 10}" y="${SVG_H - 8}" text-anchor="end"
    font-size="9" fill="var(--faint)" font-family="IBM Plex Mono,monospace">COUNTRIES</text>`;
  svgStr += `<text x="${rx + 10}" y="${SVG_H - 8}" text-anchor="start"
    font-size="9" fill="var(--faint)" font-family="IBM Plex Mono,monospace">DAC SECTORS</text>`;

  svgStr += `</svg>`;

  const legend = `<div style="font-size:11px;color:var(--mute);padding:4px 0 0;font-family:'IBM Plex Mono',monospace">
    ${top25.length} connections · arc width = co-occurrence weight ·
    <span style="color:var(--danger)">●</span> suspicious &nbsp;
    <span style="color:var(--signal)">●</span> anomaly &nbsp;
    <span style="color:var(--relate)">●</span> clean
  </div>`;

  // Render directly into #graph-svg by replacing its inner SVG content
  // The outer #graph-svg element stays in the DOM so flex layout is preserved.
  // We inject the bipartite SVG as a nested <svg> inside it.
  const outer = d3.select(svgEl);
  outer.selectAll('*').remove();
  outer.attr('width', SVG_W).attr('height', SVG_H + 24);

  // Inject the arc SVG string as innerHTML of a foreignObject
  // — but simpler: just parse and append the SVG nodes via D3
  const parser = new DOMParser();
  const doc    = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svgStr}</svg>`, 'image/svg+xml');
  const inner  = doc.documentElement;
  Array.from(inner.childNodes).forEach(node => {
    svgEl.appendChild(node.cloneNode(true));
  });

  // Append legend as foreignObject
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  fo.setAttribute('x', 0); fo.setAttribute('y', SVG_H);
  fo.setAttribute('width', SVG_W); fo.setAttribute('height', 24);
  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px;color:#878E9C;font-family:'IBM Plex Mono',monospace;padding:2px 4px">
    ${top25.length} connections · arc width = co-occurrence ·
    <span style="color:#E05252">●</span> suspicious &nbsp;
    <span style="color:#E0A33E">●</span> anomaly &nbsp;
    <span style="color:#5E9CA6">●</span> clean</div>`;
  svgEl.appendChild(fo);

  const wrap = svgEl;
  if (!wrap) return;
  const tip = _tooltip();

  // Edge click / hover
  wrap.querySelectorAll('.arc-hit, .arc-path').forEach(el => {
    el.addEventListener('mouseover', (ev) => {
      const a = el.getAttribute('data-ea'), b = el.getAttribute('data-eb');
      const rel = top25.find(r => r.extra?.a === a && r.extra?.b === b);
      if (rel) {
        tip.style('display','block')
          .style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-24)+'px')
          .html(`<b>${esc(a)}</b> ↔ <b>${esc(b)}</b><br>co-occurrences: <b>${rel.extra?.weight}</b>`);
      }
    });
    el.addEventListener('mousemove', (ev) => {
      tip.style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-24)+'px');
    });
    el.addEventListener('mouseout', () => tip.style('display','none'));
    el.addEventListener('click', () => {
      const a = el.getAttribute('data-ea'), b = el.getAttribute('data-eb');
      const rel = top25.find(r => r.extra?.a === a && r.extra?.b === b);
      if (rel) showRelationshipAudit(a, b, rel);
    });
  });

  // Node click
  wrap.querySelectorAll('.gnode').forEach(el => {
    const name = el.getAttribute('data-actor');
    el.addEventListener('click', () => {
      const isLeft = !!leftPos[name];
      const edgeData = top25.map(r => ({ rel:r, a:r.extra?.a, b:r.extra?.b, w:1 }));
      showNodeAudit(name, isLeft ? 'country' : 'sector', edgeData);
    });
  });
}


// ── Node click → Audit Trail ──────────────────────────────────────────────────

function showRelationshipAudit(a, b, rel) {
  const body = document.getElementById('audit-content'); if (!body) return;
  const w    = rel.extra?.weight || 0;
  const srcs = (rel.sources || []).slice(0, 5);
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--relate);margin-bottom:10px">${esc(a)} ↔ ${esc(b)}</div>
    <div class="audit-step"><span class="step-icon">🌍</span>
      <div class="step-body"><div class="label">Country</div><div class="val">${esc(a)}</div></div></div>
    <div class="audit-step"><span class="step-icon">📋</span>
      <div class="step-body"><div class="label">DAC Sector</div><div class="val">${esc(b)}</div></div></div>
    <div class="audit-step"><span class="step-icon">📊</span>
      <div class="step-body"><div class="label">Co-occurrences</div><div class="val">${w} overrun projects</div></div></div>
    <div class="audit-step"><span class="step-icon">🔗</span>
      <div class="step-body"><div class="label">Type</div><div class="val">co-occurrence in overrun projects</div></div></div>
    <div class="audit-step"><span class="step-icon">🗂</span>
      <div class="step-body"><div class="label">Sample Project IDs</div>
      <div class="val">${srcs.map(s=>esc(s)).join(', ') || '—'}</div></div></div>
    <div class="audit-verified">✓ TRACEABLE — ${w} source records</div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}

function showNodeAudit(name, type, paths, rels) {
  const body = document.getElementById('audit-content'); if (!body) return;
  const connected = rels.filter(r =>
    type === 'country' ? r.extra?.a === name : r.extra?.b === name
  );
  const total = connected.reduce((s, r) => s + (r.extra?.weight||0), 0);
  const partners = type === 'country'
    ? [...new Set(connected.map(r => r.extra?.b))].filter(Boolean)
    : [...new Set(connected.map(r => r.extra?.a))].filter(Boolean);

  const col = type === 'country' ? '#4EA8DE' : '#9B7FD4';
  const icon = type === 'country' ? '🌍' : '📋';
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:${col};margin-bottom:10px">${icon} ${esc(name)}</div>
    <div class="audit-step"><span class="step-icon">📊</span>
      <div class="step-body"><div class="label">Type</div>
      <div class="val">${type === 'country' ? 'Recipient Country' : 'DAC Sector'}</div></div></div>
    <div class="audit-step"><span class="step-icon">🔗</span>
      <div class="step-body"><div class="label">Relationships</div>
      <div class="val">${connected.length} co-occurrence links</div></div></div>
    <div class="audit-step"><span class="step-icon">📈</span>
      <div class="step-body"><div class="label">Total overrun projects</div>
      <div class="val">${total}</div></div></div>
    <div class="audit-step"><span class="step-icon">🤝</span>
      <div class="step-body"><div class="label">Connected ${type==='country'?'sectors':'countries'}</div>
      <div class="val">${partners.slice(0,5).map(p=>esc(p)).join(', ')}</div></div></div>
    <div class="audit-step"><span class="step-icon">🗂</span>
      <div class="step-body"><div class="label">Top relationships</div>
      <div class="val">${connected.slice(0,3).map(r=>
        `${esc(type==='country'?r.extra?.b:r.extra?.a)} (${r.extra?.weight})`
      ).join(', ')}</div></div></div>
    <div class="audit-verified">✓ TRACEABLE — ${total} source records</div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}


// ── 3 & 4. SUSPICIOUS + ANOMALY — same bubble scatter, different color ────────
//  suspicious → red (#E05252)   anomaly → amber (#E0A33E)

function drawSuspiciousChart(suspicious) {
  _drawBubbleScatter(suspicious, '#E05252', 'rgba(224,82,82,.18)',
    'Suspicious Projects — Anomaly Score', 'suspicious records (ranked)');
}

function drawAnomalyScatter(anomalies) {
  _drawBubbleScatter(anomalies, '#E0A33E', 'rgba(224,163,62,.15)',
    'Anomalous Projects — Anomaly Score', 'anomalous records (ranked)');
}

function _drawBubbleScatter(items, dotColor, glowColor, title, xLabel) {
  const svgEl = _getSvg(); if (!svgEl) return;
  const { W, H, margin, innerW, innerH } = _dims(svgEl);
  const svg = d3.select(svgEl); svg.selectAll('*').remove();

  svg.append('text').attr('x', margin.left).attr('y', 16)
    .attr('fill','#D9DCE3').attr('font-size',11).attr('font-weight',600)
    .attr('font-family',"'Space Grotesk',sans-serif").text(title);

  if (!items.length) { _graphError('No data'); return; }

  const root = svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);

  // X = cost overrun % (gives real spread); fallback to rank index
  const overruns = items.map(d => {
    const v = d.extra?.cost_overrun_pct;
    return (v != null && !isNaN(v)) ? Math.min(v * 100, 2000) : null;
  });
  const hasOverrun = overruns.filter(v => v != null).length > 3;

  // Y axis: zoom in on actual score range for visible differentiation
  const scores  = items.map(d => d.score || 0);
  const yMin    = Math.max(0, Math.min(...scores) - 0.05);
  const yMax    = Math.min(1.02, Math.max(...scores) + 0.02);

  const xScale  = hasOverrun
    ? d3.scaleLinear().domain([0, Math.max(...overruns.map(v=>v||0)) * 1.1 || 100]).range([0, innerW])
    : d3.scalePoint().domain(items.map((_,i)=>`#${i+1}`)).range([0,innerW]).padding(0.4);
  const yScale  = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

  // Grid lines
  root.append('g').selectAll('line').data(yScale.ticks(6)).enter().append('line')
    .attr('x1',0).attr('x2',innerW).attr('y1',d=>yScale(d)).attr('y2',d=>yScale(d))
    .attr('stroke','rgba(42,47,58,.7)').attr('stroke-dasharray','3,3');

  const tip = _tooltip();

  items.forEach((d, i) => {
    const cx  = hasOverrun ? xScale(overruns[i] || 0) + (Math.sin(i*3.7)*innerW*0.015)
                           : xScale(`#${i+1}`);
    const cy  = yScale(d.score || 0);
    const r   = 5 + (d.score||0) * 7;
    const ex  = d.extra || {};

    // Glow
    root.append('circle').attr('cx',cx).attr('cy',cy).attr('r',r+5)
      .attr('fill',glowColor).attr('stroke','none');
    // Dot
    root.append('circle').attr('cx',cx).attr('cy',cy).attr('r',r)
      .attr('fill',dotColor).attr('fill-opacity',.85)
      .attr('stroke','rgba(255,255,255,.2)').attr('stroke-width',1)
      .style('cursor','pointer')
      .on('mouseover',(ev)=>{
        const ovr = ex.cost_overrun_pct != null ? `overrun ${(ex.cost_overrun_pct*100).toFixed(1)}%` : '';
        const iso = ex.iso_score != null ? `iso ${(ex.iso_score).toFixed(3)}` : '';
        tip.style('display','block').style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-24)+'px')
          .html(`<b>${esc((d.title||'').slice(0,45))}</b><br>score: <b>${(d.score||0).toFixed(4)}</b><br>${[ovr,iso].filter(Boolean).join(' · ')}`);
      })
      .on('mousemove',(ev)=>tip.style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-24)+'px'))
      .on('mouseout',()=>tip.style('display','none'))
      .on('click',()=>{ const pid=(d.sources||[])[0]; if(pid) loadAudit(pid); });
  });

  const xLabelText = hasOverrun ? 'cost overrun %' : xLabel;
  _axes(root, xScale, yScale, innerH, innerW, xLabelText, 'anomaly score');
}


// ── 5. CLUSTER CHART ──────────────────────────────────────────────────────────

function drawClusterChart(themes) {
  const svgEl = _getSvg(); if (!svgEl) return;
  const { W, H, margin, innerW, innerH } = _dims(svgEl);
  const svg = d3.select(svgEl); svg.selectAll('*').remove();

  svg.append('text').attr('x',margin.left).attr('y',16)
    .attr('fill','#D9DCE3').attr('font-size',11).attr('font-weight',600)
    .attr('font-family',"'Space Grotesk',sans-serif").text('TDA Cluster Sizes');

  if (!themes.length) { _graphError('No clusters'); return; }

  const root = svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
  const labels  = themes.map(t => `C${t.extra?.cluster_id||0}`);
  const counts  = themes.map(t => t.extra?.n_records||0);
  const xScale  = d3.scaleBand().domain(labels).range([0,innerW]).padding(0.25);
  const yScale  = d3.scaleLinear().domain([0, d3.max(counts)*1.12||1]).range([innerH,0]);
  const COLS    = ['#4EA8DE','#9B7FD4','#E0A33E','#6FAE8F','#E05252','#5E9CA6','#B5651D','#A9B4C4','#4EA8DE'];

  root.append('g').selectAll('line').data(yScale.ticks(5)).enter().append('line')
    .attr('x1',0).attr('x2',innerW).attr('y1',d=>yScale(d)).attr('y2',d=>yScale(d))
    .attr('stroke','rgba(42,47,58,.6)').attr('stroke-dasharray','3,3');

  const tip = _tooltip();
  themes.forEach((t,i)=>{
    const x = xScale(labels[i]), w = xScale.bandwidth(), h = innerH-yScale(counts[i]);
    root.append('rect').attr('x',x).attr('y',yScale(counts[i])).attr('width',w).attr('height',h)
      .attr('fill',COLS[i%COLS.length]).attr('fill-opacity',.8).attr('rx',2).style('cursor','pointer')
      .on('mouseover',(ev)=>{
        tip.style('display','block').style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-24)+'px')
          .html(`<b>${labels[i]}</b><br>${t.title?.replace(/^Cluster \d+: /,'') || ''}<br>${counts[i]} projects`);
      }).on('mousemove',(ev)=>tip.style('left',(ev.clientX+12)+'px').style('top',(ev.clientY-24)+'px'))
        .on('mouseout',()=>tip.style('display','none'));
    root.append('text').attr('x',x+w/2).attr('y',yScale(counts[i])-4).attr('text-anchor','middle')
      .attr('fill','#878E9C').attr('font-size',9).text(counts[i]);
  });

  _axes(root, xScale, yScale, innerH, innerW, 'cluster', 'projects');
}


// ── 6. DRIFT CHART ────────────────────────────────────────────────────────────

function drawDriftChart(drift) {
  const svgEl = _getSvg(); if (!svgEl) return;
  const { W, H, margin, innerW, innerH } = _dims(svgEl);
  const svg = d3.select(svgEl); svg.selectAll('*').remove();

  svg.append('text').attr('x',margin.left).attr('y',16)
    .attr('fill','#D9DCE3').attr('font-size',11).attr('font-weight',600)
    .attr('font-family',"'Space Grotesk',sans-serif").text('Feature Drift Over Time');

  if (!drift.length) { _graphError('No drift detected'); return; }

  const root = svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
  const COLS  = ['#4EA8DE','#E0A33E','#9B7FD4'];

  drift.forEach((d, i) => {
    const ex    = d.extra || {};
    const early = ex.early_mean || 0, late = ex.late_mean || 0;
    const mid   = ex.mid_year   || 2014;
    const xScale = d3.scaleLinear().domain([2005, 2024]).range([0, innerW]);
    const yRange = [Math.min(early, late) * 0.85, Math.max(early, late) * 1.15];
    const yScale = d3.scaleLinear().domain(yRange).range([innerH, 0]);
    const lineData = [[2005, early + (early - late)*0.4], [mid, early], [mid+1, late], [2024, late + (late-early)*0.4]];
    const line = d3.line().x(p=>xScale(p[0])).y(p=>yScale(p[1])).curve(d3.curveCatmullRom);
    root.append('path').datum(lineData).attr('fill','none')
      .attr('d', line).attr('stroke', COLS[i%3]).attr('stroke-width', 2);
    // drift label
    root.append('text').attr('x', innerW - 4).attr('y', yScale(late)).attr('text-anchor','end')
      .attr('fill', COLS[i%3]).attr('font-size',9).attr('font-family',"'IBM Plex Mono',monospace")
      .text(ex.feature?.replace(/_/g,' ').slice(0,18)||'');
  });

  // Simple time axis
  const xScale = d3.scaleLinear().domain([2005, 2024]).range([0, innerW]);
  root.append('g').attr('transform',`translate(0,${innerH})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(d=>Math.round(d)))
    .call(g=>{ g.select('.domain').attr('stroke','var(--line)'); g.selectAll('text').attr('fill','#878E9C').attr('font-size',9); g.selectAll('line').attr('stroke','var(--line)'); });
  root.append('text').attr('x',innerW/2).attr('y',innerH+36).attr('text-anchor','middle')
    .attr('fill','#59616E').attr('font-size',9.5).attr('font-family',"'Space Grotesk',sans-serif").text('year');
}


// ── Mapper node detail panel ──────────────────────────────────────────────────

function showMapperNodeInfo(nd, stateColor) {
  const body = document.getElementById('audit-content'); if (!body) return;
  const col = (stateColor||{})[nd.state]||'var(--relate)';
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px">Mapper Node — ${nd.label}</div>
    <div class="audit-step"><span class="step-icon">🔵</span><div class="step-body"><div class="label">State</div><div class="val" style="color:${col}">${nd.state.toUpperCase()}</div></div></div>
    <div class="audit-step"><span class="step-icon">📊</span><div class="step-body"><div class="label">Avg Score</div><div class="val">${nd.avgScore.toFixed(4)}</div></div></div>
    <div class="audit-step"><span class="step-icon">📁</span><div class="step-body"><div class="label">Records in Node</div><div class="val">${nd.size || (nd.sources||[]).length}</div></div></div>
    <div class="audit-step"><span class="step-icon">📅</span><div class="step-body"><div class="label">Year Proxy</div><div class="val">≈ ${Math.round(nd.yearX)}</div></div></div>
    <div class="audit-step"><span class="step-icon">🗂</span><div class="step-body"><div class="label">Sample Project IDs</div><div class="val">${(nd.sources||[]).slice(0,5).join(', ')||'—'}</div></div></div>
    <div class="audit-verified">✓ TRACEABLE — Mapper interval ${nd.interval||0}</div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}


// ── Shared helpers ────────────────────────────────────────────────────────────

function _getSvg() { return document.getElementById('graph-svg'); }

function _dims(svgEl, marginOverride) {
  // Prefer parent container width (reliable inside flex/grid after layout)
  const parent = svgEl.parentElement;
  const pW     = parent ? parent.clientWidth  || parent.offsetWidth  : 0;
  const pH     = parent ? parent.clientHeight || parent.offsetHeight : 0;
  const rect   = svgEl.getBoundingClientRect();

  const W = Math.max(pW || rect.width  || svgEl.clientWidth  || 500, 300);
  const H = Math.max(
    pH > 60 ? pH - 50 : 0,         // parent height minus caption
    rect.height || svgEl.clientHeight || 340,
    260
  );

  // Set explicit pixel dimensions so D3 coordinate space fills the element
  svgEl.setAttribute('width',  W);
  svgEl.setAttribute('height', H);
  svgEl.style.width  = W + 'px';
  svgEl.style.height = H + 'px';

  const margin = Object.assign({ top:32, right:20, bottom:50, left:52 }, marginOverride||{});
  return { W, H, margin, innerW: W-margin.left-margin.right, innerH: H-margin.top-margin.bottom };
}

function _axes(root, xScale, yScale, innerH, innerW, xLabel, yLabel) {
  const xAxisFn = typeof xScale.bandwidth === 'function' ? d3.axisBottom(xScale) : d3.axisBottom(xScale).ticks(5).tickFormat(d3.format('.2f'));
  root.append('g').attr('transform',`translate(0,${innerH})`).call(xAxisFn)
    .call(g=>{ g.select('.domain').attr('stroke','var(--line)'); g.selectAll('text').attr('fill','#878E9C').attr('font-size',9); g.selectAll('line').attr('stroke','var(--line)'); });
  root.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('.2f')))
    .call(g=>{ g.select('.domain').attr('stroke','var(--line)'); g.selectAll('text').attr('fill','#878E9C').attr('font-size',9); g.selectAll('line').attr('stroke','var(--line)'); });
  if (xLabel) root.append('text').attr('x',innerW/2).attr('y',innerH+38).attr('text-anchor','middle')
    .attr('fill','#59616E').attr('font-size',9.5).attr('font-family',"'Space Grotesk',sans-serif").text(xLabel);
  if (yLabel) root.append('text').attr('transform','rotate(-90)').attr('x',-innerH/2).attr('y',-38)
    .attr('text-anchor','middle').attr('fill','#59616E').attr('font-size',9.5)
    .attr('font-family',"'Space Grotesk',sans-serif").text(yLabel);
}

function _legend(svg, W, H, items) {
  const g = svg.append('g').attr('transform',`translate(50,${H-14})`);
  let lx = 0;
  items.forEach(({label, color}) => {
    g.append('circle').attr('cx',lx+5).attr('cy',0).attr('r',5).attr('fill',color).attr('fill-opacity',.85);
    g.append('text').attr('x',lx+13).attr('y',4).attr('fill','#878E9C').attr('font-size',9)
      .attr('font-family',"'Space Grotesk',sans-serif").text(label);
    lx += label.length * 5.5 + 18;
  });
}

function _tooltip() {
  return d3.select('body').select('#topo-tooltip').empty()
    ? d3.select('body').append('div').attr('id','topo-tooltip')
        .style('position','fixed').style('pointer-events','none').style('background','var(--panel2)')
        .style('border','1px solid var(--line)').style('padding','6px 10px').style('border-radius','4px')
        .style('font-size','11px').style('font-family',"'IBM Plex Mono',monospace")
        .style('color','var(--text)').style('display','none').style('z-index','9999')
    : d3.select('#topo-tooltip');
}

function _graphError(msg) {
  const svg = document.getElementById('graph-svg');
  if (svg) {
    d3.select(svg).selectAll('*').remove();
    d3.select(svg).append('text').attr('x','50%').attr('y','50%')
      .attr('fill','#878e9c').attr('font-size',13).attr('text-anchor','middle')
      .attr('dominant-baseline','middle').text(msg);
  }
}

function showNodeInfo(d) {
  const body = document.getElementById('audit-content'); if (!body) return;
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px">${esc(d.id)}</div>
    <div class="audit-step"><span class="step-icon">📁</span><div class="step-body"><div class="label">Projects</div><div class="val">${d.docs} records</div></div></div>
    <div class="audit-step"><span class="step-icon">⚠️</span><div class="step-body"><div class="label">Anomaly Exposure</div><div class="val">${(d.exposure||0).toFixed(3)}</div></div></div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}
