import { supabaseService } from './supabaseService.js';

// Pure — no network calls. Mirrors desktop's _buildLivePayload: base64 is
// replaced with a size placeholder so the preview is cheap and side-effect-free.
function previewPayload(note, supabaseCfg) {
  const useSupabase = supabaseService.isConfigured(supabaseCfg);
  const images = (note.attachments || [])
    .filter((a) => a.kind === 'image' && a.image_base64)
    .map((a) => ({
      name: a.name || 'image',
      mime: a.mime || 'image/png',
      [useSupabase ? 'url' : 'data']: useSupabase
        ? '[will upload to Supabase Storage]'
        : `[base64 — ${Math.round((a.image_base64.length * 0.75) / 1024)} KB]`,
    }));
  const videos = (note.attachments || [])
    .filter((a) => a.kind === 'video' && a.video_base64)
    .map((a) => ({
      name: a.name || 'video',
      mime: a.mime || 'video/mp4',
      [useSupabase ? 'url' : 'data']: useSupabase
        ? '[will upload to Supabase Storage]'
        : `[base64 — ${Math.round((a.video_base64.length * 0.75) / 1024)} KB]`,
    }));

  return {
    source: 'KIRA Notepad Mobile',
    title: note.title || '',
    content: note.body || '',
    has_images: images.length > 0,
    images,
    has_videos: videos.length > 0,
    videos,
    timestamp: new Date().toISOString(),
    studio: 'MDR Studio',
  };
}

async function resolveAttachments(attachments, supabaseCfg) {
  const useSupabase = supabaseService.isConfigured(supabaseCfg);
  const resolved = [];
  const uploadedPaths = [];
  const log = [];

  for (const a of attachments || []) {
    if (a.kind !== 'image' && a.kind !== 'video') continue;
    const label = a.name || a.kind;

    if (useSupabase) {
      const r = await supabaseService.upload(supabaseCfg, a);
      if (r.ok) {
        resolved.push({ name: a.name, mime: a.mime, kind: a.kind, data: r.url });
        uploadedPaths.push(r.path);
        log.push(`✓ Supabase upload OK: ${label}`);
        continue;
      }
      log.push(`✗ Supabase upload failed (${label}): ${r.error} — falling back to inline base64`);
    }
    resolved.push({ name: a.name, mime: a.mime, kind: a.kind, data: a.image_base64 || a.video_base64 });
    if (!useSupabase) log.push(`→ ${label}: sent as inline base64 (no Supabase configured)`);
  }

  return { resolved, uploadedPaths, log };
}

function buildPayload(note, resolvedAttachments) {
  const images = resolvedAttachments.filter((a) => a.kind === 'image');
  const videos = resolvedAttachments.filter((a) => a.kind === 'video');
  return {
    source: 'KIRA Notepad Mobile',
    title: note.title || '',
    content: note.body || '',
    has_images: images.length > 0,
    images,
    has_videos: videos.length > 0,
    videos,
    timestamp: new Date().toISOString(),
    studio: 'MDR Studio',
  };
}

async function sendToWebhooks(note, webhookUrls, supabaseCfg) {
  const { resolved, uploadedPaths, log } = await resolveAttachments(note.attachments, supabaseCfg);
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

  return { results, log, payload };
}

export const webhookService = { sendToWebhooks, buildPayload, previewPayload };
