// TTPED Studio — server principale.
// Avvio: npm start  →  http://127.0.0.1:4280
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');

const { DIRS, ensureDirs, readJSON, writeJSON, getSettings, saveSettings, setSettingsKey } = require('./lib/store');
const scraper = require('./lib/scraper');
const videogen = require('./lib/videogen');
const tiktok = require('./lib/tiktok');
const affiliate = require('./lib/affiliate');

const PORT = process.env.PORT || 4280;
const HOST = process.env.HOST || '127.0.0.1';
// Con ACCESS_PASSWORD impostata (obbligatoria su deploy pubblici) tutte le route richiedono login.
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
ensureDirs();

const app = express();
app.set('trust proxy', 1); // dietro il proxy HTTPS della piattaforma cloud
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '50mb' }));

// ---------- Autenticazione (solo se ACCESS_PASSWORD è impostata) ----------

const SESSIONS_FILE = path.join(DIRS.data, 'sessions.json');
const sessions = new Set(readJSON(SESSIONS_FILE, []));

function loginPage(err = '') {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>TTPED Studio — Accesso</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f4f4f6}
.box{width:min(340px,90vw);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:34px;text-align:center;backdrop-filter:blur(14px)}
.logo{font-size:22px;font-weight:800;margin-bottom:6px}.logo em{font-style:normal;background:linear-gradient(120deg,#fe2c55,#b94dff 55%,#25f4ee);-webkit-background-clip:text;background-clip:text;color:transparent}
p{color:#9a9aa6;font-size:13px;margin:0 0 22px}
input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:12px;padding:13px;font-size:15px;outline:none;margin-bottom:12px}
input:focus{border-color:#25f4ee}
button{width:100%;border:0;cursor:pointer;background:linear-gradient(120deg,#fe2c55,#b94dff 55%,#25f4ee);color:#fff;font-weight:700;font-size:14px;padding:13px;border-radius:12px}
.err{color:#f87171;font-size:12.5px;margin-bottom:10px}</style></head>
<body><form class="box" method="post" action="/api/login">
<div class="logo">▶ TTPED<em>Studio</em></div><p>Inserisci la password di accesso</p>
${err ? `<div class="err">${err}</div>` : ''}
<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"/>
<button type="submit">Entra</button></form></body></html>`;
}

function getSessionToken(req) {
  const m = (req.headers.cookie || '').match(/ttped_session=([a-f0-9]{48})/);
  return m && sessions.has(m[1]) ? m[1] : null;
}

app.use((req, res, next) => {
  if (!ACCESS_PASSWORD) return next();
  // Il callback OAuth di TikTok arriva senza la nostra sessione: è protetto dal parametro state.
  if (req.path === '/api/login' || req.path === '/api/tiktok/callback') return next();
  if (getSessionToken(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
    return res.status(401).json({ error: 'Non autorizzato: effettua il login' });
  }
  res.send(loginPage());
});

app.post('/api/login', express.urlencoded({ extended: false }), (req, res) => {
  const given = String(req.body?.password || '');
  const a = Buffer.from(given), b = Buffer.from(ACCESS_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).send(loginPage('Password errata'));
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  writeJSON(SESSIONS_FILE, [...sessions].slice(-50)); // mantiene le ultime 50 sessioni
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ttped_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${90 * 86400}${secure}`);
  res.redirect('/');
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/media/videos', express.static(DIRS.videos));

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => res.status(500).json({ error: e.message }));
};

// ---------- Trend ----------

app.get('/api/trends', wrap(async (req, res) => {
  res.json({ status: scraper.getStatus(), top: scraper.computeTrends(20) });
}));

app.post('/api/scrape/run', wrap(async (req, res) => {
  const status = await scraper.runScrape();
  res.json(status);
}));

// ---------- Video Studio ----------

app.get('/api/videos', wrap(async (req, res) => {
  res.json({ jobs: videogen.listJobs(), running: videogen.isRunning(), queue: tiktok.getQueue() });
}));

app.post('/api/videos/generate-daily', wrap(async (req, res) => {
  res.json(await videogen.runDailyGeneration(req.body?.count));
}));

app.post('/api/videos/generate/:productId', wrap(async (req, res) => {
  res.json(await videogen.generateForProduct(req.params.productId));
}));

app.get('/api/videos/:id/download', wrap(async (req, res) => {
  const job = videogen.listJobs().find((j) => j.id === req.params.id);
  if (!job || !job.file) return res.status(404).json({ error: 'Video non trovato' });
  res.download(path.join(DIRS.videos, job.file), `${job.productTitle.slice(0, 40).replace(/[^\w àèéìòù-]/g, '')}.mp4`);
}));

app.post('/api/videos/:id/caption', wrap(async (req, res) => {
  const job = videogen.updateJob(req.params.id, { caption: String(req.body?.caption || '') });
  if (!job) return res.status(404).json({ error: 'Video non trovato' });
  res.json(job);
}));

// ---------- TikTok publish ----------

app.get('/api/tiktok/status', wrap(async (req, res) => res.json(tiktok.status())));

app.get('/api/tiktok/login', wrap(async (req, res) => {
  res.redirect(tiktok.authUrl(PORT));
}));

app.get('/api/tiktok/callback', wrap(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`<h2>Autorizzazione negata: ${error}</h2>`);
  await tiktok.exchangeCode(code, state, PORT);
  res.send('<h2>✅ Account TikTok collegato!</h2><p>Puoi chiudere questa finestra e tornare a TTPED Studio.</p>');
}));

app.post('/api/videos/:id/publish', wrap(async (req, res) => {
  const { when } = req.body || {};
  if (when) return res.json(tiktok.scheduleVideo(req.params.id, when));
  res.json(await tiktok.publishNow(req.params.id));
}));

// ---------- Affiliate ----------

app.post('/api/affiliate/import', wrap(async (req, res) => {
  const csv = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (!csv) return res.status(400).json({ error: 'Nessun contenuto CSV ricevuto' });
  const name = req.query.name || `import-${Date.now()}.csv`;
  res.json(affiliate.importCSV(csv, String(name)));
}));

app.get('/api/affiliate/analytics', wrap(async (req, res) => res.json(affiliate.analytics())));
app.get('/api/affiliate/strategy', wrap(async (req, res) => res.json(affiliate.strategy())));
app.post('/api/affiliate/reset', wrap(async (req, res) => { affiliate.reset(); res.json({ ok: true }); }));

// ---------- Impostazioni ----------

// Estrae gli header da un comando "Copy as cURL" di Chrome/Firefox/Safari.
function parseCurlHeaders(cmd) {
  const headers = {};
  const re = /(?:-H|--header)\s+(\$?)(['"])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(cmd))) {
    const raw = m[1] ? m[3].replace(/\\(['"\\])/g, '$1') : m[3]; // gestisce $'...' con escape
    const idx = raw.indexOf(':');
    if (idx > 0) headers[raw.slice(0, idx).trim().toLowerCase()] = raw.slice(idx + 1).trim();
  }
  const cb = cmd.match(/(?:-b|--cookie)\s+(\$?)(['"])([\s\S]*?)\2/);
  if (cb) headers.cookie = (cb[1] ? cb[3].replace(/\\(['"\\])/g, '$1') : cb[3]).trim();
  // Header che non vanno re-inviati a mano (inclusi quelli di navigazione documento).
  for (const d of ['content-length', 'host', 'accept-encoding', 'connection', 'content-type', 'if-none-match',
    'if-modified-since', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
    'upgrade-insecure-requests', 'priority', 'pragma', 'cache-control']) {
    delete headers[d];
  }
  if ((headers.accept || '').startsWith('text/html')) delete headers.accept;
  return headers;
}

function maskedSettings() {
  const s = getSettings();
  const mask = (v) => (v ? v.slice(0, 4) + '••••' : '');
  const fmSet = Boolean(s.fastmossCookie || Object.keys(s.fastmossHeaders || {}).length);
  return {
    ...s,
    fastmossCookie: fmSet ? '(impostato)' : '',
    fastmossHeaders: undefined,
    freepik: { ...s.freepik, apiKey: mask(s.freepik.apiKey) },
    tiktok: { ...s.tiktok, clientSecret: mask(s.tiktok.clientSecret) },
  };
}

app.get('/api/settings', wrap(async (req, res) => res.json(maskedSettings())));

app.post('/api/settings', wrap(async (req, res) => {
  const patch = req.body || {};
  // Non sovrascrivere i segreti con i valori mascherati rimandati dalla UI.
  const scrub = (obj, key) => {
    if (obj && typeof obj[key] === 'string' && (obj[key].includes('••••') || obj[key] === '(impostato)')) delete obj[key];
  };
  scrub(patch.freepik, 'apiKey');
  scrub(patch.tiktok, 'clientSecret');
  scrub(patch, 'fastmossCookie');
  if (typeof patch.fastmossCookie === 'string') {
    const v = patch.fastmossCookie.trim();
    if (/^curl\s/i.test(v)) {
      // Incollato un "Copy as cURL": estrae cookie e token e li salva in blocco.
      const headers = parseCurlHeaders(v);
      setSettingsKey('fastmossHeaders', headers);
      patch.fastmossCookie = headers.cookie || '';
    } else if (v === '') {
      setSettingsKey('fastmossHeaders', {});
    }
  }
  saveSettings(patch);
  scheduleCrons(); // riallinea i cron ai nuovi orari
  res.json(maskedSettings());
}));

// ---------- Cron ----------

let cronTasks = [];

function scheduleCrons() {
  cronTasks.forEach((t) => t.stop());
  cronTasks = [];
  const s = getSettings();
  const tz = { timezone: s.timezone || 'Europe/Rome' };
  try {
    cronTasks.push(cron.schedule(s.scrapeCron, () => {
      scraper.runScrape().catch((e) => console.error('[cron scrape]', e.message));
    }, tz));
    cronTasks.push(cron.schedule(s.videoCron, () => {
      videogen.runDailyGeneration().catch((e) => console.error('[cron video]', e.message));
    }, tz));
  } catch (e) {
    console.error('Espressione cron non valida:', e.message);
  }
  // Coda pubblicazioni programmate: controllo ogni minuto.
  cronTasks.push(cron.schedule('* * * * *', () => {
    tiktok.processQueue().catch((e) => console.error('[cron queue]', e.message));
  }, tz));
}

scheduleCrons();

// Primo scraping automatico se oggi non è ancora stato fatto.
(function bootstrapScrape() {
  const st = scraper.getStatus();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (!st.lastRun || st.lastRun.slice(0, 10) !== todayStr) {
    console.log('Primo scraping del giorno in corso…');
    scraper.runScrape()
      .then((r) => console.log(`Scraping completato: ${r.count} prodotti (${r.limited ? 'classifica limitata senza cookie FastMoss' : 'ok'})`))
      .catch((e) => console.error('Scraping fallito:', e.message));
  }
})();

if (HOST !== '127.0.0.1' && !ACCESS_PASSWORD) {
  console.warn('⚠️  ATTENZIONE: server esposto in rete senza ACCESS_PASSWORD. Impostala prima di un deploy pubblico!');
}

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 TTPED Studio attivo su http://${HOST}:${PORT}${ACCESS_PASSWORD ? ' (protetto da password)' : ''}\n`);
});
