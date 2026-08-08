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
  if (parsedTitle) return 'Hook · ' + String(parsedTitle).slice(0, 40);
  const firstLine = (msg.data || '').split('\n')[0].trim();
  if (firstLine && firstLine.length <= 50) return 'Hook · ' + firstLine;
  return 'Hook · ' + ts;
}

// Fetches a single image/video entry from a webhookService-style payload
// ({name, mime, url} or {name, mime, data}) into a note attachment.
async function resolveIncomingAttachment(entry, kind, ntfyService) {
  const mime = entry.mime || (kind === 'video' ? 'video/mp4' : 'image/png');
  const name = entry.name || (kind === 'video' ? 'attachment.mp4' : 'attachment.png');
  const value = entry.data || entry.url;
  if (!value) return null;

  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl) {
    return { kind, name, mime, [kind === 'video' ? 'video_base64' : 'image_base64']: value };
  }
  if (ntfyService) {
    const r = await ntfyService.fetchAttachment(value);
    if (r.ok && r.dataUrl) {
      const rawB64 = r.dataUrl.split(',')[1];
      return { kind, name, mime: r.mime || mime, [kind === 'video' ? 'video_base64' : 'image_base64']: rawB64 };
    }
  }
  return null;
}

// Parses an incoming ntfy message. Handles two independent attachment sources:
//  1. ntfy's own native attachment_url (a single file uploaded directly to ntfy)
//  2. a JSON body shaped like webhookService's own payload (title/content/images[]/videos[])
async function parseIncoming(msg, ntfyService) {
  const raw = msg.data || '';
  let content = raw;
  let parsedTitle = null;
  const attachments = [];

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
      if (parsed.title) parsedTitle = parsed.title;

      for (const img of parsed.images || []) {
        const a = await resolveIncomingAttachment(img, 'image', ntfyService);
        if (a) attachments.push(a);
      }
      for (const vid of parsed.videos || []) {
        const a = await resolveIncomingAttachment(vid, 'video', ntfyService);
        if (a) attachments.push(a);
      }
    } else {
      content = String(parsed);
    }
  } catch (_) {
    // not JSON — plain text message, content stays as raw
  }

  if (msg.ntfy_title) content = msg.ntfy_title + '\n\n' + content;

  if (msg.attachment_url) {
    const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(msg.attachment_url) || /^image\//i.test(msg.attachment_type || '');
    const isVid = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(msg.attachment_url) || /^video\//i.test(msg.attachment_type || '');
    if (isImg || isVid) {
      const a = await resolveIncomingAttachment(
        { name: msg.attachment_name, mime: msg.attachment_type, url: msg.attachment_url },
        isVid ? 'video' : 'image',
        ntfyService
      );
      if (a) attachments.push(a);
      else content += '\n\n' + msg.attachment_url;
    } else {
      content += '\n\n' + msg.attachment_url;
    }
  }

  return { content, parsedTitle, attachments };
}

// mode: 'new' (always create note) | 'append' (append to most recent note)
function ingestHookMessage(msg, { mode = 'new', ntfyService } = {}) {
  return enqueue(async () => {
    const { content, parsedTitle, attachments } = await parseIncoming(msg, ntfyService);
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
