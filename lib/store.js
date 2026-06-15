// Persistenza su file JSON: nessun DB nativo, zero dipendenze di compilazione.
const fs = require('fs');
const path = require('path');

// In cloud DATA_DIR punta al volume persistente (es. /data); in locale resta ./data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  products: path.join(DATA_DIR, 'products.json'),
  status: path.join(DATA_DIR, 'status.json'),
  videos: path.join(DATA_DIR, 'videos.json'),
  queue: path.join(DATA_DIR, 'queue.json'),
  affiliate: path.join(DATA_DIR, 'affiliate.json'),
  tiktokAuth: path.join(DATA_DIR, 'tiktok-auth.json'),
};

const DIRS = {
  data: DATA_DIR,
  snapshots: path.join(DATA_DIR, 'snapshots'),
  videos: path.join(DATA_DIR, 'videos'),
  images: path.join(DATA_DIR, 'images'),
};

const DEFAULT_SETTINGS = {
  region: 'IT',
  timezone: 'Europe/Rome',
  dailyVideoCount: 10,
  scrapeCron: '30 7 * * *',   // scraping trend ogni mattina
  videoCron: '15 8 * * *',    // generazione video dopo lo scraping
  fastmossCookie: '',          // opzionale: cookie di sessione FastMoss per classifica completa
  fastmossHeaders: {},         // header completi estratti dal "Copy as cURL" (cookie + eventuali token)
  categoryFocus: { enabled: true }, // mostra solo moda donna (abbigliamento, pantaloni, top, abiti, accessori)
  searchKeywords: [
    'pantaloni donna', 'leggings donna', 'jeans donna', 'abito donna', 'vestito donna',
    'gonna donna', 'top donna', 'camicetta donna', 'maglia donna', 'abbigliamento donna',
    'accessori donna', 'borsa donna', 'gioielli donna', 'cintura donna',
  ],
  freepik: {
    apiKey: '',
    imageModel: 'nano-banana-2',
    imageModelFallbacks: ['nano-banana-pro', 'gemini-2-5-flash-image-preview'],
    videoModel: 'kling-v2-5-pro',
    videoDuration: '10',
    aspectRatio: '9:16',
    resolution: '1k'
  },
  tiktok: {
    clientKey: '',
    clientSecret: '',
    redirectUri: '',           // se vuoto: http://127.0.0.1:<porta>/api/tiktok/callback
    privacyLevel: 'SELF_ONLY'  // le app non ancora approvate da TikTok possono postare solo in privato
  }
};

function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra !== undefined ? extra : base;
  if (typeof base === 'object' && base && typeof extra === 'object' && extra) {
    const out = { ...base };
    for (const k of Object.keys(extra)) out[k] = deepMerge(base[k], extra[k]);
    return out;
  }
  return extra !== undefined ? extra : base;
}

function getSettings() {
  return deepMerge(DEFAULT_SETTINGS, readJSON(FILES.settings, {}));
}

function saveSettings(patch) {
  const next = deepMerge(getSettings(), patch || {});
  writeJSON(FILES.settings, next);
  return next;
}

// Sostituisce una chiave per intero (senza deep-merge: utile per oggetti da rimpiazzare in blocco).
function setSettingsKey(key, value) {
  const s = getSettings();
  s[key] = value;
  writeJSON(FILES.settings, s);
  return s;
}

module.exports = { FILES, DIRS, ensureDirs, readJSON, writeJSON, getSettings, saveSettings, setSettingsKey, DEFAULT_SETTINGS };
