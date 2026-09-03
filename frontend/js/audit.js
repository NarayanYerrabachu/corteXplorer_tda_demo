// ── Audit trail ───────────────────────────────────────────────────────────────

async function loadAudit(recordId) {
  if (typeof switchRTab === 'function') switchRTab('audit');
  const body = document.getElementById('audit-content');
  if (!body) return;
  body.innerHTML = '<div class="src-empty">Loading audit trail…</div>';

  try {
    const data = await fetch(`${API}/api/audit/${encodeURIComponent(recordId)}`).then(r => r.json());
    const trail = data.audit_trail || [];
    const icons = ['🗄', '🔑', '✅', '🧹', '⚙️', '📐', '🔢', '🔭', '🔬', '🎯', '🚦', '✓'];

    body.innerHTML = trail.map((s, i) => `
      <div class="audit-step">
        <span class="step-icon">${icons[i] || '•'}</span>
        <div class="step-body">
          <div class="label">${esc(s.step)}</div>
          <div class="val">${esc(s.desc)} — <b>${esc(s.value)}</b></div>
        </div>
      </div>`).join('') +
      `<div class="audit-verified">✓ 100% TRACEABLE — source: ${esc(recordId)}</div>`;
  } catch (e) {
    body.innerHTML = `<div class="src-empty">Could not load audit trail for ${esc(recordId)}.</div>`;
  }
}
