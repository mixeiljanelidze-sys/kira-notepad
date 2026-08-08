const PREFIX = 'kira_np_';

async function readJson(fileName, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + fileName);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(fileName, data) {
  localStorage.setItem(PREFIX + fileName, JSON.stringify(data));
}

export const storageService = { readJson, writeJson };
