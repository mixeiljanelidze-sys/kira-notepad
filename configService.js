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
  if (!d.supabase) d.supabase = { url: '', key: '', bucket: '' };
  return d;
}

async function saveConfig(cfg) {
  await storageService.writeJson(CFG_FILE, cfg);
}

async function addWebhook(label, url) {
  const cfg = await loadConfig();
  cfg.webhooks.push({ id: 'w' + Date.now(), label: label || url, url });
  await saveConfig(cfg);
  return cfg;
}

async function removeWebhook(id) {
  const cfg = await loadConfig();
  cfg.webhooks = cfg.webhooks.filter((w) => w.id !== id);
  await saveConfig(cfg);
  return cfg;
}

export const configService = { loadConfig, saveConfig, addWebhook, removeWebhook };
