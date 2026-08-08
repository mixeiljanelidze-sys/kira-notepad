import { storageService } from './storageService.js';

const NOTES_FILE = 'kira-notes-data.json';

// Serializes every read-modify-write cycle so concurrent calls (autosave debounce
// firing while an attach is in flight) never clobber each other's changes.
let writeQueue = Promise.resolve();
function enqueue(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

async function loadNotes() {
  const d = await storageService.readJson(NOTES_FILE, { notes: [], links: [], images: {} });
  if (!Array.isArray(d.notes)) d.notes = [];
  return d;
}

async function saveNotes(data) {
  await storageService.writeJson(NOTES_FILE, data);
}

async function getNote(id) {
  const data = await loadNotes();
  return data.notes.find((n) => n.id === id) || null;
}

function createNote(title = '', body = '') {
  return enqueue(async () => {
    const data = await loadNotes();
    const note = { id: 'n' + Date.now(), title: title || 'Untitled', body, updatedAt: Date.now(), attachments: [] };
    data.notes.unshift(note);
    await saveNotes(data);
    return note;
  });
}

function updateNote(id, patch) {
  return enqueue(async () => {
    const data = await loadNotes();
    const note = data.notes.find((n) => n.id === id);
    if (!note) return null;
    Object.assign(note, patch, { updatedAt: Date.now() });
    await saveNotes(data);
    return note;
  });
}

function deleteNote(id) {
  return enqueue(async () => {
    const data = await loadNotes();
    data.notes = data.notes.filter((n) => n.id !== id);
    await saveNotes(data);
  });
}

// attachment: { kind: 'image'|'video', name, mime, image_base64 | video_base64 }
function addAttachment(noteId, attachment) {
  return enqueue(async () => {
    const data = await loadNotes();
    const note = data.notes.find((n) => n.id === noteId);
    if (!note) return null;
    if (!note.attachments) note.attachments = [];
    note.attachments.push(attachment);
    note.updatedAt = Date.now();
    await saveNotes(data);
    return note;
  });
}

function removeAttachment(noteId, index) {
  return enqueue(async () => {
    const data = await loadNotes();
    const note = data.notes.find((n) => n.id === noteId);
    if (!note || !note.attachments) return null;
    note.attachments.splice(index, 1);
    note.updatedAt = Date.now();
    await saveNotes(data);
    return note;
  });
}

function buildHookTitle(msg, parsedTitle) {
  const ts = msg.received_at
    ? new Date(msg.received_at).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';
  if (msg.ntfy_title && msg.ntfy_title.trim()) return 'Hook · ' + msg.ntfy_title.slice(0, 40);
  if (parsedTitle && String(parsedTitle).trim()) return 'Hook · ' + String(parsedTitle).slice(0, 40);
  const firstLine = (msg.data || '').split('\n')[0].trim();
  if (firstLine && firstLine.length <= 50 && !firstLine.startsWith('{')) return 'Hook · ' + firstLine;
  return 'Hook · ' + ts;
}

// Fetches a single image/video entry from string or object format into a note attachment
async function resolveIncomingAttachment(entry, defaultKind, ntfyService) {
  if (!entry) return null;

  let value = '';
  let mime = '';
  let name = '';
  let kind = defaultKind || 'image';

  if (typeof entry === 'string') {
    value = entry.trim();
  } else if (typeof entry === 'object' && entry !== null) {
    kind = entry.kind || defaultKind || 'image';
    mime = entry.mime || '';
    name = entry.name || '';
    value = entry.url || entry.data || entry.link || entry.src || entry.image_url || entry.video_url || entry.file || entry.image_base64 || entry.video_base64 || '';
  }

  if (!value) return null;

  mime = mime || (kind === 'video' ? 'video/mp4' : 'image/png');
  name = name || (kind === 'video' ? 'attachment.mp4' : 'attachment.png');

  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl) {
    const rawB64 = value.startsWith('data:') ? value.split(',')[1] : value;
    return { kind, name, mime, [kind === 'video' ? 'video_base64' : 'image_base64']: rawB64 };
  }

  // Value is an HTTP/HTTPS URL
  if (ntfyService) {
    const r = await ntfyService.fetchAttachment(value);
    if (r.ok && r.dataUrl) {
      const rawB64 = r.dataUrl.split(',')[1];
      return { kind, name, mime: r.mime || mime, url: value, [kind === 'video' ? 'video_base64' : 'image_base64']: rawB64 };
    }
  }

  // Fallback: If fetchAttachment fails (e.g. CORS), keep the URL so it can still be displayed!
  return { kind, name, mime, url: value, [kind === 'video' ? 'video_base64' : 'image_base64']: value };
}

// Parses an incoming ntfy message. Handles JSON bodies, plain text, ntfy attachment URLs, and .json file attachments
async function parseIncoming(msg, ntfyService) {
  let raw = msg.data || '';
  let content = raw;
  let parsedTitle = null;
  const attachments = [];

  // If ntfy converted the JSON payload into a file attachment (e.g. attachment.json)
  if (msg.attachment_url && ntfyService) {
    const isJsonFile = /\.(json)(\?|$)/i.test(msg.attachment_url) ||
      msg.attachment_type === 'application/json' ||
      /\.(json)$/i.test(msg.attachment_name || '') ||
      raw.includes('attachment.json');

    if (isJsonFile) {
      const r = await ntfyService.fetchAttachmentText(msg.attachment_url);
      if (r.ok && r.text) {
        raw = r.text;
      }
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      // Self-echo detection to prevent loops when outgoing webhooks hit the receiver
      if (parsed.source === 'KIRA Notepad Mobile') {
        return { isSelfEcho: true, content: '', parsedTitle: null, attachments: [] };
      }

      const textFields = ['content', 'text', 'body', 'message', 'caption', 'post', 'note', 'value', 'msg', 'description', 'details'];
      let extracted = null;
      for (const f of textFields) {
        if (parsed[f] && typeof parsed[f] === 'string' && parsed[f].trim()) {
          extracted = parsed[f];
          break;
        }
      }

      if (parsed.title || parsed.subject) parsedTitle = parsed.title || parsed.subject;
      content = extracted !== null ? extracted : (parsedTitle ? '' : JSON.stringify(parsed, null, 2));

      // 1. Collect images
      const imgSources = [
        ...(Array.isArray(parsed.images) ? parsed.images : []),
        ...(Array.isArray(parsed.image_urls) ? parsed.image_urls : []),
        parsed.image,
        parsed.image_url,
      ].filter(Boolean);

      for (const imgEntry of imgSources) {
        const a = await resolveIncomingAttachment(imgEntry, 'image', ntfyService);
        if (a) attachments.push(a);
      }

      // 2. Collect videos
      const vidSources = [
        ...(Array.isArray(parsed.videos) ? parsed.videos : []),
        ...(Array.isArray(parsed.video_urls) ? parsed.video_urls : []),
        parsed.video,
        parsed.video_url,
      ].filter(Boolean);

      for (const vidEntry of vidSources) {
        const a = await resolveIncomingAttachment(vidEntry, 'video', ntfyService);
        if (a) attachments.push(a);
      }

      // 3. Fallback generic file/url fields if no attachments collected yet
      if (attachments.length === 0) {
        const genericUrl = parsed.url || parsed.file || parsed.file_url || parsed.media_url;
        if (genericUrl) {
          const isVid = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(String(genericUrl)) || /^video\//i.test(parsed.mime || '');
          const a = await resolveIncomingAttachment(genericUrl, isVid ? 'video' : 'image', ntfyService);
          if (a) attachments.push(a);
        }
      }
    } else {
      content = String(parsed);
    }
  } catch (_) {
    // not JSON — plain text message
  }

  if (msg.ntfy_title && !parsedTitle) parsedTitle = msg.ntfy_title;

  if (msg.attachment_url && !/\.(json)(\?|$)/i.test(msg.attachment_url)) {
    const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(msg.attachment_url) || /^image\//i.test(msg.attachment_type || '');
    const isVid = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(msg.attachment_url) || /^video\//i.test(msg.attachment_type || '');
    const a = await resolveIncomingAttachment(
      { name: msg.attachment_name, mime: msg.attachment_type, url: msg.attachment_url },
      isVid ? 'video' : (isImg ? 'image' : 'image'),
      ntfyService
    );
    if (a) attachments.push(a);
    else if (!content.includes(msg.attachment_url)) content += '\n\n' + msg.attachment_url;
  }

  return { isSelfEcho: false, content, parsedTitle, attachments };
}

// mode: 'new' (always create note) | 'append' (append to most recent note)
function ingestHookMessage(msg, { mode = 'new', ntfyService } = {}) {
  return enqueue(async () => {
    const { isSelfEcho, content, parsedTitle, attachments } = await parseIncoming(msg, ntfyService);
    if (isSelfEcho) return null;

    const ts = msg.received_at ? new Date(msg.received_at).toLocaleString('en-GB', { hour12: false }) : '';
    const meta = '\n\n--- received ' + ts + ' via ntfy.sh ---';

    const data = await loadNotes();
    let note;
    if (mode === 'append' && data.notes.length > 0) {
      note = data.notes[0];
      note.body += (note.body ? '\n\n' : '') + content + meta;
    } else {
      note = { id: 'h' + Date.now(), title: buildHookTitle(msg, parsedTitle), body: content + meta, updatedAt: Date.now(), attachments: [] };
      data.notes.unshift(note);
    }
    if (attachments.length > 0) {
      if (!note.attachments) note.attachments = [];
      note.attachments.push(...attachments);
    }
    note.updatedAt = Date.now();
    await saveNotes(data);
    return note;
  });
}

export const notepadService = { loadNotes, saveNotes, createNote, updateNote, deleteNote, getNote, addAttachment, removeAttachment, ingestHookMessage };
