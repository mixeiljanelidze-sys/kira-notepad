import { storageService } from './storageService.js';

const CFG_FILE = 'kira-global-cfg.json';

async function loadConfig() {
  const d = await storageService.readJson(CFG_FILE, {
    webhooks: [],
    hookPollingEnabled: false,
    hookAppendMode: 'new',
    supabase: { url: '', key: '', bucket: '' },
  });
  if (!Array.isArray(d.webhooks)) d.webhooks = [];
  d.webhooks = d.webhooks.map((w, idx) => {
    if (!w || typeof w !== 'object') return { id: 'w_' + Date.now() + '_' + idx, label: 'Webhook', url: '' };
    if (!w.id) w.id = 'w_' + Date.now() + '_' + idx;
    return w;
  }).filter((w) => Boolean(w.url));
  if (!d.supabase) d.supabase = { url: '', key: '', bucket: '' };
  return d;
}

async function saveConfig(cfg) {
  await storageService.writeJson(CFG_FILE, cfg);
}

async function addWebhook(label, url) {
  const cfg = await loadConfig();
  const id = 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  cfg.webhooks.push({ id, label: label || url, url });
  await saveConfig(cfg);
  return cfg;
}

async function removeWebhook(idOrIndex) {
  const cfg = await loadConfig();
  cfg.webhooks = cfg.webhooks.filter((w, idx) => w.id !== idOrIndex && String(idx) !== String(idOrIndex));
  await saveConfig(cfg);
  return cfg;
}

export const configService = { loadConfig, saveConfig, addWebhook, removeWebhook };
