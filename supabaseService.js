function base64ToBlob(base64, mime) {
  const byteStr = atob(base64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

// attachment: { name, mime, image_base64 | video_base64 }
async function upload(cfg, attachment) {
  const base64 = attachment.image_base64 || attachment.video_base64;
  if (!base64) return { ok: false, error: 'No base64 data on attachment' };

  const sbUrl = cfg.url.trim().replace(/\/$/, '');
  const bucket = cfg.bucket.trim();
  const key = cfg.key.trim();
  const cleanName = (attachment.name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
  const uniqueName = `${Date.now()}_${cleanName}`;
  const blob = base64ToBlob(base64, attachment.mime);

  try {
    const res = await fetch(`${sbUrl}/storage/v1/object/${bucket}/${uniqueName}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': attachment.mime || 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true, path: uniqueName, url: `${sbUrl}/storage/v1/object/public/${bucket}/${uniqueName}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function remove(cfg, path) {
  const sbUrl = cfg.url.trim().replace(/\/$/, '');
  const bucket = cfg.bucket.trim();
  const key = cfg.key.trim();
  try {
    await fetch(`${sbUrl}/storage/v1/object/${bucket}/${path}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch (_) {}
}

function scheduleAutoDelete(cfg, path, delayMs = 60000) {
  setTimeout(() => remove(cfg, path), delayMs);
}

function isConfigured(cfg) {
  return !!(cfg && cfg.url && cfg.key && cfg.bucket);
}

export const supabaseService = { upload, remove, scheduleAutoDelete, isConfigured };
