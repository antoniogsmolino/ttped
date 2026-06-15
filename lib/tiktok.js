// Pubblicazione su TikTok via Content Posting API ufficiale.
// Richiede un'app registrata su developers.tiktok.com con scope video.publish.
// Le app non ancora "audited" da TikTok possono pubblicare solo con privacy SELF_ONLY (video privati).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FILES, DIRS, readJSON, writeJSON, getSettings } = require('./store');
const videogen = require('./videogen');

const AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API = 'https://open.tiktokapis.com';

let pendingState = null;

function getAuth() {
  return readJSON(FILES.tiktokAuth, null);
}

function redirectUri(port) {
  const { tiktok } = getSettings();
  if (tiktok.redirectUri) return tiktok.redirectUri;
  const base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : `http://127.0.0.1:${port}`;
  return `${base}/api/tiktok/callback`;
}

function authUrl(port) {
  const { tiktok } = getSettings();
  if (!tiktok.clientKey) throw new Error('Client Key TikTok mancante: configurala nelle Impostazioni');
  pendingState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_key: tiktok.clientKey,
    scope: 'user.info.basic,video.publish,video.upload',
    response_type: 'code',
    redirect_uri: redirectUri(port),
    state: pendingState,
  });
  return `${AUTH_BASE}?${params}`;
}

async function exchangeCode(code, state, port) {
  if (!pendingState || state !== pendingState) throw new Error('State OAuth non valido');
  pendingState = null;
  const { tiktok } = getSettings();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(port),
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Token TikTok non ricevuto: ${JSON.stringify(j).slice(0, 300)}`);
  const auth = {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    openId: j.open_id,
    scope: j.scope,
    expiresAt: Date.now() + (j.expires_in || 86400) * 1000,
  };
  writeJSON(FILES.tiktokAuth, auth);
  return auth;
}

async function ensureToken() {
  let auth = getAuth();
  if (!auth) throw new Error('Account TikTok non collegato');
  if (Date.now() < auth.expiresAt - 60000) return auth;
  const { tiktok } = getSettings();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Refresh token TikTok fallito: ricollega l\'account');
  auth = {
    ...auth,
    accessToken: j.access_token,
    refreshToken: j.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + (j.expires_in || 86400) * 1000,
  };
  writeJSON(FILES.tiktokAuth, auth);
  return auth;
}

async function api(method, urlPath, body, token) {
  const res = await fetch(API + urlPath, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  return res.json();
}

// Pubblica subito un video (Direct Post, upload da file locale in un solo chunk).
async function publishNow(jobId) {
  const job = videogen.listJobs().find((j) => j.id === jobId);
  if (!job || job.status !== 'done' || !job.file) throw new Error('Video non pronto per la pubblicazione');
  const filePath = path.join(DIRS.videos, job.file);
  const size = fs.statSync(filePath).size;
  const { tiktok } = getSettings();
  const auth = await ensureToken();

  videogen.updateJob(jobId, { publish: { ...job.publish, status: 'publishing', error: null } });
  try {
    const init = await api('POST', '/v2/post/publish/video/init/', {
      post_info: {
        title: job.caption,
        privacy_level: tiktok.privacyLevel || 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    }, auth.accessToken);

    if (init.error && init.error.code !== 'ok') {
      throw new Error(`Init pubblicazione fallita: ${init.error.code} ${init.error.message || ''}`);
    }
    const { publish_id, upload_url } = init.data || {};
    if (!upload_url) throw new Error('upload_url mancante nella risposta TikTok');

    const up = await fetch(upload_url, {
      method: 'PUT',
      headers: {
        'content-type': 'video/mp4',
        'content-range': `bytes 0-${size - 1}/${size}`,
        'content-length': String(size),
      },
      body: fs.readFileSync(filePath),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!up.ok) throw new Error(`Upload video fallito HTTP ${up.status}`);

    // Attende l'esito della pubblicazione.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await api('POST', '/v2/post/publish/status/fetch/', { publish_id }, auth.accessToken);
      const status = st.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        videogen.updateJob(jobId, { publish: { status: 'published', when: new Date().toISOString(), publishId: publish_id, error: null } });
        return { ok: true, publishId: publish_id };
      }
      if (status === 'FAILED') {
        throw new Error(`Pubblicazione fallita: ${st.data?.fail_reason || 'motivo sconosciuto'}`);
      }
    }
    // Ancora in elaborazione lato TikTok: lo consideriamo inviato.
    videogen.updateJob(jobId, { publish: { status: 'published', when: new Date().toISOString(), publishId: publish_id, error: null } });
    return { ok: true, publishId: publish_id, note: 'In elaborazione lato TikTok' };
  } catch (e) {
    videogen.updateJob(jobId, { publish: { status: 'failed', when: null, publishId: null, error: e.message } });
    throw e;
  }
}

// Coda di programmazione locale: il server pubblica quando arriva l'orario.
function scheduleVideo(jobId, whenISO) {
  const when = new Date(whenISO);
  if (isNaN(when) || when < new Date()) throw new Error('Data/ora di programmazione non valida');
  const queue = readJSON(FILES.queue, []);
  queue.push({ jobId, when: when.toISOString(), status: 'scheduled' });
  writeJSON(FILES.queue, queue);
  const job = videogen.listJobs().find((j) => j.id === jobId);
  if (job) videogen.updateJob(jobId, { publish: { ...job.publish, status: 'scheduled', when: when.toISOString() } });
  return { ok: true };
}

function getQueue() {
  return readJSON(FILES.queue, []);
}

// Da chiamare ogni minuto dal cron: pubblica i video programmati scaduti.
async function processQueue() {
  const queue = readJSON(FILES.queue, []);
  const now = Date.now();
  let changed = false;
  for (const item of queue) {
    if (item.status === 'scheduled' && new Date(item.when).getTime() <= now) {
      item.status = 'publishing';
      changed = true;
      writeJSON(FILES.queue, queue);
      try {
        await publishNow(item.jobId);
        item.status = 'published';
      } catch (e) {
        item.status = 'failed';
        item.error = e.message;
      }
    }
  }
  if (changed) writeJSON(FILES.queue, queue);
}

function status() {
  const auth = getAuth();
  const { tiktok } = getSettings();
  return {
    configured: Boolean(tiktok.clientKey && tiktok.clientSecret),
    connected: Boolean(auth),
    openId: auth?.openId || null,
    privacyLevel: tiktok.privacyLevel,
  };
}

module.exports = { authUrl, exchangeCode, publishNow, scheduleVideo, processQueue, getQueue, status };
