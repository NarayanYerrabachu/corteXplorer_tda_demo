// ── Shared utilities ──────────────────────────────────────────────────────────

function esc(s) {
  if (!s) return '';
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 3000);
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>')
    .replace(/  -/g, '&nbsp;&nbsp;•')
    .replace(/^- /gm, '• ');
}

function switchRTab(name) {
  document.querySelectorAll('.rtab').forEach((b, i) => {
    const names = ['graph', 'audit', 'summarize'];
    b.classList.toggle('active', names[i] === name);
  });
  ['graph', 'audit', 'summarize'].forEach(n => {
    const el = document.getElementById(`tab-${n}`);
    if (el) el.style.display = n === name ? '' : 'none';
  });
}
