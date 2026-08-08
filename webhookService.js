import { supabaseService } from './supabaseService.js';

const NTFY_SAFE_LIMIT = 3800; // ntfy.sh hard-caps message bodies at 4096 bytes; leave margin for JSON overhead

function isNtfyHost(url) {
  try {
    return /(^|\.)ntfy\.sh$/i.test(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

// Pure — no network calls. Mirrors desktop's _buildLivePayload: base64 is
// replaced with a size placeholder so the preview is cheap and side-effect-free.
function previewPayload(note, supabaseCfg) {
  const useSupabase = supabaseService.isConfigured(supabaseCfg);
  const images = (note.attachments || [])
    .filter((a) => a.kind === 'image' && (a.image_base64 || a.url))
    .map((a) => {
      const isHttp = a.url || /^https?:\/\//i.test(a.image_base64 || '');
      const placeholder = isHttp ? (a.url || a.image_base64) : (useSupabase ? '[will upload to Supabase Storage]' : `[base64 — ${Math.round(((a.image_base64 || '').length * 0.75) / 1024)} KB]`);
      return {
        name: a.name || 'image',
        mime: a.mime || 'image/png',
        kind: 'image',
        url: placeholder,
        data: placeholder,
        link: placeholder,
        src: placeholder,
      };
    });

  const videos = (note.attachments || [])
    .filter((a) => a.kind === 'video' && (a.video_base64 || a.url))
    .map((a) => {
      const isHttp = a.url || /^https?:\/\//i.test(a.video_base64 || '');
      const placeholder = isHttp ? (a.url || a.video_base64) : (useSupabase ? '[will upload to Supabase Storage]' : `[base64 — ${Math.round(((a.video_base64 || '').length * 0.75) / 1024)} KB]`);
      return {
        name: a.name || 'video',
        mime: a.mime || 'video/mp4',
        kind: 'video',
        url: placeholder,
        data: placeholder,
        link: placeholder,
        src: placeholder,
      };
    });

  const noteTitle = (note.title || '').trim();
  const noteBody = (note.body || '').trim();
  const textContent = noteBody || noteTitle || 'Untitled Note';
  const firstImg = images[0] ? images[0].url : '';
  const firstVid = videos[0] ? videos[0].url : '';
  const primaryMediaUrl = firstImg || firstVid || '';

  return {
    source: 'KIRA Notepad Mobile',
    note_id: note.id || '',
    title: noteTitle || noteBody.slice(0, 50) || 'Untitled Note',
    content: textContent,
    text: textContent,
    body: noteBody,
    caption: textContent,
    message: textContent,
    description: textContent,
    url: primaryMediaUrl,
    image_url: firstImg,
    video_url: firstVid,
    media_url: primaryMediaUrl,
    image: firstImg,
    video: firstVid,
    has_images: images.length > 0,
    images,
    image_urls: images.map((i) => i.url),
    has_videos: videos.length > 0,
    videos,
    video_urls: videos.map((v) => v.url),
    media_urls: [...images.map((i) => i.url), ...videos.map((v) => v.url)],
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

    const existingUrl = a.url || (a.image_base64 && /^https?:\/\//i.test(a.image_base64) ? a.image_base64 : null) || (a.video_base64 && /^https?:\/\//i.test(a.video_base64) ? a.video_base64 : null);
    if (existingUrl) {
      resolved.push({ name: a.name, mime: a.mime, kind: a.kind, data: existingUrl, url: existingUrl });
      log.push(`✓ Attachment already has URL: ${label}`);
      continue;
    }

    if (useSupabase) {
      const r = await supabaseService.upload(supabaseCfg, a);
      if (r.ok) {
        resolved.push({ name: a.name, mime: a.mime, kind: a.kind, data: r.url, url: r.url });
        uploadedPaths.push(r.path);
        log.push(`✓ Supabase upload OK: ${label}`);
        continue;
      }
      log.push(`✗ Supabase upload failed (${label}): ${r.error} — falling back to inline base64`);
    }

    const b64 = a.image_base64 || a.video_base64;
    resolved.push({ name: a.name, mime: a.mime, kind: a.kind, data: b64, url: b64 });
    if (!useSupabase) log.push(`→ ${label}: sent as inline base64 (no Supabase configured)`);
  }

  return { resolved, uploadedPaths, log };
}

function buildPayload(note, resolvedAttachments) {
  const images = resolvedAttachments.filter((a) => a.kind === 'image');
  const videos = resolvedAttachments.filter((a) => a.kind === 'video');

  const noteTitle = (note.title || '').trim();
  const noteBody = (note.body || '').trim();
  const textContent = noteBody || noteTitle || 'Untitled Note';

  const formattedImages = images.map((img) => {
    const mediaUrl = img.url || img.data || '';
    return {
      name: img.name || 'image',
      mime: img.mime || 'image/png',
      kind: 'image',
      url: mediaUrl,
      data: mediaUrl,
      link: mediaUrl,
      src: mediaUrl,
    };
  });

  const formattedVideos = videos.map((vid) => {
    const mediaUrl = vid.url || vid.data || '';
    return {
      name: vid.name || 'video',
      mime: vid.mime || 'video/mp4',
      kind: 'video',
      url: mediaUrl,
      data: mediaUrl,
      link: mediaUrl,
      src: mediaUrl,
    };
  });

  const imageUrls = formattedImages.map((i) => i.url);
  const videoUrls = formattedVideos.map((v) => v.url);
  const mediaUrls = [...imageUrls, ...videoUrls];
  const firstImg = imageUrls[0] || '';
  const firstVid = videoUrls[0] || '';
  const primaryMediaUrl = firstImg || firstVid || '';

  return {
    source: 'KIRA Notepad Mobile',
    note_id: note.id || '',
    title: noteTitle || noteBody.slice(0, 50) || 'Untitled Note',
    content: textContent,
    text: textContent,
    body: noteBody,
    caption: textContent,
    message: textContent,
    description: textContent,

    url: primaryMediaUrl,
    image_url: firstImg,
    video_url: firstVid,
    media_url: primaryMediaUrl,
    image: firstImg,
    video: firstVid,

    has_images: formattedImages.length > 0,
    images: formattedImages,
    image_urls: imageUrls,
    has_videos: formattedVideos.length > 0,
    videos: formattedVideos,
    video_urls: videoUrls,
    media_urls: mediaUrls,

    timestamp: new Date().toISOString(),
    studio: 'MDR Studio',
  };
}

// A base64 'data' field wasn't resolved to a short URL (Supabase off or failed).
// Sending it as-is to ntfy.sh would blow the 4096B hard limit and kill the
// ENTIRE message — text included. Strip it and leave a visible reason instead.
function capForNtfy(payload) {
  const capped = JSON.parse(JSON.stringify(payload));
  let omitted = [];

  const stripIfOversized = (arr) => {
    for (const item of arr || []) {
      const isUrl = /^https?:\/\//i.test(item.data || item.url || '');
      if (!isUrl && item.data && item.data.length > 500) {
        omitted.push(item.name);
        item.data = '[omitted — exceeds ntfy.sh 4096B message limit; configure Supabase to send full-size files]';
        item.url = item.data;
      }
    }
  };
  stripIfOversized(capped.images);
  stripIfOversized(capped.videos);

  const json = JSON.stringify(capped);
  return { capped, omitted, tooLarge: new Blob([json]).size > NTFY_SAFE_LIMIT, byteSize: new Blob([json]).size };
}

async function sendToWebhooks(note, webhookUrls, supabaseCfg) {
  const { resolved, uploadedPaths, log } = await resolveAttachments(note.attachments, supabaseCfg);
  const fullPayload = buildPayload(note, resolved);

  const results = [];
  for (const url of webhookUrls) {
    let payloadToSend = fullPayload;

    if (isNtfyHost(url)) {
      const { capped, omitted, tooLarge, byteSize } = capForNtfy(fullPayload);
      payloadToSend = capped;
      if (omitted.length > 0) log.push(`⚠ ntfy.sh: omitted full-size data for ${omitted.join(', ')} (base64 too large for 4096B limit)`);
      if (tooLarge) log.push(`⚠ ntfy.sh: payload still ${byteSize}B after capping — text/title may be truncated too`);
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadToSend),
      });
      results.push({ url, ok: res.ok, status: res.status });
    } catch (e) {
      results.push({ url, ok: false, error: e.message });
    }
  }

  if (uploadedPaths.length > 0) {
    for (const path of uploadedPaths) supabaseService.scheduleAutoDelete(supabaseCfg, path, 60000);
  }

  return { results, log, payload: fullPayload };
}

export const webhookService = { sendToWebhooks, buildPayload, previewPayload };
