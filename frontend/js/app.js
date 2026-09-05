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
    _datasetStats = datasetRes;
    _cyclesData   = cyclesRes;

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

// ── Dataset summary panel ─────────────────────────────────────────────────────

let _datasetStats = {};
let _cyclesData   = {};

function openSummarizeTab() {
  if (typeof switchRTab === 'function') switchRTab('summarize');
  buildDatasetSummaryPanel();
}

function buildDatasetSummaryPanel() {
  const s   = _datasetStats;
  const m   = (_findings && _findings.meta) ? _findings.meta : {};
  const tda = m.tda || {};

  // ── Dataset stat tiles ────────────────────────────────────────────────────
  const statGrid = document.getElementById('sum-stat-grid');
  if (statGrid) {
    const clr = { tda:'var(--tda)', ok:'var(--ok)', warn:'var(--signal)', mute:'var(--mute)', '':'var(--text)' };
    const tiles = [
      { v: (s.total_records || 0).toLocaleString(), l: 'Records',       c: 'tda'  },
      { v: s.countries  ?? '–',                    l: 'Countries',      c: ''     },
      { v: s.sectors    ?? '–',                    l: 'DAC Sectors',    c: ''     },
      { v: s.year_range ?? '–',                    l: 'Year Range',     c: ''     },
      { v: `${(+(s.success_rate    || 0)).toFixed(1)}%`, l: 'Success Rate',  c: 'ok'   },
      { v: `${(+(s.avg_overrun_pct || 0)).toFixed(1)}%`, l: 'Avg Overrun',   c: 'warn' },
      { v: (+(s.avg_cpi   || 0)).toFixed(1),              l: 'Avg CPI Score', c: ''     },
      { v: `${Math.round(+(s.avg_eval_lag || 0))}d`,      l: 'Avg Eval Lag',  c: 'mute' },
    ];
    statGrid.innerHTML = tiles.map(t =>
      `<div style="background:var(--panel2);border:1px solid var(--line);border-radius:3px;padding:8px 10px">
         <div style="font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;color:${clr[t.c]}">${esc(String(t.v))}</div>
         <div style="font-size:9px;color:var(--faint);text-transform:uppercase;letter-spacing:.12em;margin-top:3px">${t.l}</div>
       </div>`
    ).join('');
  }

  // ── TDA shape metrics ─────────────────────────────────────────────────────
  const tdaEl = document.getElementById('sum-tda-metrics');
  if (tdaEl) {
    const b0 = tda.betti_0 ?? 1;
    const b1 = tda.betti_1 ?? 0;
    const mp = (+(tda.max_persistence ?? 0)).toFixed(4);
    tdaEl.innerHTML = [
      { v: b0, l: 'β₀ COMPONENTS' },
      { v: b1, l: 'β₁ LOOPS'      },
      { v: mp, l: 'MAX PERS'      },
    ].map(t =>
      `<div style="background:var(--panel2);border:1px solid var(--line);border-radius:3px;padding:8px;text-align:center">
         <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700;color:var(--tda)">${t.v}</div>
         <div style="font-size:9px;color:var(--faint);text-transform:uppercase;letter-spacing:.09em;margin-top:3px">${t.l}</div>
       </div>`
    ).join('');

    // Shape interpretation text
    const b1n = Number(b1);
    const mpn = parseFloat(mp);
    const nClusters = m.n_clusters || 0;
    let shape = '';
    if (b1n === 0) {
      shape = `<b style="color:var(--tda)">Tree-like (acyclic)</b> — the dataset forms ${b0} connected component${b0 !== 1 ? 's' : ''} with no persistent cycles. Aid projects cluster in hierarchically separated groups with no detectable circular funding structure.`;
    } else if (b1n <= 2) {
      shape = `<b style="color:var(--tda)">Weakly cyclic</b> — ${b1n} persistent H₁ loop${b1n > 1 ? 's' : ''} detected (max persistence ${mp}). This suggests ${b1n > 1 ? 'recurring' : 'a recurring'} structural pattern — possibly cyclical funding relationships or correlated project profiles repeated across countries.`;
    } else {
      shape = `<b style="color:var(--signal)">Strongly cyclic (${b1n} loops)</b> — the topology contains ${b1n} H₁ loops with max persistence ${mp}. Strong signal of systematic, repeated structural patterns: circular funding networks or correlated failure modes recurring across sectors.`;
    }
    if (mpn > 0.5) shape += ` The high persistence (${mp}) confirms these are <b style="color:var(--signal)">robust topological features</b>, not noise.`;
    else if (mpn > 0.2) shape += ` Persistence ${mp} indicates <b style="color:var(--text)">moderate confidence</b> — patterns are real but not dominant.`;
    else if (mpn > 0) shape += ` Low persistence (${mp}) — treat as <b style="color:var(--mute)">exploratory signals</b> requiring further verification.`;
    if (nClusters > 0) shape += ` DBSCAN found <b style="color:var(--tda)">${nClusters} cluster${nClusters > 1 ? 's' : ''}</b> — ${nClusters > 5 ? 'highly fragmented across many distinct project archetypes' : 'grouped into ' + nClusters + ' cohesive project profile' + (nClusters > 1 ? 's' : '')}.`;

    const interpEl = document.getElementById('sum-shape-interpretation');
    if (interpEl) interpEl.innerHTML = shape;

    // H₁ loops
    const h1  = tda.h1_features || [];
    const h1El = document.getElementById('sum-h1-loops');
    if (h1El) {
      h1El.innerHTML = h1.length
        ? h1.slice(0, 6).map((lp, i) =>
            `<div style="padding:3px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px">
               <span style="color:var(--mute)">Loop ${i + 1}</span>
               <span>pers <b style="color:var(--tda)">${(lp.persistence || 0).toFixed(4)}</b></span>
               <span style="color:var(--faint)">${(lp.birth || 0).toFixed(3)} → ${(lp.death || 0).toFixed(3)}</span>
             </div>`
          ).join('')
        : '<span style="color:var(--faint)">No H₁ loops detected</span>';
    }
  }

  // ── Finding distribution bars ─────────────────────────────────────────────
  const distEl = document.getElementById('sum-finding-dist');
  if (distEl) {
    const rows = [
      { k: 'anomalies',     lensKey: 'anomalies',     label: 'Anomalies',     color: 'var(--signal)', mkey: 'n_anomalies'    },
      { k: 'suspicious',    lensKey: 'suspicious',    label: 'Suspicious',    color: 'var(--danger)', mkey: 'n_suspicious'   },
      { k: 'themes',        lensKey: 'clusters',      label: 'Clusters',      color: 'var(--tda)',    mkey: 'n_clusters'     },
      { k: 'relationships', lensKey: 'relationships', label: 'Relationships', color: 'var(--relate)', mkey: 'n_relationships' },
      { k: 'drift',         lensKey: 'drift',         label: 'Drift',         color: 'var(--drift)',  mkey: 'n_drift'        },
      { k: 'topology',      lensKey: 'topology',      label: 'Topology',      color: 'var(--tda)',    mkey: null             },
    ];
    const counts = rows.map(r => r.mkey ? (m[r.mkey] || 0) : (_findings[r.k] || []).length);
    const maxCount = Math.max(1, ...counts);
    distEl.innerHTML = rows.map((r, i) => {
      const count = counts[i];
      const pct   = Math.round((count / maxCount) * 100);
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;cursor:pointer"
             onclick="setLens('${r.lensKey}');if(typeof switchRTab==='function')switchRTab('graph')">
          <div style="width:76px;font-size:10.5px;color:${r.color};font-family:'IBM Plex Mono',monospace;text-align:right;flex:none">${r.label}</div>
          <div style="flex:1;height:5px;background:var(--panel2);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${r.color};opacity:.75;border-radius:3px;transition:width .3s"></div>
          </div>
          <div style="font-size:10.5px;font-family:'IBM Plex Mono',monospace;color:var(--faint);width:28px;text-align:right">${count}</div>
        </div>`;
    }).join('');
  }

  // ── Top signals ───────────────────────────────────────────────────────────
  const sigEl = document.getElementById('sum-top-signals');
  if (sigEl) {
    const all = [
      ...(_findings.anomalies     || []).slice(0, 2).map(f => ({ ...f, _lens: 'anomaly',  _clr: 'var(--signal)' })),
      ...(_findings.suspicious    || []).slice(0, 2).map(f => ({ ...f, _lens: 'suspicious', _clr: 'var(--danger)' })),
      ...(_findings.topology      || []).slice(0, 1).map(f => ({ ...f, _lens: 'topology',   _clr: 'var(--tda)'    })),
      ...(_findings.drift         || []).slice(0, 1).map(f => ({ ...f, _lens: 'drift',      _clr: 'var(--drift)'  })),
    ].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);

    sigEl.innerHTML = all.length
      ? all.map(f =>
          `<div style="margin-bottom:8px;padding:8px 10px;background:var(--panel2);border:1px solid var(--line);border-left:2px solid ${f._clr};border-radius:3px">
             <div style="font-size:11px;color:${f._clr};font-family:'IBM Plex Mono',monospace;text-transform:uppercase;margin-bottom:2px">${f._lens} · score ${(f.score || 0).toFixed(3)}</div>
             <div style="font-size:12.5px;color:var(--text);font-weight:500">${esc(f.title || '')}</div>
             <div style="font-size:11.5px;color:var(--mute);margin-top:3px">${esc((f.detail || '').slice(0, 110))}${(f.detail || '').length > 110 ? '…' : ''}</div>
           </div>`
        ).join('')
      : '<span style="color:var(--faint)">Load findings to see top signals.</span>';
  }
}

async function summarizeDataset() {
  const el = document.getElementById('summarize-content');
  if (el) el.textContent = 'Generating dataset overview…';
  try {
    const data = await fetch(`${API}/api/summarize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ kind: 'overview' }),
    }).then(r => r.json());
    if (el) el.innerHTML = `<div class="sum-text">${mdLite(data.summary || '')}</div>`;
  } catch (e) {
    if (el) el.textContent = 'Summary unavailable.';
  }
}

// ── Temporal Homology chart (D3 dual line) ────────────────────────────────────

async function buildTemporalChart() {
  const svg = document.getElementById('fsv-temporal-chart');
  if (!svg || typeof d3 === 'undefined') return;

  // Wait for layout so getBoundingClientRect gives real width
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 60));

  let data;
  try {
    data = await fetch(`${API}/api/tda/temporal`).then(r => r.json());
  } catch(e) {
    d3.select(svg).attr('height', 60).append('text').attr('x','50%').attr('y','50%')
      .attr('fill','#59616E').attr('font-size',11).attr('text-anchor','middle')
      .attr('dominant-baseline','middle').attr('font-family','IBM Plex Mono,monospace')
      .text('API unavailable');
    return;
  }

  // Still computing in background — show spinner and retry
  if (data.computing || (data.years || []).length < 2) {
    const W2 = svg.getBoundingClientRect().width || 500;
    d3.select(svg).selectAll('*').remove();
    d3.select(svg).attr('height', 80)
      .attr('width', W2);
    d3.select(svg).append('text').attr('x', W2/2).attr('y', 32)
      .attr('fill','var(--tda)').attr('font-size',11).attr('text-anchor','middle')
      .attr('font-family','IBM Plex Mono,monospace')
      .text('Computing per-year topological change…');
    d3.select(svg).append('text').attr('x', W2/2).attr('y', 52)
      .attr('fill','#59616E').attr('font-size',10).attr('text-anchor','middle')
      .attr('font-family','IBM Plex Mono,monospace')
      .text('This runs ripser on each year — ready in ~20 s');
    // Retry every 5 seconds until data arrives
    setTimeout(buildTemporalChart, 5000);
    return;
  }

  const rows      = data.years || [];
  const driftYear = data.drift_year;

  const W = svg.getBoundingClientRect().width || 580;
  const H = 220;
  const M = { top: 14, right: 52, bottom: 40, left: 46 };
  const iW = W - M.left - M.right;
  const iH = H - M.top  - M.bottom;

  svg.setAttribute('width',  W);
  svg.setAttribute('height', H);
  d3.select(svg).selectAll('*').remove();
  const root = d3.select(svg).append('g').attr('transform', `translate(${M.left},${M.top})`);

  const xSc = d3.scaleLinear()
    .domain(d3.extent(rows, d => d.year))
    .range([0, iW]);

  const yWass = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.wasserstein_norm) * 1.15 || 1])
    .range([iH, 0]);

  const yOvr = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.avg_overrun_pct) * 1.15 || 1])
    .range([iH, 0]);

  // Grid
  root.append('g')
    .call(d3.axisLeft(yWass).ticks(4).tickSize(-iW).tickFormat(''))
    .selectAll('line').attr('stroke','#2A2F3A').attr('stroke-dasharray','3,3');
  root.select('.domain').remove();

  // Axes
  root.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(xSc).ticks(rows.length).tickFormat(d3.format('d')))
    .selectAll('text').attr('fill','#59616E').attr('font-size', 9)
    .attr('font-family','IBM Plex Mono,monospace')
    .attr('transform','rotate(-40)').attr('text-anchor','end');
  root.selectAll('.domain,.tick line').attr('stroke','#2A2F3A');

  root.append('g')
    .call(d3.axisLeft(yWass).ticks(4).tickFormat(d3.format('.2f')))
    .selectAll('text,path,line').attr('stroke','#4EA8DE').attr('fill','#4EA8DE').attr('font-size',9);

  root.append('g').attr('transform', `translate(${iW},0)`)
    .call(d3.axisRight(yOvr).ticks(4).tickFormat(d => `${(d*100).toFixed(0)}%`))
    .selectAll('text,path,line').attr('stroke','var(--signal)').attr('fill','var(--signal)').attr('font-size',9);

  // Drift year vertical marker
  if (driftYear) {
    root.append('line')
      .attr('x1', xSc(driftYear)).attr('x2', xSc(driftYear))
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke','var(--danger)').attr('stroke-dasharray','5,4').attr('stroke-width',1.5).attr('opacity',.7);
    root.append('text')
      .attr('x', xSc(driftYear) + 4).attr('y', 10)
      .attr('fill','var(--danger)').attr('font-size', 9)
      .attr('font-family','IBM Plex Mono,monospace')
      .text(`drift ${driftYear}`);
  }

  // Area fill under Wasserstein
  root.append('path')
    .datum(rows)
    .attr('fill','rgba(78,168,222,0.08)')
    .attr('d', d3.area()
      .x(d => xSc(d.year))
      .y0(iH)
      .y1(d => yWass(d.wasserstein_norm))
      .curve(d3.curveCatmullRom.alpha(0.5))
    );

  // Wasserstein line
  root.append('path')
    .datum(rows)
    .attr('fill','none').attr('stroke','var(--drift)').attr('stroke-width', 2)
    .attr('d', d3.line()
      .x(d => xSc(d.year))
      .y(d => yWass(d.wasserstein_norm))
      .curve(d3.curveCatmullRom.alpha(0.5))
    );

  // Overrun line
  root.append('path')
    .datum(rows)
    .attr('fill','none').attr('stroke','var(--signal)').attr('stroke-width', 1.8).attr('opacity',.85)
    .attr('d', d3.line()
      .x(d => xSc(d.year))
      .y(d => yOvr(d.avg_overrun_pct))
      .curve(d3.curveCatmullRom.alpha(0.5))
    );

  // Tooltip dots — Wasserstein peaks
  const tip = d3.select('body').selectAll('#th-tip').data([0]).join('div')
    .attr('id','th-tip')
    .style('position','fixed').style('pointer-events','none').style('opacity',0)
    .style('background','#20242D').style('border','1px solid #2A2F3A')
    .style('color','#D9DCE3').style('font-size','11px').style('padding','7px 10px')
    .style('border-radius','3px').style('font-family','IBM Plex Mono,monospace')
    .style('z-index','999').style('line-height','1.6');

  root.selectAll('.dot-th').data(rows).join('circle')
    .attr('class','dot-th')
    .attr('cx', d => xSc(d.year)).attr('cy', d => yWass(d.wasserstein_norm))
    .attr('r', 3).attr('fill','var(--drift)').attr('opacity',.8)
    .on('mousemove', (ev, d) => {
      tip.html(
        `<b>${d.year}</b><br>` +
        `Wasserstein Δ: ${d.wasserstein_norm.toFixed(3)}<br>` +
        `Avg overrun: ${(d.avg_overrun_pct*100).toFixed(1)}%<br>` +
        `Success rate: ${(d.success_rate*100).toFixed(1)}%<br>` +
        `Projects: ${d.n_projects}`
      ).style('left',(ev.clientX+14)+'px').style('top',(ev.clientY-10)+'px')
       .transition().duration(80).style('opacity',1);
    })
    .on('mouseleave', () => tip.transition().duration(120).style('opacity',0));
}

// ── Persistence Diagram (D3 scatter plot) ─────────────────────────────────────

async function buildPersistenceDiagram() {
  const svg = document.getElementById('fsv-persistence-diagram');
  if (!svg || typeof d3 === 'undefined') return;

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 60));

  let data;
  try {
    data = await fetch(`${API}/api/tda/cycles`).then(r => r.json());
  } catch(e) { return; }

  const h0pts  = data.diagram_h0 || [];
  const h1pts  = data.diagram_h1 || [];
  const axMax  = data.diagram_max || 1.0;
  if (!h0pts.length && !h1pts.length) return;

  const W = svg.getBoundingClientRect().width || 420;
  const H = Math.round(W * 0.82);
  const M = { top: 16, right: 20, bottom: 44, left: 48 };
  const iW = W - M.left - M.right;
  const iH = H - M.top  - M.bottom;

  svg.setAttribute('width',  W);
  svg.setAttribute('height', H);
  d3.select(svg).selectAll('*').remove();

  const root = d3.select(svg).append('g').attr('transform', `translate(${M.left},${M.top})`);

  // Scales — include 0 on both axes
  const xSc = d3.scaleLinear().domain([0, axMax]).range([0, iW]);
  const ySc = d3.scaleLinear().domain([0, axMax]).range([iH, 0]);

  // Grid lines
  root.append('g').attr('class','grid')
    .call(d3.axisLeft(ySc).ticks(5).tickSize(-iW).tickFormat(''))
    .selectAll('line').attr('stroke','#2A2F3A').attr('stroke-dasharray','3,3');
  root.select('.grid .domain').remove();

  // Diagonal line y = x (death = birth → zero persistence)
  root.append('line')
    .attr('x1', xSc(0)).attr('y1', ySc(0))
    .attr('x2', xSc(axMax)).attr('y2', ySc(axMax))
    .attr('stroke','#59616E').attr('stroke-dasharray','5,4').attr('stroke-width', 1.2);

  // Shaded region below diagonal (impossible zone)
  root.append('polygon')
    .attr('points', `${xSc(0)},${ySc(0)} ${xSc(axMax)},${ySc(axMax)} ${xSc(axMax)},${ySc(0)}`)
    .attr('fill','rgba(42,47,58,0.5)');

  // Axes
  root.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(xSc).ticks(5))
    .selectAll('text,line,path').attr('stroke','#59616E').attr('fill','#59616E');
  root.append('g')
    .call(d3.axisLeft(ySc).ticks(5))
    .selectAll('text,line,path').attr('stroke','#59616E').attr('fill','#59616E');

  // Axis labels
  root.append('text')
    .attr('x', iW / 2).attr('y', iH + 36)
    .attr('fill','#878E9C').attr('font-size', 10).attr('text-anchor','middle')
    .attr('font-family','IBM Plex Mono,monospace').text('Birth');
  root.append('text')
    .attr('transform','rotate(-90)')
    .attr('x', -iH / 2).attr('y', -36)
    .attr('fill','#878E9C').attr('font-size', 10).attr('text-anchor','middle')
    .attr('font-family','IBM Plex Mono,monospace').text('Death');

  // Tooltip
  const tip = d3.select('body').selectAll('#pd-tip').data([0]).join('div')
    .attr('id','pd-tip')
    .style('position','fixed').style('pointer-events','none').style('opacity',0)
    .style('background','#20242D').style('border','1px solid #2A2F3A')
    .style('color','#D9DCE3').style('font-size','11px').style('padding','7px 10px')
    .style('border-radius','3px').style('font-family','IBM Plex Mono,monospace')
    .style('z-index','999').style('line-height','1.6');

  const showTip = (ev, d) => {
    const label = d.dim === 0 ? 'H₀ component' : 'H₁ loop';
    const pers  = d.persistence != null ? d.persistence.toFixed(4) : '∞';
    const death = d.death != null ? d.death.toFixed(4) : '∞';
    tip.html(`${label}<br>birth: ${d.birth.toFixed(4)}<br>death: ${death}<br>persistence: ${pers}`)
       .style('left', (ev.clientX + 14) + 'px')
       .style('top',  (ev.clientY - 10) + 'px')
       .transition().duration(80).style('opacity', 1);
  };
  const hideTip = () => tip.transition().duration(120).style('opacity', 0);

  const C_H0 = '#4EA8DE';   // bright blue  — H₀ connected components
  const C_H1 = '#FF6B6B';   // coral red    — H₁ loops

  // H₀: only show points within diagram bounds (H₀ raw deaths can be huge)
  const h0Finite = h0pts.filter(d => !d.infinite && d.death <= axMax);
  const h0Inf    = h0pts.filter(d =>  d.infinite);

  root.selectAll('.pt-h0').data(h0Finite).join('circle')
    .attr('class','pt-h0')
    .attr('cx', d => xSc(d.birth))
    .attr('cy', d => ySc(d.death))
    .attr('r', 5)
    .attr('fill', C_H0).attr('opacity', 0.85).attr('stroke','rgba(78,168,222,0.4)').attr('stroke-width',1)
    .on('mousemove', showTip).on('mouseleave', hideTip);

  // Infinite H₀ — diamond at top edge
  root.selectAll('.pt-h0-inf').data(h0Inf).join('path')
    .attr('class','pt-h0-inf')
    .attr('d', d3.symbol().type(d3.symbolDiamond).size(80))
    .attr('transform', d => `translate(${xSc(d.birth)}, ${ySc(axMax) + 8})`)
    .attr('fill', C_H0).attr('opacity', 1).attr('stroke','rgba(78,168,222,0.5)').attr('stroke-width',1.5)
    .on('mousemove', (ev, d) => showTip(ev, {...d, death: Infinity, persistence: Infinity}))
    .on('mouseleave', hideTip);

  // H₁ points
  root.selectAll('.pt-h1').data(h1pts).join('circle')
    .attr('class','pt-h1')
    .attr('cx', d => xSc(d.birth))
    .attr('cy', d => ySc(d.death))
    .attr('r', d => d.persistence > axMax * 0.1 ? 5.5 : 3.5)
    .attr('fill', C_H1).attr('opacity', d => Math.min(0.92, 0.35 + d.persistence / axMax))
    .attr('stroke', d => d.persistence > axMax * 0.2 ? 'rgba(255,107,107,0.5)' : 'none')
    .attr('stroke-width', 1.2)
    .on('mousemove', showTip).on('mouseleave', hideTip);

  // Label the top-5 most persistent H₁
  const top5 = [...h1pts].sort((a,b) => b.persistence - a.persistence).slice(0,5);
  root.selectAll('.lbl-h1').data(top5).join('text')
    .attr('class','lbl-h1')
    .attr('x', d => xSc(d.birth) + 7)
    .attr('y', d => ySc(d.death) - 4)
    .attr('fill', C_H1).attr('font-size', 9)
    .attr('font-family','IBM Plex Mono,monospace')
    .text(d => `p=${d.persistence.toFixed(3)}`);
}

// ── Full-screen Summary view ──────────────────────────────────────────────────

function buildFullSummaryView() {
  const s   = _datasetStats;
  const m   = (_findings && _findings.meta) ? _findings.meta : {};
  const tda = m.tda || {};

  // Dataset KPI tiles (4-col grid)
  const statGrid = document.getElementById('fsv-stat-grid');
  if (statGrid) {
    const clr = { tda:'var(--tda)', ok:'var(--ok)', warn:'var(--signal)', mute:'var(--mute)', '':'var(--text)' };
    const tiles = [
      { v: (s.total_records || 0).toLocaleString(), l: 'Aid Projects',      c: 'tda'  },
      { v: s.countries  ?? '–',                    l: 'Countries',          c: ''     },
      { v: s.sectors    ?? '–',                    l: 'DAC Sectors',        c: ''     },
      { v: s.year_range ?? '–',                    l: 'Year Range',         c: ''     },
      { v: `${(+(s.success_rate    || 0)).toFixed(1)}%`, l: 'Success Rate',       c: 'ok'   },
      { v: `${(+(s.avg_overrun_pct || 0)).toFixed(1)}%`, l: 'Avg Cost Overrun',   c: 'warn' },
      { v: (+(s.avg_cpi   || 0)).toFixed(1),              l: 'Avg CPI Score',      c: ''     },
      { v: `${Math.round(+(s.avg_eval_lag || 0))} days`,  l: 'Avg Eval Lag',       c: 'mute' },
    ];
    statGrid.innerHTML = tiles.map(t =>
      `<div style="background:var(--panel2);border:1px solid var(--line);border-radius:3px;padding:12px 14px">
         <div style="font-family:'IBM Plex Mono',monospace;font-size:22px;font-weight:700;color:${clr[t.c]}">${esc(String(t.v))}</div>
         <div style="font-size:9px;color:var(--faint);text-transform:uppercase;letter-spacing:.14em;margin-top:5px">${t.l}</div>
       </div>`
    ).join('');
  }

  // TDA shape metrics
  const tdaEl = document.getElementById('fsv-tda-metrics');
  if (tdaEl) {
    const b0 = tda.betti_0 ?? 1;
    const b1 = tda.betti_1 ?? 0;
    const mp = (+(tda.max_persistence ?? 0)).toFixed(4);
    tdaEl.innerHTML = [
      { v: b0, l: 'β₀ CONNECTED COMPONENTS' },
      { v: b1, l: 'β₁ TOPOLOGICAL LOOPS'    },
      { v: mp, l: 'MAX PERSISTENCE'          },
    ].map(t =>
      `<div style="background:var(--panel2);border:1px solid var(--line);border-radius:3px;padding:12px;text-align:center">
         <div style="font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:700;color:var(--tda)">${t.v}</div>
         <div style="font-size:9px;color:var(--faint);text-transform:uppercase;letter-spacing:.09em;margin-top:5px">${t.l}</div>
       </div>`
    ).join('');

    // Auto-interpretation
    const b1n = Number(b1);
    const mpn = parseFloat(mp);
    const nCl = m.n_clusters || 0;
    let shape = '';
    if (b1n === 0) {
      shape = `<b style="color:var(--tda)">Tree-like topology (acyclic)</b> — the dataset forms ${b0} connected component${b0!==1?'s':''} with no persistent cycles. Aid projects cluster into hierarchically separated groups without circular funding structure.`;
    } else if (b1n <= 5) {
      shape = `<b style="color:var(--tda)">Weakly cyclic topology</b> — ${b1n} persistent H₁ loop${b1n>1?'s':''} detected (max persistence ${mp}). Recurring structural patterns are present — possibly cyclical funding relationships or repeated project failure profiles across countries.`;
    } else if (b1n <= 50) {
      shape = `<b style="color:var(--signal)">Moderately cyclic topology (${b1n} loops)</b> — a significant number of H₁ loops reveals recurring structural patterns. This may indicate systematic co-occurrence of risk factors or repeated funding networks across sectors.`;
    } else {
      shape = `<b style="color:var(--signal)">Highly cyclic topology (${b1n} loops)</b> — an unusually high loop count signals deeply embedded, systematic structural patterns: correlated failure modes, circular funding networks, or shared risk factors propagating across countries and sectors.`;
    }
    if (mpn > 0.5)      shape += `<br><br>High persistence (<b>${mp}</b>) confirms these are <b style="color:var(--signal)">robust, statistically significant topological features</b> — not noise artefacts.`;
    else if (mpn > 0.2) shape += `<br><br>Persistence <b>${mp}</b> indicates <b style="color:var(--text)">moderate confidence</b> — patterns are real but not the dominant structural feature.`;
    else if (mpn > 0)   shape += `<br><br>Low persistence (<b>${mp}</b>) — treat as <b style="color:var(--mute)">exploratory signals</b> requiring further validation.`;
    if (nCl > 0) shape += `<br><br>DBSCAN found <b style="color:var(--tda)">${nCl} distinct cluster${nCl>1?'s':''}</b> — ${nCl > 5 ? 'highly fragmented across many diverse project archetypes' : 'grouped into ' + nCl + ' cohesive project profile' + (nCl>1?'s':'')}.`;

    const interpEl = document.getElementById('fsv-shape-interpretation');
    if (interpEl) interpEl.innerHTML = shape;

    // H₁ loops
    const h1   = tda.h1_features || [];
    const h1El = document.getElementById('fsv-h1-loops');
    if (h1El) {
      h1El.innerHTML = h1.length
        ? h1.slice(0, 8).map((lp, i) =>
            `<div style="padding:5px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:10px">
               <span style="color:var(--mute)">Loop ${i+1}</span>
               <span>persistence <b style="color:var(--tda)">${(lp.persistence||0).toFixed(4)}</b></span>
               <span style="color:var(--faint)">${(lp.birth||0).toFixed(4)} → ${(lp.death||0).toFixed(4)}</span>
             </div>`
          ).join('')
        : '<span style="color:var(--faint)">No H₁ loops detected</span>';
    }
  }

  // Finding distribution bars
  const distEl = document.getElementById('fsv-finding-dist');
  if (distEl) {
    const rows = [
      { k:'anomalies',     lensKey:'anomalies',     label:'Anomalies',     color:'var(--signal)', mkey:'n_anomalies'     },
      { k:'suspicious',    lensKey:'suspicious',    label:'Suspicious',    color:'var(--danger)', mkey:'n_suspicious'    },
      { k:'themes',        lensKey:'clusters',      label:'Clusters',      color:'var(--tda)',    mkey:'n_clusters'      },
      { k:'relationships', lensKey:'relationships', label:'Relationships', color:'var(--relate)', mkey:'n_relationships' },
      { k:'drift',         lensKey:'drift',         label:'Drift',         color:'var(--drift)',  mkey:'n_drift'         },
      { k:'topology',      lensKey:'topology',      label:'Topology',      color:'var(--tda)',    mkey:null              },
    ];
    const counts   = rows.map(r => r.mkey ? (m[r.mkey]||0) : (_findings[r.k]||[]).length);
    const maxCount = Math.max(1, ...counts);
    distEl.innerHTML = rows.map((r, i) => {
      const count = counts[i];
      const pct   = Math.round((count / maxCount) * 100);
      return `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer"
             onclick="showView('analysis');setLens('${r.lensKey}')">
          <div style="width:90px;font-size:11px;color:${r.color};font-family:'IBM Plex Mono',monospace;text-align:right;flex:none">${r.label}</div>
          <div style="flex:1;height:8px;background:var(--panel2);border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${r.color};opacity:.75;border-radius:4px"></div>
          </div>
          <div style="font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--text);width:36px;text-align:right;font-weight:600">${count}</div>
        </div>`;
    }).join('');
  }

  // Top signals (clickable cards)
  const sigEl = document.getElementById('fsv-top-signals');
  if (sigEl) {
    const all = [
      ...(_findings.anomalies  ||[]).slice(0,3).map(f=>({...f,_lens:'ANOMALY',    _lensKey:'anomalies',  _clr:'var(--signal)'})),
      ...(_findings.suspicious ||[]).slice(0,2).map(f=>({...f,_lens:'SUSPICIOUS', _lensKey:'suspicious', _clr:'var(--danger)'})),
      ...(_findings.topology   ||[]).slice(0,2).map(f=>({...f,_lens:'TOPOLOGY',   _lensKey:'topology',   _clr:'var(--tda)'   })),
      ...(_findings.drift      ||[]).slice(0,2).map(f=>({...f,_lens:'DRIFT',      _lensKey:'drift',      _clr:'var(--drift)' })),
    ].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,6);

    sigEl.innerHTML = all.length
      ? all.map(f =>
          `<div style="margin-bottom:10px;padding:10px 12px;background:var(--panel2);border:1px solid var(--line);border-left:2px solid ${f._clr};border-radius:3px;cursor:pointer"
               onclick="showView('analysis');setLens('${f._lensKey}')">
             <div style="font-size:10px;color:${f._clr};font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">${f._lens} · score ${(f.score||0).toFixed(3)}</div>
             <div style="font-size:13px;color:var(--text);font-weight:500;margin-bottom:3px">${esc(f.title||'')}</div>
             <div style="font-size:12px;color:var(--mute)">${esc((f.detail||'').slice(0,130))}${(f.detail||'').length>130?'…':''}</div>
           </div>`
        ).join('')
      : '<span style="color:var(--faint)">No signals loaded yet.</span>';
  }
}

async function fsvSummarizeLens() {
  const el = document.getElementById('fsv-ai-content');
  if (el) el.textContent = 'Generating lens analysis…';
  const activeLens = (typeof _currentLens !== 'undefined' && _currentLens) ? _currentLens : 'anomalies';
  try {
    const data = await fetch(`${API}/api/summarize`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ kind:'lens', lens:activeLens }),
    }).then(r => r.json());
    const note = data.note ? `<div style="margin-top:10px;color:var(--faint);font-size:11px">${esc(data.note)}</div>` : '';
    if (el) el.innerHTML = `<div>${mdLite(data.summary||'')}</div>${note}`;
  } catch(e) { if (el) el.textContent = 'Summary unavailable.'; }
}

async function fsvSummarizeDataset() {
  const el = document.getElementById('fsv-ai-content');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--faint);font-style:italic">Generating dataset overview…</span>';
  try {
    const data = await fetch(`${API}/api/summarize`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ kind:'overview' }),
    }).then(r => r.json());
    el.innerHTML = `<div style="line-height:1.8">${mdLite(data.summary||'')}</div>`;
    el.dataset.loaded = '1';
  } catch(e) { el.textContent = 'Summary unavailable — check the API server.'; }
}

function fsvLoadAI() { fsvSummarizeDataset(); }

// ── Summarize ─────────────────────────────────────────────────────────────────

async function summarize(mode) {
  const el = document.getElementById('summarize-content');
  if (el) el.textContent = 'Generating summary…';
  if (typeof switchRTab === 'function') switchRTab('summarize');

  // "Overview" button → AI summary of the currently active lens (>=3 paragraphs).
  const activeLens = (typeof _currentLens !== 'undefined' && _currentLens) ? _currentLens : 'anomalies';
  let body = { kind: 'lens', lens: activeLens };
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
    const note = data.note ? `<div style="margin-top:10px;color:var(--faint);font-size:11px">${esc(data.note)}</div>` : '';
    if (el) el.innerHTML = `<div class="sum-text">${mdLite(data.summary || '')}</div>${note}`;
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
      <div style="font-size:12.5px;line-height:1.6;color:var(--mute)">${mdLite(data.explanation)}</div>
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
      <div style="font-size:12.5px;line-height:1.6;color:var(--text)">${mdLite(data.answer)}</div>
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

const VIEWS = ['work', 'view-tda-explorer', 'view-report', 'view-summary', 'view-persistence', 'view-gov-aid-report'];

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

  } else if (name === 'summary') {
    const el = document.getElementById('view-summary');
    if (el) el.style.display = 'flex';
    buildFullSummaryView();
    const aiEl = document.getElementById('fsv-ai-content');
    if (aiEl && !aiEl.dataset.loaded) fsvSummarizeDataset();

  } else if (name === 'persistence') {
    const el = document.getElementById('view-persistence');
    if (el) el.style.display = 'flex';
    buildPersistenceDiagram();
    buildTemporalChart();

  } else {
    // analysis (default)
    if (work) work.style.display = '';
  }

  // Update nav highlight
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  const navMap = {
    'tda-explorer': 'btn-explorer',
    'report':       'btn-report',
    'summary':      'btn-summary',
    'persistence':  'btn-persistence',
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

// Minimal Markdown → HTML for AI-generated text (headings + **bold**), HTML-escaped first.
function mdLite(text) {
  return (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{3}\s+(.+)$/gm, '<div style="font-weight:700;color:var(--text);margin:14px 0 6px">$1</div>')
    .replace(/^#{2}\s+(.+)$/gm, '<div style="font-weight:700;font-size:14px;color:var(--tda);margin:16px 0 8px">$1</div>')
    .replace(/^#{1}\s+(.+)$/gm, '<div style="font-weight:700;font-size:15px;color:var(--text);margin:16px 0 8px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text)">$1</strong>')
    .replace(/\n/g, '<br>')
    .replace(/(<\/div>)<br>/g, '$1');
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
      textEl.innerHTML = mdLite(data.ai_section);
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
    const svgH = Math.max(window.innerHeight - 100 - 60 - 44, 320); // minus header/nav + reserve caption row
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
