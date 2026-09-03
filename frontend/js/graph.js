// ── Topology Mapper Graph ─────────────────────────────────────────────────────
// Scatter visualization: X = time (approval year proxy), Y = topology score
// Nodes = mapper intervals, colored by anomaly state, edges = topological adjacency

async function renderGraph() {
  try {
    const [graphData, findingsData] = await Promise.all([
      fetch(`${API}/api/tda/graph`).then(r => r.json()),
      fetch(`${API}/api/findings`).then(r => r.json()),
    ]);

    // Build anomaly score map: project_id → score
    const scoreMap = {};
    (findingsData.anomalies || []).forEach(a => {
      (a.sources || []).forEach(s => { scoreMap[s] = a.score || 0; });
    });

    const mapperNodes = graphData.mapper_nodes || [];
    const mapperEdges = graphData.mapper_edges || [];

    if (mapperNodes.length > 1) {
      drawTopologyScatter(mapperNodes, mapperEdges, scoreMap);
    } else {
      // Fallback: force-directed relationship graph
      const nodes     = (graphData.nodes || []).slice(0, 35);
      const rawEdges  = (graphData.edges || []).slice(0, 50);
      const edges     = rawEdges.map(e => ({ source: e.a || e.source, target: e.b || e.target, w: e.w || 1 }));
      const nodeIds   = new Set(nodes.map(n => n.id));
      const validEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
      drawForceGraph(nodes, validEdges);
    }
  } catch (e) {
    _graphError('Graph unavailable — check API');
  }
}

// ── Topology Scatter (main) ────────────────────────────────────────────────────

function drawTopologyScatter(mapperNodes, mapperEdges, scoreMap) {
  const svgEl = document.getElementById('graph-svg');
  if (!svgEl || typeof d3 === 'undefined') return;

  const rect = svgEl.getBoundingClientRect();
  const W    = Math.max(rect.width  || svgEl.clientWidth  || 420, 300);
  const H    = Math.max(rect.height || svgEl.clientHeight || 310, 220);
  svgEl.setAttribute('width',  W);
  svgEl.setAttribute('height', H);

  const margin = { top: 32, right: 20, bottom: 52, left: 52 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

  // ── Compute node metrics ──────────────────────────────────────────────────
  const YEAR_MIN = 2005, YEAR_MAX = 2024;

  const enriched = mapperNodes.map((nd, i) => {
    const srcs      = nd.sources || [];
    const scores    = srcs.map(s => scoreMap[s] || 0.05);
    const avgScore  = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.05;
    const maxScore  = scores.length ? Math.max(...scores) : 0.05;
    const fracAnom  = scores.filter(s => s > 0.5).length / (scores.length || 1);

    // X = interval position mapped to year range (with jitter)
    const totalIntervals = Math.max(...mapperNodes.map(n => n.interval || 0)) + 1 || 1;
    const intervalFrac   = (nd.interval || i) / Math.max(totalIntervals - 1, 1);
    const yearProxy      = YEAR_MIN + intervalFrac * (YEAR_MAX - YEAR_MIN);
    const jitter         = (Math.sin(i * 7.3) * 0.6);  // deterministic jitter

    // State classification
    let state;
    if (maxScore > 0.6 || fracAnom > 0.4)      state = 'anomalous';
    else if (avgScore > 0.3 || fracAnom > 0.15) state = 'warning';
    else                                         state = 'normal';

    return {
      ...nd,
      yearX:     yearProxy + jitter,
      topoY:     Math.min(avgScore * 1.1, 1.0),
      avgScore,
      maxScore,
      fracAnom,
      state,
      label:     srcs[0] ? srcs[0].replace('AID-', '#') : `N${i}`,
    };
  });

  // ── Scales ────────────────────────────────────────────────────────────────
  const xDomain = [YEAR_MIN - 1, YEAR_MAX + 1];
  const yDomain = [0, Math.max(0.55, d3.max(enriched, d => d.topoY) * 1.15)];

  const xScale = d3.scaleLinear().domain(xDomain).range([0, innerW]);
  const yScale = d3.scaleLinear().domain(yDomain).range([innerH, 0]);

  // ── Color map ─────────────────────────────────────────────────────────────
  const stateColor = {
    normal:    '#4EA8DE',
    warning:   '#E0A33E',
    anomalous: '#E05252',
  };
  const stateStroke = {
    normal:    '#2a7db5',
    warning:   '#b5651d',
    anomalous: '#8B1A1A',
  };

  // ── Draw ──────────────────────────────────────────────────────────────────
  d3.select(svgEl).selectAll('*').remove();

  const root = d3.select(svgEl).append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Title
  d3.select(svgEl).append('text')
    .attr('x', margin.left)
    .attr('y', 18)
    .attr('fill', '#D9DCE3')
    .attr('font-size', 12)
    .attr('font-family', "'Space Grotesk', sans-serif")
    .attr('font-weight', 600)
    .text('Topology Graph (Mapper)');

  // Grid lines
  root.append('g').attr('class', 'grid-y')
    .selectAll('line')
    .data(yScale.ticks(5))
    .enter().append('line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
    .attr('stroke', 'rgba(42,47,58,.7)')
    .attr('stroke-dasharray', '3,3');

  // ── Edges ─────────────────────────────────────────────────────────────────
  const edgeG = root.append('g').attr('class', 'mapper-edges');
  mapperEdges.forEach(e => {
    const s = enriched[e.source];
    const t = enriched[e.target];
    if (!s || !t) return;
    edgeG.append('line')
      .attr('x1', xScale(s.yearX)).attr('y1', yScale(s.topoY))
      .attr('x2', xScale(t.yearX)).attr('y2', yScale(t.topoY))
      .attr('stroke', 'rgba(169,180,196,.25)')
      .attr('stroke-width', 1.2);
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const tooltip = d3.select('body').select('#topo-tooltip').empty()
    ? d3.select('body').append('div').attr('id', 'topo-tooltip')
        .style('position', 'fixed').style('pointer-events', 'none')
        .style('background', 'var(--panel2)').style('border', '1px solid var(--line)')
        .style('padding', '6px 10px').style('border-radius', '4px')
        .style('font-size', '11px').style('font-family', "'IBM Plex Mono', monospace")
        .style('color', 'var(--text)').style('display', 'none').style('z-index', '9999')
    : d3.select('#topo-tooltip');

  const nodeG = root.append('g').attr('class', 'mapper-nodes');
  enriched.forEach((nd, i) => {
    const cx  = xScale(nd.yearX);
    const cy  = yScale(nd.topoY);
    const r   = 5 + Math.sqrt(nd.size || 1) * 1.8;
    const col = stateColor[nd.state];
    const str = stateStroke[nd.state];

    const g = nodeG.append('g')
      .attr('transform', `translate(${cx},${cy})`)
      .style('cursor', 'pointer');

    // Outer glow for anomalous
    if (nd.state === 'anomalous') {
      g.append('circle').attr('r', r + 4)
        .attr('fill', 'rgba(224,82,82,.15)')
        .attr('stroke', 'none');
    }

    g.append('circle')
      .attr('r', r)
      .attr('fill', col)
      .attr('fill-opacity', 0.82)
      .attr('stroke', str)
      .attr('stroke-width', 1.5);

    // Highlight the top anomalous node with label
    if (nd.state === 'anomalous' && nd.avgScore === Math.max(...enriched.map(n => n.avgScore))) {
      g.append('text')
        .attr('dy', -r - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', col)
        .attr('font-size', 9.5)
        .attr('font-family', "'IBM Plex Mono', monospace")
        .attr('font-weight', 600)
        .text(nd.label);
    }

    g.on('mouseover', (event) => {
      g.select('circle').attr('stroke-width', 2.5).attr('r', r + 1.5);
      tooltip
        .style('display', 'block')
        .style('left', (event.clientX + 12) + 'px')
        .style('top',  (event.clientY - 28) + 'px')
        .html(
          `<b>${nd.label}</b><br>` +
          `state: <span style="color:${col}">${nd.state}</span><br>` +
          `score: ${nd.avgScore.toFixed(3)}<br>` +
          `records: ${nd.size || (nd.sources||[]).length}<br>` +
          `year ≈ ${Math.round(nd.yearX)}`
        );
    })
    .on('mousemove', (event) => {
      tooltip.style('left', (event.clientX + 12) + 'px').style('top', (event.clientY - 28) + 'px');
    })
    .on('mouseout', () => {
      g.select('circle').attr('stroke-width', 1.5).attr('r', r);
      tooltip.style('display', 'none');
    })
    .on('click', () => showMapperNodeInfo(nd));
  });

  // ── Axes ─────────────────────────────────────────────────────────────────
  const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => Math.round(d));
  const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('.2f'));

  root.append('g').attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(xAxis)
    .call(g => {
      g.select('.domain').attr('stroke', 'var(--line)');
      g.selectAll('text').attr('fill', '#878E9C').attr('font-size', 9);
      g.selectAll('line').attr('stroke', 'var(--line)');
    });

  root.append('g').attr('class', 'y-axis')
    .call(yAxis)
    .call(g => {
      g.select('.domain').attr('stroke', 'var(--line)');
      g.selectAll('text').attr('fill', '#878E9C').attr('font-size', 9);
      g.selectAll('line').attr('stroke', 'var(--line)');
    });

  // Axis labels
  root.append('text')
    .attr('x', innerW / 2).attr('y', innerH + 38)
    .attr('text-anchor', 'middle')
    .attr('fill', '#59616E')
    .attr('font-size', 9.5)
    .attr('font-family', "'Space Grotesk', sans-serif")
    .text('time (approval year — jittered)');

  root.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2).attr('y', -40)
    .attr('text-anchor', 'middle')
    .attr('fill', '#59616E')
    .attr('font-size', 9.5)
    .attr('font-family', "'Space Grotesk', sans-serif")
    .text('topology score');

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendY = H - 16;
  const legendData = [
    { label: 'Normal States',    color: stateColor.normal    },
    { label: 'Warning States',   color: stateColor.warning   },
    { label: 'Anomalous States', color: stateColor.anomalous },
  ];
  const legendG = d3.select(svgEl).append('g').attr('transform', `translate(${margin.left},${legendY})`);
  let lx = 0;
  legendData.forEach(({ label, color }) => {
    legendG.append('circle').attr('cx', lx + 5).attr('cy', 0).attr('r', 5)
      .attr('fill', color).attr('fill-opacity', .85);
    legendG.append('text').attr('x', lx + 13).attr('y', 4)
      .attr('fill', '#878E9C').attr('font-size', 9)
      .attr('font-family', "'Space Grotesk', sans-serif")
      .text(label);
    lx += label.length * 5.5 + 18;
  });

  // ── Caption ───────────────────────────────────────────────────────────────
  const capText = document.getElementById('graph-caption');
  if (capText) {
    capText.innerHTML =
      'Each dot = one mapper node &nbsp;•&nbsp; X-axis = time (jittered)<br>' +
      'Click a node to view details &amp; contributing records';
  }
}

// ── Node info panel ────────────────────────────────────────────────────────────

function showMapperNodeInfo(nd) {
  const body = document.getElementById('audit-content');
  if (!body) return;
  const col = nd.state === 'anomalous' ? 'var(--danger)' : nd.state === 'warning' ? 'var(--signal)' : 'var(--relate)';
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px">
      Mapper Node — ${nd.label}
    </div>
    <div class="audit-step">
      <span class="step-icon">🔵</span>
      <div class="step-body">
        <div class="label">State</div>
        <div class="val" style="color:${col}">${nd.state.toUpperCase()}</div>
      </div>
    </div>
    <div class="audit-step">
      <span class="step-icon">📊</span>
      <div class="step-body">
        <div class="label">Avg Topology Score</div>
        <div class="val">${nd.avgScore.toFixed(4)}</div>
      </div>
    </div>
    <div class="audit-step">
      <span class="step-icon">📁</span>
      <div class="step-body">
        <div class="label">Records in Node</div>
        <div class="val">${nd.size || (nd.sources||[]).length}</div>
      </div>
    </div>
    <div class="audit-step">
      <span class="step-icon">📅</span>
      <div class="step-body">
        <div class="label">Year Proxy</div>
        <div class="val">≈ ${Math.round(nd.yearX)}</div>
      </div>
    </div>
    <div class="audit-step">
      <span class="step-icon">🗂</span>
      <div class="step-body">
        <div class="label">Sample Project IDs</div>
        <div class="val">${(nd.sources||[]).slice(0,5).join(', ') || '—'}</div>
      </div>
    </div>
    <div class="audit-verified">✓ TRACEABLE — Mapper interval ${nd.interval || 0}</div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}

// ── Fallback: Force-directed graph ────────────────────────────────────────────

function drawForceGraph(nodes, edges) {
  if (typeof d3 === 'undefined') return;
  const svgEl = document.getElementById('graph-svg');
  if (!svgEl) return;
  const rect = svgEl.getBoundingClientRect();
  const W    = Math.max(rect.width  || svgEl.clientWidth  || 420, 300);
  const H    = Math.max(rect.height || svgEl.clientHeight || 310, 220);
  svgEl.setAttribute('width',  W);
  svgEl.setAttribute('height', H);

  const svg = d3.select('#graph-svg');
  svg.selectAll('*').remove();
  const g = svg.append('g');

  svg.call(d3.zoom().scaleExtent([0.25, 5]).on('zoom', e => g.attr('transform', e.transform)));

  const maxDocs = Math.max(1, ...nodes.map(n => n.docs || 1));
  const sim = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(edges).id(d => d.id).distance(90))
    .force('charge',    d3.forceManyBody().strength(-130))
    .force('center',    d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide(28));

  const link = g.append('g').selectAll('line').data(edges).enter().append('line')
    .attr('stroke', 'rgba(42,47,58,.6)').attr('stroke-width', d => Math.max(1, (d.w||1)/5));

  const node = g.append('g').selectAll('g').data(nodes).enter().append('g')
    .call(d3.drag()
      .on('start', (e,d) => { if(!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag',  (e,d) => { d.fx=e.x; d.fy=e.y; })
      .on('end',   (e,d) => { if(!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }))
    .on('click', (e,d) => showNodeInfo(d));

  node.append('circle')
    .attr('r', d => 8 + (d.docs/maxDocs)*18)
    .attr('fill', d => (d.exposure||0)>0.5 ? 'rgba(224,82,82,.55)' : 'rgba(94,156,166,.5)')
    .attr('stroke', d => (d.exposure||0)>0.5 ? '#E05252' : '#5E9CA6')
    .attr('stroke-width', 1.5).style('cursor','pointer');

  node.append('text')
    .attr('dy',-13).attr('text-anchor','middle').attr('fill','#878E9C')
    .attr('font-size',9).attr('font-family',"'IBM Plex Mono',monospace")
    .attr('pointer-events','none').text(d => String(d.id||'').slice(0,16));

  sim.on('tick', () => {
    link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
        .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    node.attr('transform', d=>`translate(${d.x},${d.y})`);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showNodeInfo(d) {
  const body = document.getElementById('audit-content');
  if (!body) return;
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px">${esc(d.id)}</div>
    <div class="audit-step">
      <span class="step-icon">📁</span>
      <div class="step-body"><div class="label">Projects</div><div class="val">${d.docs} records</div></div>
    </div>
    <div class="audit-step">
      <span class="step-icon">⚠️</span>
      <div class="step-body"><div class="label">Anomaly Exposure</div><div class="val">${(d.exposure||0).toFixed(3)}</div></div>
    </div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}

function _graphError(msg) {
  const svg = document.getElementById('graph-svg');
  if (svg) svg.innerHTML = `<text x="50%" y="50%" fill="#878e9c" font-size="13" text-anchor="middle" dominant-baseline="middle">${msg}</text>`;
}
