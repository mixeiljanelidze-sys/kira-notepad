import { supabaseService } from './supabaseService.js';

async function resolveAttachments(attachments, supabaseCfg) {
  const useSupabase = supabaseService.isConfigured(supabaseCfg);
  const resolved = [];
  const uploadedPaths = [];

  for (const a of attachments || []) {
    if (a.kind !== 'image' && a.kind !== 'video') continue;

    if (useSupabase) {
      const r = await supabaseService.upload(supabaseCfg, a);
      if (r.ok) {
        resolved.push({ name: a.name, mime: a.mime, kind: a.kind, url: r.url });
        uploadedPaths.push(r.path);
        continue;
      }
    }
    resolved.push({ name: a.name, mime: a.mime, kind: a.kind, data: a.image_base64 || a.video_base64 });
  }

  return { resolved, uploadedPaths };
}

function buildPayload(note, resolvedAttachments) {
  return {
    source: 'KIRA Notepad Mobile',
    title: note.title || '',
    content: note.body || '',
    images: resolvedAttachments.filter((a) => a.kind === 'image'),
    videos: resolvedAttachments.filter((a) => a.kind === 'video'),
    timestamp: new Date().toISOString(),
    studio: 'MDR Studio',
  };
}

async function sendToWebhooks(note, webhookUrls, supabaseCfg) {
  const { resolved, uploadedPaths } = await resolveAttachments(note.attachments, supabaseCfg);
  const payload = buildPayload(note, resolved);

  const results = [];
  for (const url of webhookUrls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      results.push({ url, ok: res.ok, status: res.status });
    } catch (e) {
      results.push({ url, ok: false, error: e.message });
    }
  }

  if (uploadedPaths.length > 0) {
    for (const path of uploadedPaths) supabaseService.scheduleAutoDelete(supabaseCfg, path, 60000);
  }

  return results;
}

export const webhookService = { sendToWebhooks, buildPayload };
