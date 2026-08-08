function buildPayload(note) {
  return {
    source: 'KIRA Notepad Mobile',
    content: note.body || '',
    title: note.title || '',
    has_images: (note.attachments || []).some((a) => a.kind === 'image'),
    images: (note.attachments || [])
      .filter((a) => a.kind === 'image')
      .map((a) => ({ name: a.name, mime: a.mime, data: a.image_base64 })),
    timestamp: new Date().toISOString(),
    studio: 'MDR Studio',
  };
}

async function sendToWebhooks(note, webhookUrls) {
  const payload = buildPayload(note);
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
  return results;
}

export const webhookService = { sendToWebhooks, buildPayload };
