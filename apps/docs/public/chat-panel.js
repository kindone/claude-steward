/**
 * Claude Docs Chat Panel
 * Injected into every MkDocs page. Self-contained vanilla JS.
 * Chat history persists in localStorage across page navigations/reloads.
 */
(function () {
  'use strict';

  // Namespace localStorage keys by docsDir so two different docs apps that
  // run on the same slot (same port/origin at different times) never share
  // chat history, model preferences, or drafts.
  // __STEWARD_DOCS_DIR__ is injected by proxy.ts before this script runs.
  const _ns = (typeof window !== 'undefined' && window.__STEWARD_DOCS_DIR__)
    ? ':' + window.__STEWARD_DOCS_DIR__
    : '';
  const STORAGE_KEY = 'claude-docs-chat'  + _ns;
  const MAX_STORED  = 40;
  const MODEL_KEY   = 'claude-docs-model' + _ns;
  const CLI_KEY     = 'claude-docs-cli'   + _ns;
  const DRAFT_KEY   = 'claude-docs-draft' + _ns;
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  const DEFAULT_CLI   = 'claude';

  const FALLBACK_META = {
    defaultCli: DEFAULT_CLI,
    adapters: {
      claude: {
        label: 'Claude',
        available: true,
        models: [
          { value: null, label: 'Default' },
          { value: 'claude-opus-4-6', label: 'Opus 4.6' },
          { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
          { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
        ],
        capabilities: { streamingTokens: true, toolUseStructured: true, branchResume: true },
      },
      opencode: {
        label: 'OpenCode',
        available: true,
        models: [
          { value: null, label: 'Default (env)' },
          { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
          { value: 'google/gemma-4-31b-it', label: 'Gemma 4 31B' },
          { value: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6 (OC)' },
          { value: 'openai/gpt-5.1', label: 'GPT-5.1' },
          { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
        ],
        capabilities: { streamingTokens: false, toolUseStructured: true, branchResume: true },
      },
    },
  };

  // ── State ──────────────────────────────────────────────────────────────────

  let cliMeta = FALLBACK_META;
  let messages = [];
  let isOpen = false;
  let isSending = false;
  let isUnloading = false;   // set true in pagehide so fetch TypeErrors are treated as clean aborts
  let currentCli = DEFAULT_CLI;
  let currentModel = DEFAULT_MODEL;
  const OPEN_KEY = 'claude-docs-open';
  let abortController = null;
  let currentAssistantId = null;

  // ── CLI/meta helpers ──────────────────────────────────────────────────────

  function getAdapterMeta(name) {
    return (cliMeta.adapters && cliMeta.adapters[name]) || FALLBACK_META.adapters[name] || null;
  }

  function modelValueKey(val) {
    return val == null ? '__default__' : String(val);
  }

  function adapterHasModel(adapter, value) {
    if (!adapter || value === undefined) return false;
    const key = modelValueKey(value);
    return Array.isArray(adapter.models) && adapter.models.some(m => modelValueKey(m.value) === key);
  }

  function loadModelPreference(cli) {
    try {
      const raw = localStorage.getItem(MODEL_KEY);
      if (!raw) return null;
      if (raw.trim().startsWith('{')) {
        const map = JSON.parse(raw);
        return map?.[cli] ?? null;
      }
      return raw;
    } catch { return null; }
  }

  function saveModelPreference(cli, value) {
    try {
      let map = {};
      const raw = localStorage.getItem(MODEL_KEY);
      if (raw) {
        if (raw.trim().startsWith('{')) {
          map = JSON.parse(raw) || {};
        } else {
          map = { [DEFAULT_CLI]: raw };
        }
      }
      map[cli] = value;
      localStorage.setItem(MODEL_KEY, JSON.stringify(map));
    } catch { /* ignore */ }
  }

  function resolveCli(desired) {
    const adapters = cliMeta.adapters || {};
    if (desired && adapters[desired]?.available) return desired;
    if (adapters[cliMeta.defaultCli]?.available) return cliMeta.defaultCli;
    const firstAvailable = Object.entries(adapters).find(([, meta]) => meta.available);
    if (firstAvailable) return firstAvailable[0];
    if (desired && adapters[desired]) return desired;
    return Object.keys(adapters)[0] || DEFAULT_CLI;
  }

  function resolveModel(cli, { preferCurrent = false } = {}) {
    const adapter = getAdapterMeta(cli);
    if (!adapter || !Array.isArray(adapter.models) || adapter.models.length === 0) return null;
    const candidates = [];
    if (preferCurrent && currentCli === cli) candidates.push(currentModel);
    candidates.push(loadModelPreference(cli));
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      if (adapterHasModel(adapter, candidate)) return candidate ?? null;
    }
    return adapter.models[0].value ?? null;
  }

  function hydratePreferences({ preferCurrent = false } = {}) {
    let storedCli = null;
    try { storedCli = localStorage.getItem(CLI_KEY); } catch { /* ignore */ }
    currentCli = resolveCli(storedCli || currentCli || cliMeta.defaultCli || DEFAULT_CLI);
    currentModel = resolveModel(currentCli, { preferCurrent }) ?? null;
  }

  function populateCliOptions() {
    if (!cliSelect) return;
    const adapters = cliMeta.adapters || {};
    cliSelect.innerHTML = Object.entries(adapters).map(([name, info]) => {
      const disabled = info.available ? '' : ' disabled';
      const note = info.available ? '' : ' (missing)';
      return `<option value="${name}"${disabled}>${info.label}${note}</option>`;
    }).join('');
    cliSelect.value = currentCli;
    if (cliSelect.value !== currentCli) cliSelect.value = '';
    cliSelect.disabled = isSending || messages.length > 0;
    cliSelect.title = messages.length > 0
      ? 'Changing CLI is not supported mid-session. Use New session first.'
      : 'Choose CLI backend';
  }

  function populateModelOptions() {
    if (!modelSelect) return;
    const adapter = getAdapterMeta(currentCli);
    if (!adapter || !Array.isArray(adapter.models) || adapter.models.length === 0) {
      modelSelect.innerHTML = '<option value="">Unavailable</option>';
      modelSelect.disabled = true;
      return;
    }
    modelSelect.innerHTML = adapter.models
      .map(m => `<option value="${m.value == null ? '' : m.value}">${m.label}</option>`)
      .join('');
    if (!adapterHasModel(adapter, currentModel)) {
      currentModel = adapter.models[0].value ?? null;
      saveModelPreference(currentCli, currentModel);
    }
    modelSelect.value = currentModel == null ? '' : currentModel;
    modelSelect.disabled = isSending;
  }

  function updateCliLabel() {
    if (!cliLabelEl) return;
    const adapter = getAdapterMeta(currentCli);
    cliLabelEl.textContent = adapter ? adapter.label : currentCli;
  }

  function refreshCliUi() {
    populateCliOptions();
    populateModelOptions();
    updateCliLabel();
  }

  function setCli(name, { force = false, persist = true, persistModel = true } = {}) {
    const adapter = getAdapterMeta(name);
    if (!adapter) return;
    if (!adapter.available && !force) return;
    if (currentCli === name && !force) return;
    currentCli = name;
    if (persist) {
      try { localStorage.setItem(CLI_KEY, currentCli); } catch { /* ignore */ }
    }
    currentModel = resolveModel(currentCli, { preferCurrent: false });
    if (persistModel) saveModelPreference(currentCli, currentModel);
    refreshCliUi();
  }

  function loadChatMeta() {
    fetch('/api/chat/meta')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('meta request failed')))
      .then((meta) => {
        cliMeta = meta;
        hydratePreferences({ preferCurrent: true });
        refreshCliUi();
      })
      .catch(() => {
        refreshCliUi();
      });
  }

  function loadMessages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) messages = JSON.parse(raw);
      // Fix any stuck-streaming messages from a previous interrupted load
      let fixed = false;
      messages = messages.map(m => {
        if (m.isStreaming) { fixed = true; return { ...m, isStreaming: false }; }
        return m;
      });
      if (fixed) saveMessages();
    } catch { messages = []; }
  }

  function saveMessages() {
    try {
      const toSave = messages.slice(-MAX_STORED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* storage full — ignore */ }
  }

  function clearMessages() {
    messages = [];
    localStorage.removeItem(STORAGE_KEY);
    fetch('/api/chat/session', { method: 'DELETE' }).catch(() => {});
    refreshCliUi();
  }

  function compactMessages() {
    const KEEP = 6; // last 3 exchanges
    if (messages.length > KEEP) {
      messages = messages.slice(-KEEP);
      saveMessages();
    }
    renderMessages();
  }

  // ── Markdown renderer ──────────────────────────────────────────────────────
  // Safe, self-contained — no external deps.

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderInline(text) {
    let s = escHtml(text);

    // Extract inline code first so we don't format inside it
    const spans = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      const i = spans.length;
      spans.push(`<code class="cp-ic">${code}</code>`); // already escaped via escHtml
      return `\x00S${i}\x00`;
    });

    // Bold **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic *text* (not **)
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Strikethrough ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Links [text](url) — only http/https
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, linkText, url) => {
      const safeUrl = url.replace(/"/g, '%22');
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    });

    // Restore inline code spans
    s = s.replace(/\x00S(\d+)\x00/g, (_, i) => spans[parseInt(i)]);
    return s;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const parts = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // ── Fenced code block ──────────────────────────────────────────────────
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        const langAttr = lang ? ` data-lang="${escHtml(lang)}"` : '';
        parts.push(`<pre class="cp-pre"${langAttr}><code class="cp-code">${escHtml(codeLines.join('\n'))}</code></pre>`);
        i++; // skip closing ```
        continue;
      }

      // ── Heading ────────────────────────────────────────────────────────────
      const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) {
        // Use h4/h5/h6 to avoid conflicting with MkDocs page headings
        const level = hMatch[1].length + 3;
        parts.push(`<h${level} class="cp-h">${renderInline(hMatch[2])}</h${level}>`);
        i++;
        continue;
      }

      // ── Horizontal rule ────────────────────────────────────────────────────
      if (/^[-*_]{3,}$/.test(line.trim())) {
        parts.push('<hr class="cp-hr">');
        i++;
        continue;
      }

      // ── List items — collect a run into one list ───────────────────────────
      const isUl = /^[\-\*\+]\s/.test(line);
      const isOl = /^\d+\.\s/.test(line);
      if (isUl || isOl) {
        const tag = isOl ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length && (/^[\-\*\+]\s/.test(lines[i]) || /^\d+\.\s/.test(lines[i]))) {
          const itemText = lines[i].replace(/^[\-\*\+]\s|^\d+\.\s/, '');
          items.push(`<li>${renderInline(itemText)}</li>`);
          i++;
        }
        parts.push(`<${tag} class="cp-list">${items.join('')}</${tag}>`);
        continue;
      }

      // ── Table — collect consecutive pipe rows ─────────────────────────────
      if (/^\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          rows.push(lines[i]);
          i++;
        }
        // Second row is the separator (---|---); if present, first row = header
        const isSep = (r) => /^[\|\s\-:]+$/.test(r);
        const parseRow = (r) =>
          r.replace(/^\||\|$/g, '').split('|').map(c => renderInline(c.trim()));

        let html = '<table class="cp-table"><tbody>';
        let bodyStart = 0;
        if (rows.length >= 2 && isSep(rows[1])) {
          const heads = parseRow(rows[0]);
          html = '<table class="cp-table"><thead><tr>'
            + heads.map(h => `<th>${h}</th>`).join('')
            + '</tr></thead><tbody>';
          bodyStart = 2;
        }
        for (let r = bodyStart; r < rows.length; r++) {
          if (isSep(rows[r])) continue;
          html += '<tr>' + parseRow(rows[r]).map(c => `<td>${c}</td>`).join('') + '</tr>';
        }
        html += '</tbody></table>';
        parts.push(html);
        continue;
      }

      // ── Blank line ─────────────────────────────────────────────────────────
      if (line.trim() === '') {
        parts.push('<div class="cp-gap"></div>');
        i++;
        continue;
      }

      // ── Paragraph ─────────────────────────────────────────────────────────
      parts.push(`<p class="cp-p">${renderInline(line)}</p>`);
      i++;
    }

    return parts.join('');
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  let toggleBtn, panel, messagesEl, textarea, sendBtn;
  let cliSelect = null, modelSelect = null, cliLabelEl = null;
  let editorMode = false;   // true when the markdown editor is open

  function createUI() {
    const wrapper = document.createElement('div');
    wrapper.id = 'claude-docs-chat';
    wrapper.innerHTML = `
      <button id="claude-docs-present" class="cp-pb-hidden" title="Present this page">▶</button>
      <button id="claude-docs-edit" class="cp-pb-hidden" title="Edit this page">✎</button>
      <button id="claude-docs-toggle" title="Ask about this page">✦</button>
      <div id="claude-docs-panel" class="cp-hidden">
        <div class="cp-header">
          <span class="cp-header-title">
            <span class="cp-header-dot"></span>
            <span class="cp-header-name">Docs Chat</span>
            <span class="cp-cli-chip"></span>
          </span>
          <div class="cp-header-actions">
            <div class="cp-select-wrap">
              <select class="cp-select cp-cli-select">
                ${Object.entries(FALLBACK_META.adapters).map(([name, info]) => `<option value="${name}">${info.label}</option>`).join('')}
              </select>
            </div>
            <div class="cp-select-wrap">
              <select class="cp-select cp-model-select">
                ${FALLBACK_META.adapters[DEFAULT_CLI].models.map(m => `<option value="${m.value == null ? '' : m.value}">${m.label}</option>`).join('')}
              </select>
            </div>
            <button class="cp-btn-compact" title="Compact conversation">Compact</button>
            <button class="cp-btn-clear" title="Clear chat history and start a new backend session">New session</button>
            <button class="cp-btn-close" title="Close">✕</button>
          </div>
        </div>
        <div class="cp-messages"></div>
        <div class="cp-footer">
          <div class="cp-input-row">
            <textarea class="cp-textarea" rows="1" placeholder="Ask about this page…"></textarea>
            <button class="cp-send cp-send-idle">↑</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    toggleBtn  = document.getElementById('claude-docs-toggle');
    panel      = document.getElementById('claude-docs-panel');
    messagesEl = panel.querySelector('.cp-messages');
    textarea   = panel.querySelector('.cp-textarea');
    sendBtn    = panel.querySelector('.cp-send');
    cliSelect  = panel.querySelector('.cp-cli-select');
    modelSelect = panel.querySelector('.cp-model-select');
    cliLabelEl  = panel.querySelector('.cp-cli-chip');

    toggleBtn.addEventListener('click', togglePanel);
    panel.querySelector('.cp-btn-close').addEventListener('click', () => setOpen(false));

    const clearBtn   = panel.querySelector('.cp-btn-clear');
    const compactBtn = panel.querySelector('.cp-btn-compact');

    clearBtn.addEventListener('click', () =>
      withConfirm(clearBtn, 'New session', () => { clearMessages(); renderMessages(); })
    );
    compactBtn.addEventListener('click', () =>
      withConfirm(compactBtn, 'Compact', () => { compactMessages(); })
    );
    sendBtn.addEventListener('click', handleSend);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });

    cliSelect.addEventListener('change', () => setCli(cliSelect.value));
    modelSelect.addEventListener('change', () => {
      currentModel = modelSelect.value === '' ? null : modelSelect.value;
      saveModelPreference(currentCli, currentModel);
    });

  }

  // Floating edit button — wired after createUI so the element exists

  function togglePanel() { setOpen(!isOpen); }

  function setOpen(val) {
    isOpen = val;
    try { localStorage.setItem(OPEN_KEY, isOpen ? '1' : '0'); } catch { /* ignore */ }
    if (isOpen) {
      panel.classList.remove('cp-hidden');
      textarea.focus();
      scrollToBottom();
    } else {
      panel.classList.add('cp-hidden');
    }
  }

  function scrollToBottom() {
    setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderMessages() {
    if (messages.length === 0) {
      messagesEl.innerHTML = `
        <div class="cp-empty">
          <div class="cp-empty-icon">✦</div>
          <div class="cp-empty-title">Ask about this page</div>
          <div class="cp-empty-sub">Explain concepts, edit sections, or add new content — the docs assistant can read and edit this site.</div>
        </div>`;
      return;
    }

    messagesEl.innerHTML = '';
    for (const msg of messages) {
      messagesEl.appendChild(renderMessage(msg));
    }
    scrollToBottom();
  }

  function renderMessage(msg) {
    const el = document.createElement('div');
    el.className = `cp-msg cp-msg-${msg.role}`;
    el.dataset.msgId = msg.id;

    const bubble = document.createElement('div');
    bubble.className = 'cp-bubble' + (msg.isError ? ' cp-error' : '');

    if (msg.role === 'assistant') {
      bubble.innerHTML = renderMarkdown(msg.content || '');
    } else {
      bubble.textContent = msg.content || '';
    }

    if (msg.isStreaming) {
      const cursor = document.createElement('span');
      cursor.className = 'cp-cursor';
      bubble.appendChild(cursor);
    }

    el.appendChild(bubble);

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        el.appendChild(makeToolBadge(tc));
      }
    }

    return el;
  }

  function makeToolBadge(tc) {
    const badge = document.createElement('div');
    badge.className = 'cp-tool';
    badge.textContent = formatToolCall(tc);
    return badge;
  }

  function formatToolCall(tc) {
    if (tc.name === 'Read')  return `📖 Read ${tc.input.file_path || ''}`.slice(0, 60);
    if (tc.name === 'Edit')  return `✎ Edit ${tc.input.file_path || ''}`.slice(0, 60);
    if (tc.name === 'Write') return `✎ Write ${tc.input.file_path || ''}`.slice(0, 60);
    if (tc.name === 'Bash')  return `$ ${tc.input.command || ''}`.slice(0, 60);
    return `⚙ ${tc.name}`.slice(0, 60);
  }

  function updateStreamingMessage(id, content, toolCalls) {
    const msg = messages.find(m => m.id === id);
    if (!msg) return;
    msg.content = content;
    if (toolCalls) msg.toolCalls = toolCalls;

    const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (!el) return;

    const bubble = el.querySelector('.cp-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(content);
      if (msg.isStreaming) {
        const cursor = document.createElement('span');
        cursor.className = 'cp-cursor';
        bubble.appendChild(cursor);
      }
    }

    // Rebuild tool badges
    el.querySelectorAll('.cp-tool').forEach(e => e.remove());
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) { el.appendChild(makeToolBadge(tc)); }
    }

    scrollToBottom();
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  function handleSend() {
    if (isSending) { stopSending(); return; }

    const text = textarea.value.trim();
    if (!text) return;

    textarea.value = '';
    textarea.style.height = 'auto';
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }

    const userMsg      = { id: uid(), role: 'user',      content: text };
    const assistantMsg = { id: uid(), role: 'assistant', content: '', isStreaming: true, toolCalls: [] };

    messages.push(userMsg, assistantMsg);
    currentAssistantId = assistantMsg.id;
    renderMessages();
    setSending(true);

    const ac = new AbortController();
    abortController = ac;

    let accText = '';
    const toolCalls = [];

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, page_url: window.location.pathname, model: currentModel, cli: currentCli }),
      signal: ac.signal,
    }).then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (event === 'chunk') {
                // Text delta — only content_block_delta, never assistant chunk (avoids duplication)
                if (data.type === 'stream_event' &&
                    data.event?.type === 'content_block_delta' &&
                    data.event?.delta?.type === 'text_delta') {
                  accText += data.event.delta.text;
                  updateStreamingMessage(currentAssistantId, accText, toolCalls);
                }
                // Tool calls from the assistant content block
                if (data.type === 'assistant' && Array.isArray(data.message?.content)) {
                  for (const block of data.message.content) {
                    if (block.type === 'tool_use') {
                      if (!toolCalls.find(t => t.id === block.id)) {
                        toolCalls.push({ id: block.id, name: block.name, input: block.input || {} });
                      }
                    }
                  }
                  updateStreamingMessage(currentAssistantId, accText, toolCalls);
                }
              } else if (event === 'done') {
                finishMessage(currentAssistantId, accText, toolCalls);
              } else if (event === 'error') {
                errorMessage(currentAssistantId, data.message || 'Unknown error');
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
      // Stream closed without a terminal event (e.g. connection reset)
      if (isSending) finishMessage(currentAssistantId, accText, toolCalls);

    }).catch((err) => {
      // Treat as a clean finish if:
      //   (a) user clicked Stop (AbortError from our AbortController)
      //   (b) page is unloading — MkDocs live-reload or navigation tears down the
      //       fetch as a TypeError ("Failed to fetch" / "Load failed" / "NetworkError")
      //       before or after pagehide fires; isUnloading covers both orderings
      const isCleanAbort = err.name === 'AbortError' ||
        isUnloading ||
        (err instanceof TypeError && /fetch|network|load failed/i.test(err.message));
      if (isCleanAbort) {
        finishMessage(currentAssistantId, accText, toolCalls);
      } else {
        errorMessage(currentAssistantId, String(err));
      }
    });
  }

  function finishMessage(id, content, toolCalls) {
    const msg = messages.find(m => m.id === id);
    if (msg) { msg.content = content; msg.isStreaming = false; msg.toolCalls = toolCalls; }
    setSending(false);
    saveMessages();
    renderMessages();
  }

  function errorMessage(id, text) {
    const msg = messages.find(m => m.id === id);
    if (msg) { msg.content = text; msg.isStreaming = false; msg.isError = true; }
    setSending(false);
    saveMessages();
    renderMessages();
  }

  function stopSending() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    // finishMessage will be called by the AbortError catch path
  }

  function setSending(val) {
    isSending = val;
    if (val) {
      sendBtn.textContent = '■';
      sendBtn.className = 'cp-send cp-send-stop';
      textarea.disabled = true;
    } else {
      sendBtn.textContent = '↑';
      sendBtn.className = 'cp-send cp-send-idle';
      textarea.disabled = false;
      textarea.focus();
    }
    refreshCliUi();
  }

  // ── Unload cleanup — fix stuck isStreaming on navigate/close ───────────────
  // `pagehide` fires reliably on all navigation and tab-close scenarios;
  // `beforeunload` is more widely fired but pagehide covers bfcache too.
  window.addEventListener('pagehide', () => {
    isUnloading = true;
    if (isSending && currentAssistantId) {
      const msg = messages.find(m => m.id === currentAssistantId);
      if (msg) { msg.isStreaming = false; }
      saveMessages();
    }
  });

  // ── Utils ──────────────────────────────────────────────────────────────────

  let _uidCounter = 0;
  function uid() { return `${Date.now()}-${++_uidCounter}`; }

  // ── Inline confirmation helper ─────────────────────────────────────────────
  // Turns any button into a two-click confirm: first click → "Sure?", second → action.
  // Auto-reverts after 3 s if unused.

  const _confirmTimers = new WeakMap();

  function withConfirm(btn, label, action) {
    if (btn.dataset.confirming === '1') {
      _clearConfirm(btn, label);
      action();
      return;
    }
    btn.dataset.confirming = '1';
    btn.textContent = 'Sure?';
    btn.classList.add('cp-btn-confirming');
    const t = setTimeout(() => _clearConfirm(btn, label), 3000);
    _confirmTimers.set(btn, t);
  }

  function _clearConfirm(btn, label) {
    btn.dataset.confirming = '';
    btn.textContent = label;
    btn.classList.remove('cp-btn-confirming');
    const t = _confirmTimers.get(btn);
    if (t !== undefined) { clearTimeout(t); _confirmTimers.delete(btn); }
  }

  // ── Presenter mode ─────────────────────────────────────────────────────────

  let presenterEl = null;
  let presenterSlides = [];
  let presenterIdx = 0;
  let presenterFullscreen = false;
  let presentBtn = null;

  // Split a container's children at every <hr> element.
  function splitByHr(container) {
    const slides = [];
    let cur = document.createElement('div');
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeName === 'HR') {
        if (cur.hasChildNodes()) { slides.push(cur); cur = document.createElement('div'); }
      } else {
        cur.appendChild(child.cloneNode(true));
      }
    }
    if (cur.hasChildNodes()) slides.push(cur);
    return slides;
  }

  // Split at every <h2> boundary (h2 stays on its new slide).
  function splitByH2(container) {
    const slides = [];
    let cur = document.createElement('div');
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeName === 'H2' && cur.hasChildNodes()) {
        slides.push(cur); cur = document.createElement('div');
      }
      cur.appendChild(child.cloneNode(true));
    }
    if (cur.hasChildNodes()) slides.push(cur);
    return slides;
  }

  function buildSlides() {
    // MkDocs Material: article content lives in .md-content__inner > .md-typeset
    const content = document.querySelector('.md-content__inner') ||
                    document.querySelector('article') ||
                    document.querySelector('main');
    if (!content) return [];

    const clone = content.cloneNode(true);
    // Strip MkDocs chrome that doesn't belong on slides
    ['.md-content__button', '.md-source-file', '.md-feedback',
     '.md-tags', '[data-md-component="toc"]', 'nav'].forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    const hasHr = !!clone.querySelector('hr');
    const slides = hasHr ? splitByHr(clone) : splitByH2(clone);
    // Filter empty slides
    return slides.filter(s => s.textContent.trim().length > 0);
  }

  function hasSlidableContent() {
    const content = document.querySelector('.md-content__inner') || document.querySelector('article');
    if (!content) return false;
    if (content.querySelector('hr')) return true;
    return content.querySelectorAll('h2').length >= 2;
  }

  function openPresenter() {
    presenterSlides = buildSlides();
    if (!presenterSlides.length) return;
    presenterIdx = 0;

    presenterEl = document.createElement('div');
    presenterEl.id = 'cp-presenter';
    presenterEl.innerHTML = `
      <div class="cp-sl-wrap">
        <div class="cp-sl-content md-typeset"></div>
      </div>
      <div class="cp-sl-bar">
        <button class="cp-sl-prev" title="Previous (←)">←</button>
        <span class="cp-sl-counter"></span>
        <button class="cp-sl-next" title="Next (→)">→</button>
        <span class="cp-sl-sep"></span>
        <button class="cp-sl-fs" title="Fullscreen (F)">⛶</button>
      </div>
      <button class="cp-sl-exit" title="Exit (Esc)">✕ ESC</button>
    `;
    document.body.appendChild(presenterEl);

    presenterEl.querySelector('.cp-sl-prev').addEventListener('click', () => goSlide(-1));
    presenterEl.querySelector('.cp-sl-next').addEventListener('click', () => goSlide(+1));
    presenterEl.querySelector('.cp-sl-exit').addEventListener('click', closePresenter);
    presenterEl.querySelector('.cp-sl-fs').addEventListener('click', togglePresenterFullscreen);
    // Click on dark backdrop to exit
    presenterEl.querySelector('.cp-sl-wrap').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closePresenter();
    });
    // capture:true so we run before MkDocs keyboard handlers
    document.addEventListener('keydown', presenterKeydown, { capture: true });
    document.addEventListener('fullscreenchange', onPresenterFullscreenChange);

    showSlide(0);
  }

  function togglePresenterFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      presenterEl.requestFullscreen().catch(() => {});
    }
  }

  function onPresenterFullscreenChange() {
    presenterFullscreen = !!document.fullscreenElement;
    const btn = presenterEl?.querySelector('.cp-sl-fs');
    if (!btn) return;
    btn.textContent = presenterFullscreen ? '⤡' : '⛶';
    btn.title = presenterFullscreen ? 'Exit fullscreen' : 'Fullscreen (F)';
  }

  function showSlide(idx) {
    presenterIdx = Math.max(0, Math.min(idx, presenterSlides.length - 1));
    const content = presenterEl.querySelector('.cp-sl-content');

    // Fade out ALL existing layers (handles rapid navigation without accumulation)
    content.querySelectorAll('.cp-sl-layer').forEach(layer => {
      layer.style.transition = 'opacity 0.22s ease';
      layer.style.opacity = '0';
      setTimeout(() => layer.remove(), 240);
    });

    // Incoming layer: new slide fades in beneath
    const newLayer = document.createElement('div');
    newLayer.className = 'cp-sl-layer md-typeset';
    newLayer.style.opacity = '0';
    newLayer.appendChild(presenterSlides[presenterIdx].cloneNode(true));
    // Re-trigger MkDocs code block copy buttons if present
    newLayer.querySelectorAll('pre > code').forEach(el => el.parentElement.removeAttribute('data-copied'));
    content.appendChild(newLayer);

    presenterEl.querySelector('.cp-sl-counter').textContent =
      `${presenterIdx + 1} / ${presenterSlides.length}`;
    presenterEl.querySelector('.cp-sl-prev').disabled = presenterIdx === 0;
    presenterEl.querySelector('.cp-sl-next').disabled = presenterIdx === presenterSlides.length - 1;

    // Fade in new layer
    requestAnimationFrame(() => {
      newLayer.style.transition = 'opacity 0.22s ease';
      newLayer.style.opacity = '1';
    });
  }

  function goSlide(delta) {
    const next = presenterIdx + delta;
    if (next < 0 || next >= presenterSlides.length) return;
    showSlide(next);
  }

  function closePresenter() {
    document.removeEventListener('keydown', presenterKeydown, { capture: true });
    document.removeEventListener('fullscreenchange', onPresenterFullscreenChange);
    if (document.fullscreenElement) document.exitFullscreen();
    presenterEl?.remove();
    presenterEl = null;
    presenterSlides = [];
    presenterFullscreen = false;
  }

  function presenterKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      // If browser is in fullscreen, Esc exits fullscreen only — keep presenter open
      if (presenterFullscreen) return;
      closePresenter();
      return;
    }
    if (e.key === 'f' || e.key === 'F')                  { togglePresenterFullscreen(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.stopPropagation(); goSlide(+1); return; }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.stopPropagation(); goSlide(-1); return; }
  }

  // ── Markdown editor (fullscreen overlay) ──────────────────────────────────

  let editorEl = null;

  function openEditor() {
    if (editorEl) return;
    editorMode = true;
    document.getElementById('claude-docs-edit').classList.add('cp-edit-active');

    editorEl = document.createElement('div');
    editorEl.id = 'cp-editor';
    editorEl.innerHTML = `
      <div class="cp-ed-bar">
        <span class="cp-ed-path">Loading…</span>
        <div class="cp-ed-actions">
          <button class="cp-ed-save">Save</button>
          <button class="cp-ed-exit" title="Close (Esc)">✕ ESC</button>
        </div>
      </div>
      <textarea class="cp-ed-textarea" spellcheck="false"></textarea>
    `;
    document.body.appendChild(editorEl);

    const ta      = editorEl.querySelector('.cp-ed-textarea');
    const pathEl  = editorEl.querySelector('.cp-ed-path');
    const saveBtn = editorEl.querySelector('.cp-ed-save');

    editorEl.querySelector('.cp-ed-exit').addEventListener('click', closeEditor);
    saveBtn.addEventListener('click', saveEditor);
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveEditor(); }
      if (e.key === 'Escape') closeEditor();
    });
    document.addEventListener('keydown', editorKeydown);

    fetch(`/api/file?page=${encodeURIComponent(window.location.pathname)}`)
      .then(r => r.json())
      .then(({ content, filePath, error }) => {
        if (!editorEl) return; // closed before response
        if (error) {
          pathEl.textContent = filePath ?? 'unknown';
          ta.placeholder = `Could not load: ${error}`;
        } else {
          pathEl.textContent = filePath ?? '';
          ta.value = content;
          ta.scrollTop = 0;
          ta.setSelectionRange(0, 0);
          ta.focus();
        }
      })
      .catch(err => {
        if (editorEl) editorEl.querySelector('.cp-ed-path').textContent = `Error: ${err.message}`;
      });
  }

  function closeEditor() {
    editorMode = false;
    document.removeEventListener('keydown', editorKeydown);
    document.getElementById('claude-docs-edit').classList.remove('cp-edit-active');
    editorEl?.remove();
    editorEl = null;
  }

  function saveEditor() {
    if (!editorEl) return;
    const ta      = editorEl.querySelector('.cp-ed-textarea');
    const saveBtn = editorEl.querySelector('.cp-ed-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    fetch(`/api/file?page=${encodeURIComponent(window.location.pathname)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ta.value }),
    })
      .then(r => r.json())
      .then(({ ok, error }) => {
        if (!editorEl) return;
        if (ok) {
          saveBtn.textContent = 'Saved ✓';
          setTimeout(() => { if (editorEl) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; } }, 1800);
        } else {
          saveBtn.textContent = 'Save';
          saveBtn.disabled = false;
          editorEl.querySelector('.cp-ed-path').textContent += '  ⚠ ' + (error ?? 'Save failed');
        }
      })
      .catch(err => {
        if (!editorEl) return;
        editorEl.querySelector('.cp-ed-save').textContent = 'Save';
        editorEl.querySelector('.cp-ed-save').disabled = false;
        editorEl.querySelector('.cp-ed-path').textContent += '  ⚠ ' + err.message;
      });
  }

  function editorKeydown(e) {
    if (e.key === 'Escape') closeEditor();
  }

  // ── Reconnect after live-reload ────────────────────────────────────────────
  // If the page reloaded while Claude was mid-task (e.g. MkDocs live-reload
  // triggered by an agent edit), the server kept Claude running. We check
  // /api/chat/status and, if active, reattach to /api/chat/reconnect to resume
  // the last assistant message in-place.

  function reconnectIfActive() {
    fetch('/api/chat/status')
      .then(r => r.json())
      .then(({ active, cli }) => {
        if (cli) setCli(cli, { force: true, persist: false, persistModel: false });
        if (!active) return;
        // Find the last assistant message to resume into
        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        if (!lastMsg || lastMsg.role !== 'assistant') return;

        // Re-mark it as streaming and re-render
        lastMsg.isStreaming = true;
        renderMessages();
        setSending(true);
        currentAssistantId = lastMsg.id;

        // Rebuild accText from scratch — the replay sends ALL deltas from the start,
        // so seeding from saved partial content would cause duplication.
        let accText = '';
        const toolCalls = [];

        const ac = new AbortController();
        abortController = ac;

        fetch('/api/chat/reconnect', { signal: ac.signal })
          .then(async (res) => {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let event = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  event = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (event === 'chunk') {
                      if (data.type === 'stream_event' &&
                          data.event?.type === 'content_block_delta' &&
                          data.event?.delta?.type === 'text_delta') {
                        accText += data.event.delta.text;
                        updateStreamingMessage(currentAssistantId, accText, toolCalls);
                      }
                      if (data.type === 'assistant' && Array.isArray(data.message?.content)) {
                        for (const block of data.message.content) {
                          if (block.type === 'tool_use' && !toolCalls.find(t => t.id === block.id)) {
                            toolCalls.push({ id: block.id, name: block.name, input: block.input || {} });
                          }
                        }
                        updateStreamingMessage(currentAssistantId, accText, toolCalls);
                      }
                    } else if (event === 'done') {
                      finishMessage(currentAssistantId, accText, toolCalls);
                    } else if (event === 'error') {
                      errorMessage(currentAssistantId, data.message || 'Unknown error');
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
            }
            if (isSending) finishMessage(currentAssistantId, accText, toolCalls);
          })
          .catch((err) => {
            const isCleanAbort = err.name === 'AbortError' || isUnloading ||
              (err instanceof TypeError && /fetch|network|load failed/i.test(err.message));
            if (isCleanAbort) {
              finishMessage(currentAssistantId, accText, toolCalls);
            } else {
              errorMessage(currentAssistantId, String(err));
            }
          });
      })
      .catch(() => { /* status check failed — ignore */ });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    if (document.getElementById('claude-docs-chat')) return;
    loadMessages();
    createUI();
    hydratePreferences();
    refreshCliUi();
    loadChatMeta();
    renderMessages();
    // Restore open state from previous page
    try {
      if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true);
    } catch { /* ignore */ }

    // Reconnect to any job still running after a live-reload
    reconnectIfActive();

    // Draft persistence — restore saved input, save on every keystroke
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        textarea.value = draft;
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      }
    } catch { /* ignore */ }
    textarea.addEventListener('input', () => {
      try {
        if (textarea.value) {
          localStorage.setItem(DRAFT_KEY, textarea.value);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch { /* ignore */ }
    }, { passive: true });

    presentBtn = document.getElementById('claude-docs-present');
    if (hasSlidableContent()) {
      presentBtn.classList.remove('cp-pb-hidden');
    }
    presentBtn.addEventListener('click', openPresenter);

    // Floating edit button — always visible (every page has a source file)
    const editBtn = document.getElementById('claude-docs-edit');
    editBtn.classList.remove('cp-pb-hidden');
    editBtn.addEventListener('click', () => { if (editorMode) closeEditor(); else openEditor(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
