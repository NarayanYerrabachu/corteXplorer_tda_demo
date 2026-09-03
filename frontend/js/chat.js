// ── Chat (inline overlay + standalone page) ───────────────────────────────────

let _chatHistory = [];
let _chatBusy    = false;

function initChatOverlay() {
  const btn = document.getElementById('btn-chat-open');
  if (btn) btn.onclick = () => document.getElementById('chat-overlay')?.classList.toggle('open');
}

async function sendChat() {
  if (_chatBusy) return;
  const inp = document.getElementById('chat-input');
  const msg = inp?.value?.trim();
  if (!msg) return;
  if (inp) inp.value = '';

  appendChatMsg(msg, 'user');
  _chatHistory.push({ role: 'user', content: msg });
  _chatBusy = true;

  try {
    const data = await fetch(`${API}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: msg, history: _chatHistory.slice(-6) }),
    }).then(r => r.json());

    _chatHistory.push({ role: 'assistant', content: data.answer });
    appendChatMsg(data.answer, 'bot');
  } catch (e) {
    appendChatMsg('Chat unavailable — check the API server on port 8010.', 'bot');
  } finally {
    _chatBusy = false;
  }
}

function appendChatMsg(text, role) {
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ── Standalone chat page helpers ───────────────────────────────────────────

let _standaloneBusy = false;

async function askStandalone(question) {
  const inp = document.getElementById('chat-input');
  if (inp) inp.value = question;
  await sendMsgStandalone();
}

async function sendMsgStandalone() {
  if (_standaloneBusy) return;
  const inp = document.getElementById('chat-input');
  const msg = inp?.value?.trim();
  if (!msg) return;
  inp.value = '';
  inp.style.height = 'auto';

  appendStandaloneMsg(msg, 'user');
  _chatHistory.push({ role: 'user', content: msg });
  _standaloneBusy = true;
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = true;

  const typingId = appendTypingIndicator();

  try {
    const data = await fetch(`${API}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: msg, history: _chatHistory.slice(-8) }),
    }).then(r => r.json());

    removeTyping(typingId);
    _chatHistory.push({ role: 'assistant', content: data.answer });
    appendStandaloneMsg(data.answer, 'bot', data.traceable);
  } catch (e) {
    removeTyping(typingId);
    appendStandaloneMsg('Cannot connect to CorteXplorer API. Is the server running on port 8010?', 'bot', false);
  } finally {
    _standaloneBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    if (inp) inp.focus();
  }
}

function appendStandaloneMsg(text, role, traceable) {
  const box  = document.getElementById('chat-msgs');
  if (!box) return;
  const el   = document.createElement('div');
  el.className = `msg ${role}`;
  const init = role === 'user' ? 'U' : 'CX';
  const badge = (role === 'bot' && traceable !== false)
    ? '<div class="traceable-badge">✓ TRACEABLE</div>' : '';
  el.innerHTML = `
    <div class="avatar">${init}</div>
    <div class="bubble">${formatText(esc(text))}${badge}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function appendTypingIndicator() {
  const box = document.getElementById('chat-msgs');
  if (!box) return null;
  const id  = 'typing-' + Date.now();
  const el  = document.createElement('div');
  el.className = 'msg bot loading';
  el.id = id;
  el.innerHTML = `<div class="avatar">CX</div>
    <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return id;
}

function removeTyping(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}
