import { storageService } from './storageService.js';

const NTFY_BASE = 'https://ntfy.sh';
const HOOK_FILE = 'kira-notepad-hook-id.json';

async function getHookId() {
  const d = await storageService.readJson(HOOK_FILE, null);
  if (d && d.hookId && /^kira-[a-f0-9]{32}$/.test(d.hookId)) return d.hookId;

  const id = 'kira-' + crypto.randomUUID().replace(/-/g, '');
  await storageService.writeJson(HOOK_FILE, { hookId: id, created: new Date().toISOString() });
  return id;
}

async function getWebhookUrl() {
  const hookId = await getHookId();
  return { hookId, webhookUrl: `${NTFY_BASE}/${hookId}` };
}

async function poll() {
  const hookId = await getHookId();
  const d = await storageService.readJson(HOOK_FILE, {});
  const sinceId = d.lastNtfyId || 'all';
  const processedSet = new Set(Array.isArray(d.processedIds) ? d.processedIds : []);

  try {
    const res = await fetch(`${NTFY_BASE}/${hookId}/json?poll=1&since=${sinceId}`, {
      headers: { 'user-agent': 'KIRA-Notepad-Mobile/1.0' },
    });
    const raw = await res.text();
    const lines = raw.split('\n').filter((l) => l.trim());
    const messages = [];
    let latestId = d.lastNtfyId || null;

    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.event && ev.event !== 'message') continue;
        if (!ev.id) continue;

        latestId = ev.id;

        // Skip if message was already processed
        if (processedSet.has(ev.id)) continue;
        processedSet.add(ev.id);

        const msg = {
          id: ev.id,
          received_at: ev.time ? new Date(ev.time * 1000).toISOString() : new Date().toISOString(),
          kind: 'ntfy',
          ntfy_title: ev.title || '',
          ntfy_tags: ev.tags || [],
          data: ev.message || '',
          files: [],
        };
        if (ev.attachment && ev.attachment.url) {
          msg.attachment_url = ev.attachment.url;
          msg.attachment_name = ev.attachment.name || 'file';
          msg.attachment_type = ev.attachment.type || 'application/octet-stream';
        }
        messages.push(msg);
      } catch (_) {}
    }

    d.lastNtfyId = latestId;
    d.processedIds = Array.from(processedSet).slice(-300);
    await storageService.writeJson(HOOK_FILE, d);

    return { messages, count: messages.length };
  } catch (e) {
    return { messages: [], count: 0, error: e.message };
  }
}

async function clear() {
  const hookId = await getHookId();
  try {
    const res = await fetch(`${NTFY_BASE}/${hookId}/json?poll=1&since=all`, {
      headers: { 'user-agent': 'KIRA-Notepad-Mobile/1.0' },
    });
    const raw = await res.text();
    const lines = raw.split('\n').filter((l) => l.trim());
    let latestId = null;
    const d = await storageService.readJson(HOOK_FILE, {});
    const processedSet = new Set(Array.isArray(d.processedIds) ? d.processedIds : []);

    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.id) {
          latestId = ev.id;
          processedSet.add(ev.id);
        }
      } catch (_) {}
    }

    if (latestId) d.lastNtfyId = latestId;
    d.processedIds = Array.from(processedSet).slice(-300);
    await storageService.writeJson(HOOK_FILE, d);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchAttachment(url) {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const b64 = arrayBufferToBase64(buf);
    return { ok: true, dataUrl: `data:${mime};base64,${b64}`, mime };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const ntfyService = { getHookId, getWebhookUrl, poll, clear, fetchAttachment };
