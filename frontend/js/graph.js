// ── Force-directed graph (D3) ─────────────────────────────────────────────────

async function renderGraph() {
  try {
    const data = await fetch(`${API}/api/tda/graph`).then(r => r.json());
    const nodes = (data.nodes || []).slice(0, 35);

    // API returns edges as {a, b, w} — normalise to {source, target, w} for D3
    const edges = (data.edges || []).slice(0, 50).map(e => ({
      source: e.a || e.source,
      target: e.b || e.target,
      w:      e.w || 1,
    }));

    // Only keep edges whose source+target both exist as node IDs
    const nodeIds = new Set(nodes.map(n => n.id));
    const validEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    drawForceGraph(nodes, validEdges);
  } catch (e) {
    const svg = document.getElementById('graph-svg');
    if (svg) svg.innerHTML = '<text x="50%" y="50%" fill="#878e9c" font-size="13" text-anchor="middle" dominant-baseline="middle">Graph unavailable — check API</text>';
  }
}

function drawForceGraph(nodes, edges) {
  if (typeof d3 === 'undefined') return;
  const svgEl  = document.getElementById('graph-svg');
  if (!svgEl) return;
  // Use getBoundingClientRect for accurate size after layout; fallback to panel defaults
  const rect   = svgEl.getBoundingClientRect();
  const W      = rect.width  || svgEl.clientWidth  || 420;
  const H      = rect.height || svgEl.clientHeight || 310;
  if (!svgEl.getAttribute('width'))  svgEl.setAttribute('width',  W);
  if (!svgEl.getAttribute('height')) svgEl.setAttribute('height', H);
  const svg    = d3.select('#graph-svg');
  svg.selectAll('*').remove();

  const g = svg.append('g');
  svg.call(
    d3.zoom().scaleExtent([0.25, 5])
      .on('zoom', e => g.attr('transform', e.transform))
  );

  const maxDocs = Math.max(1, ...nodes.map(n => n.docs || 1));

  const sim = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(edges).id(d => d.id).distance(100))
    .force('charge',    d3.forceManyBody().strength(-140))
    .force('center',    d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(30));

  // Edges
  const link = g.append('g').selectAll('line')
    .data(edges).enter().append('line')
    .attr('stroke', 'var(--line)')
    .attr('stroke-opacity', .55)
    .attr('stroke-width', d => Math.max(1, (d.w || 1) / 5));

  // Nodes
  const node = g.append('g').selectAll('g')
    .data(nodes).enter().append('g')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    )
    .on('click', (e, d) => showNodeInfo(d));

  node.append('circle')
    .attr('r', d => 8 + (d.docs / maxDocs) * 18)
    .attr('fill', d => (d.exposure || 0) > 0.5 ? 'rgba(224,82,82,.55)' : 'rgba(94,156,166,.5)')
    .attr('stroke', d => (d.exposure || 0) > 0.5 ? '#E05252' : '#5E9CA6')
    .attr('stroke-width', 1.5)
    .style('cursor', 'pointer');

  node.append('text')
    .attr('dy', -13)
    .attr('text-anchor', 'middle')
    .attr('fill', '#878E9C')
    .attr('font-size', 9)
    .attr('font-family', "'IBM Plex Mono', monospace")
    .attr('pointer-events', 'none')
    .text(d => String(d.id || '').slice(0, 16));

  // Mapper nodes as purple dots (smaller)
  // (mapper_nodes rendered separately if provided)

  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

function showNodeInfo(d) {
  const body = document.getElementById('audit-content');
  if (!body) return;
  body.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px">${esc(d.id)}</div>
    <div class="audit-step">
      <span class="step-icon">📁</span>
      <div class="step-body">
        <div class="label">Projects</div>
        <div class="val">${d.docs} records</div>
      </div>
    </div>
    <div class="audit-step">
      <span class="step-icon">⚠️</span>
      <div class="step-body">
        <div class="label">Anomaly Exposure</div>
        <div class="val">${(d.exposure || 0).toFixed(3)}</div>
      </div>
    </div>`;
  if (typeof switchRTab === 'function') switchRTab('audit');
}
