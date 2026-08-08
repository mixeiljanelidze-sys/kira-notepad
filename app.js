import { notepadService } from './notepadService.js';
import { ntfyService } from './ntfyService.js';
import { configService } from './configService.js';
import { webhookService } from './webhookService.js';

let activeNoteId = null;
let pollTimer = null;
let saveDebounce = null;

const $ = (id) => document.getElementById(id);

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(id).classList.add('active');
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── NOTES LIST ────────────────────────────────────────────────
async function renderList(filter = '') {
  const data = await notepadService.loadNotes();
  const q = filter.trim().toLowerCase();
  const notes = q ? data.notes.filter((n) => (n.title + n.body).toLowerCase().includes(q)) : data.notes;

  $('notes-list').innerHTML = notes.map((n) => `
    <div class="note-card" data-id="${n.id}">
      <div class="title">${escapeHtml(n.title || 'Untitled')}</div>
      <div class="preview">${escapeHtml((n.body || '').slice(0, 100))}</div>
      <div class="meta">${new Date(n.updatedAt).toLocaleString('en-GB', { hour12: false })}</div>
    </div>
  `).join('') || '<div class="meta">No notes yet.</div>';

  document.querySelectorAll('.note-card').forEach((el) => {
    el.addEventListener('click', () => openEditor(el.dataset.id));
  });
}

// ── EDITOR ────────────────────────────────────────────────────
async function openEditor(id) {
  const note = await notepadService.getNote(id);
  if (!note) return;
  activeNoteId = id;
  $('editor-title').value = note.title || '';
  $('editor-body').value = note.body || '';
  renderAttachStrip(note.attachments || []);
  showView('view-editor');
}

async function saveActiveNote() {
  if (!activeNoteId) return;
  await notepadService.updateNote(activeNoteId, {
    title: $('editor-title').value,
    body: $('editor-body').value,
  });
}

function scheduleAutosave() {
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(saveActiveNote, 500);
}

function renderAttachStrip(attachments) {
  $('attach-strip').innerHTML = attachments.map((a, i) => {
    if (a.kind === 'image') {
      return `<div class="attach-chip" data-idx="${i}">
        <img src="data:${a.mime};base64,${a.image_base64}">
        <div class="remove-x" data-idx="${i}">✕</div>
      </div>`;
    }
    return `<div class="attach-chip" data-idx="${i}">
      <div class="vid-icon">🎬</div>
      <div class="remove-x" data-idx="${i}">✕</div>
    </div>`;
  }).join('');

  document.querySelectorAll('#attach-strip .remove-x').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await notepadService.removeAttachment(activeNoteId, Number(btn.dataset.idx));
      const note = await notepadService.getNote(activeNoteId);
      renderAttachStrip(note.attachments || []);
    });
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function handleAttachFile(file, kind) {
  if (!file || !activeNoteId) return;
  const base64 = await fileToBase64(file);
  const attachment = {
    kind,
    name: file.name,
    mime: file.type || (kind === 'image' ? 'image/png' : 'video/mp4'),
    [kind === 'image' ? 'image_base64' : 'video_base64']: base64,
  };
  const note = await notepadService.addAttachment(activeNoteId, attachment);
  renderAttachStrip(note.attachments || []);
}

// ── NTFY HOOK RECEIVER ───────────────────────────────────────
async function refreshHookUrl() {
  const { webhookUrl } = await ntfyService.getWebhookUrl();
  $('hook-url').value = webhookUrl;
}

function setHookStatus(text) { $('hook-status').textContent = text; }

async function pollLoop() {
  const r = await ntfyService.poll();
  if (r.messages && r.messages.length) {
    const mode = $('hook-mode').value;
    for (const msg of r.messages) {
      await notepadService.ingestHookMessage(msg, { mode, ntfyService });
    }
    if ($('view-list').classList.contains('active')) renderList($('search').value);
  }
  setHookStatus('listening · ' + new Date().toLocaleTimeString('en-GB', { hour12: false }));
  pollTimer = setTimeout(pollLoop, 5000);
}

function startPolling() {
  if (pollTimer) return;
  setHookStatus('listening');
  pollLoop();
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  setHookStatus('idle');
}

// ── WEBHOOK CONFIG ───────────────────────────────────────────
async function renderWebhookConfig() {
  const cfg = await configService.loadConfig();
  $('webhook-list').innerHTML = cfg.webhooks.map((w) => `
    <div class="wh-item" data-id="${w.id}">
      <div>
        <div class="wh-label">${escapeHtml(w.label)}</div>
        <div class="wh-url">${escapeHtml(w.url)}</div>
      </div>
      <button class="wh-remove" data-id="${w.id}">✕</button>
    </div>
  `).join('') || '<div class="meta">No webhooks configured.</div>';

  document.querySelectorAll('.wh-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await configService.removeWebhook(btn.dataset.id);
      renderWebhookConfig();
    });
  });

  $('sb-url').value = cfg.supabase.url;
  $('sb-key').value = cfg.supabase.key;
  $('sb-bucket').value = cfg.supabase.bucket;
}

async function saveSupabaseConfig() {
  const cfg = await configService.loadConfig();
  cfg.supabase = {
    url: $('sb-url').value.trim(),
    key: $('sb-key').value.trim(),
    bucket: $('sb-bucket').value.trim(),
  };
  await configService.saveConfig(cfg);
}

// ── SEND TO WEBHOOK ──────────────────────────────────────────
async function openSendModal() {
  $('send-result').textContent = '';
  $('send-payload-pre').style.display = 'none';
  $('send-toggle-preview').textContent = '👁 SHOW PAYLOAD';
  const cfg = await configService.loadConfig();
  if (cfg.webhooks.length === 0) {
    $('send-target-list').innerHTML = '<div class="meta">No webhooks configured. Open ⚙ config first.</div>';
  } else {
    $('send-target-list').innerHTML = cfg.webhooks.map((w) => `
      <div class="send-item" data-url="${escapeHtml(w.url)}">
        <input type="checkbox" data-url="${escapeHtml(w.url)}">
        <div>
          <div class="wh-label">${escapeHtml(w.label)}</div>
          <div class="wh-url">${escapeHtml(w.url)}</div>
        </div>
      </div>
    `).join('');
  }
  const note = await notepadService.getNote(activeNoteId);
  $('send-payload-pre').textContent = JSON.stringify(webhookService.previewPayload(note, cfg.supabase), null, 2);
  openModal('modal-send');
}

async function executeSend() {
  const checked = Array.from(document.querySelectorAll('#send-target-list input[type=checkbox]:checked')).map((c) => c.dataset.url);
  if (checked.length === 0) { $('send-result').textContent = 'Select at least one destination.'; return; }
  await saveActiveNote();
  const note = await notepadService.getNote(activeNoteId);
  const cfg = await configService.loadConfig();
  $('send-result').textContent = 'Sending...';
  try {
    const { results, log, payload } = await webhookService.sendToWebhooks(note, checked, cfg.supabase);
    const lines = [
      ...log,
      ...results.map((r) => `${r.ok ? '✓' : '✗'} ${r.url} ${r.status || r.error || ''}`),
    ];
    $('send-result').textContent = lines.join('\n');
    $('send-payload-pre').textContent = JSON.stringify(payload, null, 2);
  } catch (e) {
    $('send-result').textContent = 'Send failed: ' + e.message;
  }
}

// ── EVENT BINDING ────────────────────────────────────────────
function bindEvents() {
  $('btn-new').addEventListener('click', async () => {
    const note = await notepadService.createNote();
    activeNoteId = note.id;
    $('editor-title').value = '';
    $('editor-body').value = '';
    renderAttachStrip([]);
    showView('view-editor');
  });

  $('btn-back').addEventListener('click', async () => {
    await saveActiveNote();
    activeNoteId = null;
    showView('view-list');
    renderList($('search').value);
  });

  $('editor-title').addEventListener('input', scheduleAutosave);
  $('editor-body').addEventListener('input', scheduleAutosave);
  $('editor-title').addEventListener('blur', saveActiveNote);
  $('editor-body').addEventListener('blur', saveActiveNote);

  $('btn-delete-note').addEventListener('click', async () => {
    if (!activeNoteId) return;
    await notepadService.deleteNote(activeNoteId);
    activeNoteId = null;
    showView('view-list');
    renderList();
  });

  $('btn-attach-image').addEventListener('click', () => $('file-image').click());
  $('btn-attach-video').addEventListener('click', () => $('file-video').click());
  $('file-image').addEventListener('change', (e) => handleAttachFile(e.target.files[0], 'image'));
  $('file-video').addEventListener('change', (e) => handleAttachFile(e.target.files[0], 'video'));

  $('search').addEventListener('input', (e) => renderList(e.target.value));

  $('btn-hook').addEventListener('click', async () => {
    await refreshHookUrl();
    const cfg = await configService.loadConfig();
    $('hook-mode').value = cfg.hookAppendMode || 'new';
    $('hook-toggle').checked = !!pollTimer;
    openModal('modal-hook');
  });
  $('modal-hook-close').addEventListener('click', () => closeModal('modal-hook'));

  $('hook-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('hook-url').value);
  });

  $('hook-toggle').addEventListener('change', async (e) => {
    if (e.target.checked) startPolling(); else stopPolling();
    const cfg = await configService.loadConfig();
    cfg.hookPollingEnabled = e.target.checked;
    await configService.saveConfig(cfg);
  });

  $('hook-mode').addEventListener('change', async (e) => {
    const cfg = await configService.loadConfig();
    cfg.hookAppendMode = e.target.value;
    await configService.saveConfig(cfg);
  });

  $('hook-clear').addEventListener('click', async () => {
    await ntfyService.clear();
  });

  $('btn-config').addEventListener('click', async () => {
    await renderWebhookConfig();
    openModal('modal-config');
  });
  $('modal-config-close').addEventListener('click', () => closeModal('modal-config'));

  $('wh-add').addEventListener('click', async () => {
    const label = $('wh-label').value.trim();
    const url = $('wh-url').value.trim();
    if (!/^https?:\/\//.test(url)) return;
    await configService.addWebhook(label, url);
    $('wh-label').value = '';
    $('wh-url').value = '';
    renderWebhookConfig();
  });

  $('sb-save').addEventListener('click', saveSupabaseConfig);

  $('btn-send-webhook').addEventListener('click', openSendModal);
  $('modal-send-close').addEventListener('click', () => closeModal('modal-send'));
  $('send-execute').addEventListener('click', executeSend);
  $('send-toggle-preview').addEventListener('click', () => {
    const pre = $('send-payload-pre');
    const showing = pre.style.display !== 'none';
    pre.style.display = showing ? 'none' : 'block';
    $('send-toggle-preview').textContent = showing ? '👁 SHOW PAYLOAD' : '🙈 HIDE PAYLOAD';
  });
}

async function init() {
  bindEvents();
  await renderList();
  const cfg = await configService.loadConfig();
  if (cfg.hookPollingEnabled) startPolling();
}

document.addEventListener('DOMContentLoaded', init);
