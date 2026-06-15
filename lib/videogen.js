// Orchestrazione: dai prodotti trending ai video pronti da pubblicare.
// Pipeline per ogni prodotto: prompt -> immagine (Nano Banana) -> video (Kling 2.5) -> download mp4.
const path = require('path');
const crypto = require('crypto');
const { FILES, DIRS, readJSON, writeJSON, getSettings } = require('./store');
const { computeTrends } = require('./scraper');
const freepik = require('./freepik');

let running = false;

const IMAGE_TEMPLATES = [
  (t) => `Vertical 9:16 UGC-style product photo of ${t}, held in hands in a bright modern home, natural daylight, authentic smartphone look, crisp focus on the product, TikTok aesthetic, no text, no watermark`,
  (t) => `Vertical 9:16 studio product shot of ${t} on a pastel podium with soft shadows, vibrant gradient background in pink and cyan, premium e-commerce look, ultra detailed, no text`,
  (t) => `Vertical 9:16 lifestyle scene featuring ${t} in everyday use, cozy interior, golden hour light, shallow depth of field, photorealistic, social media ready, no text, no watermark`,
  (t) => `Vertical 9:16 dramatic close-up macro shot of ${t}, glossy surfaces, neon rim lighting in magenta and teal, dark background, eye-catching thumbnail style, no text`,
];

const MOTION_TEMPLATES = [
  'Slow cinematic camera push-in on the product, subtle parallax, soft light flares, smooth professional motion',
  'Gentle 360-degree orbit around the product, studio lighting shifting softly, premium commercial feel',
  'Handheld-style subtle movement, product being rotated to show details, natural and authentic UGC motion',
  'Smooth dolly-out reveal of the product with light particles floating, elegant advertising motion',
];

const HOOKS = [
  'Questo prodotto sta esplodendo su TikTok Shop 🔥',
  'Non comprarlo prima di aver visto questo 👀',
  'Il prodotto più virale del momento 🚀',
  'Tutti lo stanno comprando su TikTok Shop 🤯',
  'POV: hai trovato il gadget perfetto ✨',
];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function buildCaption(product, seed) {
  const tag = ((product.cats && product.cats[0]) || '').toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, '');
  const tags = ['#tiktokshop', '#perte', '#fyp', '#viral', tag ? `#${tag}` : '#trend'];
  const title = product.title.length > 60 ? product.title.slice(0, 57) + '…' : product.title;
  return `${pick(HOOKS, seed)} ${title} ${tags.join(' ')}`;
}

function listJobs() {
  return readJSON(FILES.videos, []);
}

function saveJobs(jobs) {
  writeJSON(FILES.videos, jobs);
}

function updateJob(id, patch) {
  const jobs = listJobs();
  const i = jobs.findIndex((j) => j.id === id);
  if (i >= 0) {
    jobs[i] = { ...jobs[i], ...patch };
    saveJobs(jobs);
    return jobs[i];
  }
  return null;
}

function createJob(product) {
  const seed = crypto.randomInt(0, 1000);
  const job = {
    id: crypto.randomUUID(),
    productId: product.id,
    productTitle: product.title,
    cover: product.cover,
    imagePrompt: pick(IMAGE_TEMPLATES, seed)(product.title),
    motionPrompt: pick(MOTION_TEMPLATES, seed + 1),
    caption: buildCaption(product, seed),
    status: 'queued', // queued -> image -> video -> downloading -> done | error
    error: null,
    imageUrl: null,
    imageModel: null,
    file: null,
    createdAt: new Date().toISOString(),
    doneAt: null,
    publish: { status: 'none', when: null, publishId: null, error: null },
  };
  const jobs = listJobs();
  jobs.unshift(job);
  saveJobs(jobs);
  return job;
}

async function processJob(id) {
  let job = listJobs().find((j) => j.id === id);
  if (!job) return;
  try {
    updateJob(id, { status: 'image', error: null });
    const img = await freepik.generateImage(job.imagePrompt);
    job = updateJob(id, { imageUrl: img.url, imageModel: img.model, status: 'video' });

    const videoUrl = await freepik.generateVideo(img.url, job.motionPrompt);
    updateJob(id, { status: 'downloading' });

    const file = await freepik.downloadFile(videoUrl, DIRS.videos, job.id);
    updateJob(id, { status: 'done', file: path.basename(file), doneAt: new Date().toISOString() });
  } catch (e) {
    updateJob(id, { status: 'error', error: e.message });
  }
}

// Genera i video del giorno per i top prodotti in trend (salta quelli già coperti di recente).
async function runDailyGeneration(countOverride) {
  if (running) return { started: false, reason: 'Generazione già in corso' };
  const settings = getSettings();
  const count = countOverride || settings.dailyVideoCount || 10;
  const trends = computeTrends(40);
  if (trends.length === 0) return { started: false, reason: 'Nessun prodotto in trend: esegui prima lo scraping' };

  const jobs = listJobs();
  const cutoff = Date.now() - 3 * 86400000;
  const recentlyCovered = new Set(
    jobs.filter((j) => j.status !== 'error' && new Date(j.createdAt).getTime() > cutoff).map((j) => j.productId)
  );

  const targets = trends.filter((p) => !recentlyCovered.has(p.id)).slice(0, count);
  if (targets.length === 0) return { started: false, reason: 'Tutti i prodotti in trend hanno già un video recente' };

  const created = targets.map((p) => createJob(p));
  running = true;
  (async () => {
    try {
      for (const job of created) {
        await processJob(job.id);
      }
    } finally {
      running = false;
    }
  })();
  return { started: true, count: created.length, jobIds: created.map((j) => j.id) };
}

// Genera un singolo video per un prodotto specifico (dal pulsante in dashboard).
async function generateForProduct(productId) {
  const trends = computeTrends(100);
  const products = readJSON(FILES.products, {});
  const product = trends.find((p) => p.id === productId) || products[productId];
  if (!product) throw new Error('Prodotto non trovato');
  const job = createJob(product);
  processJob(job.id); // fire-and-forget: lo stato si segue dalla UI
  return job;
}

function isRunning() {
  return running;
}

module.exports = { listJobs, updateJob, runDailyGeneration, generateForProduct, isRunning };
