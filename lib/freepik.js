// Client API Freepik: generazione immagini (Nano Banana) e video (Kling 2.5 Pro).
// NOTA: l'API Freepik è fatturata a crediti API, separati dal piano Unlimited della webapp.
const fs = require('fs');
const path = require('path');
const { DIRS, getSettings } = require('./store');

const API = 'https://api.freepik.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function imagePathFor(model) {
  // Il modello Gemini "storico" vive fuori dal prefisso text-to-image.
  if (model === 'gemini-2-5-flash-image-preview') return '/v1/ai/gemini-2-5-flash-image-preview';
  return `/v1/ai/text-to-image/${model}`;
}

async function fpRequest(method, urlPath, body) {
  const { freepik } = getSettings();
  if (!freepik.apiKey) throw new Error('API key Freepik mancante: inseriscila nelle Impostazioni');
  const res = await fetch(API + urlPath, {
    method,
    headers: {
      'x-freepik-api-key': freepik.apiKey,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* risposta non JSON */ }
  return { status: res.status, json, text };
}

async function pollTask(basePath, taskId, { intervalMs = 10000, timeoutMs = 15 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, json, text } = await fpRequest('GET', `${basePath}/${taskId}`);
    if (status >= 400) throw new Error(`Freepik polling HTTP ${status}: ${text.slice(0, 200)}`);
    const data = json?.data || json || {};
    const st = (data.status || '').toUpperCase();
    if (st === 'COMPLETED' || st === 'SUCCESS') {
      const generated = data.generated || data.result || [];
      const url = Array.isArray(generated) ? (generated[0]?.url || generated[0]) : generated;
      if (!url) throw new Error('Task completato ma nessun file generato');
      return url;
    }
    if (st === 'FAILED' || st === 'ERROR') {
      throw new Error(`Task Freepik fallito: ${JSON.stringify(data).slice(0, 300)}`);
    }
    await sleep(intervalMs);
  }
  throw new Error('Timeout in attesa del task Freepik');
}

// Genera un'immagine provando il modello configurato e poi i fallback (su 404).
async function generateImage(prompt) {
  const { freepik } = getSettings();
  const chain = [freepik.imageModel, ...(freepik.imageModelFallbacks || [])];
  let lastErr = null;
  for (const model of chain) {
    const basePath = imagePathFor(model);
    const bodies = [
      { prompt, aspect_ratio: freepik.aspectRatio || '9:16', resolution: freepik.resolution || '1k' },
      { prompt, aspect_ratio: freepik.aspectRatio || '9:16' },
      { prompt },
    ];
    for (const body of bodies) {
      const { status, json, text } = await fpRequest('POST', basePath, body);
      if (status === 404) { lastErr = new Error(`Modello ${model} non disponibile (404)`); break; }
      if (status === 400) { lastErr = new Error(`400 su ${model}: ${text.slice(0, 200)}`); continue; }
      if (status >= 401) throw new Error(`Freepik HTTP ${status}: ${text.slice(0, 200)}`);
      const taskId = json?.data?.task_id || json?.task_id;
      // Alcuni modelli rispondono in modo sincrono con le immagini già pronte.
      const direct = json?.data?.generated?.[0]?.url || json?.data?.generated?.[0];
      if (!taskId && direct) return { url: direct, model };
      if (!taskId) { lastErr = new Error(`Risposta inattesa da ${model}: ${text.slice(0, 200)}`); continue; }
      const url = await pollTask(basePath, taskId);
      return { url, model };
    }
  }
  throw lastErr || new Error('Generazione immagine fallita su tutti i modelli');
}

// Genera un video da un'immagine con Kling 2.5 Pro (10s, 720p).
async function generateVideo(imageUrl, prompt) {
  const { freepik } = getSettings();
  const basePath = `/v1/ai/image-to-video/${freepik.videoModel || 'kling-v2-5-pro'}`;
  const { status, json, text } = await fpRequest('POST', basePath, {
    image: imageUrl,
    prompt,
    duration: String(freepik.videoDuration || '10'),
  });
  if (status >= 400) throw new Error(`Freepik video HTTP ${status}: ${text.slice(0, 300)}`);
  const taskId = json?.data?.task_id || json?.task_id;
  if (!taskId) throw new Error(`Nessun task_id dalla richiesta video: ${text.slice(0, 200)}`);
  return pollTask(basePath, taskId, { intervalMs: 15000, timeoutMs: 25 * 60 * 1000 });
}

async function downloadFile(url, destDir, baseName) {
  fs.mkdirSync(destDir, { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`Download fallito HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  const ext = ct.includes('mp4') || url.includes('.mp4') ? '.mp4'
    : ct.includes('png') ? '.png'
    : ct.includes('jpeg') || ct.includes('jpg') ? '.jpg'
    : path.extname(new URL(url).pathname) || '.bin';
  const file = path.join(destDir, baseName + ext);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { generateImage, generateVideo, downloadFile, DIRS };
