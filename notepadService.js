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

function buildHookTitle(msg) {
  const ts = msg.received_at
    ? new Date(msg.received_at).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';
  if (msg.ntfy_title && msg.ntfy_title.trim()) return 'Hook · ' + msg.ntfy_title.slice(0, 40);
  try {
    const d = JSON.parse(msg.data || '');
    if (typeof d === 'object') {
      for (const f of ['title', 'subject', 'name', 'from', 'source']) {
        if (d[f] && typeof d[f] === 'string') return 'Hook · ' + d[f].slice(0, 40);
      }
    }
  } catch (_) {}
  const firstLine = (msg.data || '').split('\n')[0].trim();
  if (firstLine && firstLine.length <= 50) return 'Hook · ' + firstLine;
  return 'Hook · ' + ts;
}

function extractContent(msg) {
  let content = '';
  const raw = msg.data || '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const fields = ['text', 'content', 'message', 'body', 'caption', 'post', 'note', 'value', 'msg'];
      let extracted = null;
      for (const f of fields) {
        if (parsed[f] && typeof parsed[f] === 'string' && parsed[f].trim()) {
          extracted = parsed[f];
          break;
        }
      }
      content = extracted || JSON.stringify(parsed, null, 2);
    } else {
      content = String(parsed);
    }
  } catch (_) {
    content = raw;
  }
  if (msg.ntfy_title) content = msg.ntfy_title + '\n\n' + content;
  return content;
}

// mode: 'new' (always create note) | 'append' (append to most recent note)
function ingestHookMessage(msg, { mode = 'new', ntfyService } = {}) {
  return enqueue(async () => {
    let content = extractContent(msg);
    const ts = msg.received_at ? new Date(msg.received_at).toLocaleString('en-GB', { hour12: false }) : '';
    const meta = '\n\n--- received ' + ts + ' via ntfy.sh ---';

    let boundAttachment = null;
    if (msg.attachment_url) {
      const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(msg.attachment_url) || /^image\//i.test(msg.attachment_type || '');
      const isVid = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(msg.attachment_url) || /^video\//i.test(msg.attachment_type || '');

      if ((isImg || isVid) && ntfyService) {
        const r = await ntfyService.fetchAttachment(msg.attachment_url);
        if (r.ok && r.dataUrl) {
          const rawB64 = r.dataUrl.split(',')[1];
          const kind = isVid ? 'video' : 'image';
          boundAttachment = {
            kind,
            name: msg.attachment_name || (kind === 'video' ? 'attachment.mp4' : 'attachment.png'),
            mime: r.mime,
            [kind === 'video' ? 'video_base64' : 'image_base64']: rawB64,
          };
        }
      }
      if (!boundAttachment) content += '\n\n' + msg.attachment_url;
    }

    const data = await loadNotes();
    let note;
    if (mode === 'append' && data.notes.length > 0) {
      note = data.notes[0];
      note.body += (note.body ? '\n\n' : '') + content + meta;
    } else {
      note = { id: 'h' + Date.now(), title: buildHookTitle(msg), body: content + meta, updatedAt: Date.now(), attachments: [] };
      data.notes.unshift(note);
    }
    if (boundAttachment) {
      if (!note.attachments) note.attachments = [];
      note.attachments.push(boundAttachment);
    }
    note.updatedAt = Date.now();
    await saveNotes(data);
    return note;
  });
}

export const notepadService = { loadNotes, saveNotes, createNote, updateNote, deleteNote, getNote, addAttachment, removeAttachment, ingestHookMessage };
