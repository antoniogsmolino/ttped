/* TTPED Studio — frontend */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => (n ?? 0).toLocaleString('it-IT');
const fmtEur = (n) => '€' + (n ?? 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5500);
}

/* ---------- tabs ---------- */
const loaders = { trends: loadTrends, studio: loadStudio, affiliate: loadAffiliate, settings: loadSettings };
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  loaders[btn.dataset.tab]();
});

/* =================== TREND =================== */

function sparkline(points, w = 110, h = 34) {
  if (!points || points.length < 2) return '<div class="spark" style="height:34px"></div>';
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const pts = vs.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="sparkgrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fe2c55"/><stop offset="100%" stop-color="#25f4ee"/>
    </linearGradient></defs>
    <polyline points="${pts}"/></svg>`;
}

async function loadTrends() {
  try {
    const { status, top } = await api('/api/trends');
    const meta = [];
    if (status.lastRun) meta.push(`Aggiornato: ${new Date(status.lastRun).toLocaleString('it-IT')}`);
    meta.push(`Fonte: FastMoss · Regione ${status.region || 'IT'} · ${status.count || 0} prodotti tracciati`);
    $('#trendsMeta').textContent = meta.join('  ·  ');

    let banner = '';
    if (status.error) banner = `<div class="banner err">⚠️ Ultimo scraping fallito: ${esc(status.error)}</div>`;
    else if (status.limited && top.length < 20) banner = `<div class="banner">🔒 Trovati ${top.length} prodotti moda donna realmente in trend. Senza cookie FastMoss le liste sono parziali e le ricerche per categoria sono bloccate: registrati gratis su fastmoss.com e incolla il cookie nelle Impostazioni per sbloccare la top 20 completa di categoria.</div>`;
    $('#trendsBanner').innerHTML = banner;

    if (!top.length) {
      $('#trendsGrid').innerHTML = '<div class="empty">Nessun dato ancora. Premi <b>↻ Aggiorna ora</b> per il primo scraping.</div>';
      return;
    }
    $('#trendsGrid').innerHTML = top.map((p, i) => {
      const g = p.trend.spikePct;
      const up = g >= 0;
      return `<div class="pcard" style="animation-delay:${i * 35}ms">
        <div class="rank r${i + 1}">${i + 1}</div>
        <div class="pcard-top">
          <img class="cover" src="${esc(p.cover)}" loading="lazy" onerror="this.style.visibility='hidden'"/>
          <div>
            <div class="title">${esc(p.title)}</div>
            <div class="chips">
              ${p.trend.catLabel ? `<span class="chip cat">👗 ${esc(p.trend.catLabel)}</span>` : ''}
              ${p.price ? `<span class="chip price">${esc(p.price)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="pstats">
          <div class="pstat"><div class="v growth ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(g)}%</div><div class="l">impennata 7gg</div></div>
          <div class="pstat"><div class="v" style="color:var(--cyan)">${p.commissionRate ? p.commissionRate + '%' : '–'}</div><div class="l">commissione</div></div>
          <div class="pstat"><div class="v">${fmtN(p.trend.sold7)}</div><div class="l">vendite 7gg</div></div>
          <div class="pstat">${sparkline(p.trend.spark)}<div class="l">${p.trend.days} gg storico</div></div>
        </div>
        <div class="pcard-actions">
          <button class="btn btn-primary btn-sm" onclick="genVideo('${p.id}', this)">🎬 Genera video</button>
          <a class="btn btn-ghost btn-sm" href="${esc(p.tiktokUrl)}" target="_blank">Vedi su TikTok ↗</a>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    $('#trendsBanner').innerHTML = `<div class="banner err">Errore: ${esc(e.message)}</div>`;
  }
}

$('#btnScrape').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> Scraping…';
  try {
    const st = await api('/api/scrape/run', { method: 'POST' });
    toast(st.ok ? `Scraping completato: ${st.count} prodotti` : `Scraping fallito: ${st.error}`, st.ok ? 'ok' : 'err');
    loadTrends();
  } catch (err) { toast(err.message, 'err'); }
  btn.disabled = false; btn.innerHTML = '↻ Aggiorna ora';
});

window.genVideo = async (productId, btn) => {
  btn.disabled = true; btn.textContent = '⏳ In coda…';
  try {
    await api(`/api/videos/generate/${productId}`, { method: 'POST' });
    toast('Video in generazione! Seguilo nel tab 🎬 Video Studio', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  btn.disabled = false; btn.textContent = '🎬 Genera video';
};

/* =================== STUDIO =================== */

const STEPS = [
  ['queued', 'In coda'], ['image', '🖼 Immagine'], ['video', '🎞 Video Kling'], ['downloading', '⬇ Download'], ['done', '✅ Pronto'],
];

function stepBar(job) {
  const order = STEPS.map(([k]) => k);
  const idx = order.indexOf(job.status === 'error' ? 'queued' : job.status);
  return `<div class="steps">${STEPS.map(([k, label], i) => {
    let cls = '';
    if (job.status === 'error') cls = i === 0 ? 'fail' : '';
    else if (i < idx || job.status === 'done') cls = 'done';
    else if (i === idx) cls = job.status === 'done' ? 'done' : 'now';
    return `<span class="step ${cls}">${label}</span>`;
  }).join('')}${job.status === 'error' ? `<span class="step fail">✕ ${esc((job.error || '').slice(0, 90))}</span>` : ''}</div>`;
}

function pubChip(job) {
  const p = job.publish || {};
  if (p.status === 'published') return `<span class="pub-chip published">✓ Pubblicato${p.when ? ' ' + new Date(p.when).toLocaleString('it-IT') : ''}</span>`;
  if (p.status === 'scheduled') return `<span class="pub-chip scheduled">⏰ Programmato ${new Date(p.when).toLocaleString('it-IT')}</span>`;
  if (p.status === 'publishing') return `<span class="pub-chip scheduled">📤 Pubblicazione…</span>`;
  if (p.status === 'failed') return `<span class="pub-chip failed">✕ ${esc((p.error || 'fallita').slice(0, 70))}</span>`;
  return '';
}

let studioTimer = null;

async function loadStudio() {
  try {
    const [{ jobs, running }, tk] = await Promise.all([api('/api/videos'), api('/api/tiktok/status')]);
    const today = new Date().toISOString().slice(0, 10);
    const doneToday = jobs.filter((j) => j.status === 'done' && (j.doneAt || '').slice(0, 10) === today).length;
    const inProgress = jobs.filter((j) => !['done', 'error'].includes(j.status)).length;
    const published = jobs.filter((j) => j.publish?.status === 'published').length;

    $('#studioKpis').innerHTML = `
      <div class="kpi"><div class="v grad">${doneToday}</div><div class="l">video pronti oggi</div></div>
      <div class="kpi"><div class="v">${inProgress}${running ? ' <span class="spin" style="font-size:14px">⚙️</span>' : ''}</div><div class="l">in lavorazione</div></div>
      <div class="kpi"><div class="v">${jobs.filter((j) => j.status === 'done').length}</div><div class="l">video totali</div></div>
      <div class="kpi"><div class="v">${published}</div><div class="l">pubblicati su TikTok</div></div>`;

    $('#studioBanner').innerHTML = tk.connected
      ? `<div class="banner ok">✓ Account TikTok collegato (privacy: ${esc(tk.privacyLevel)})</div>`
      : (tk.configured
        ? `<div class="banner">TikTok configurato ma non collegato: <a href="/api/tiktok/login" target="_blank" style="color:inherit;font-weight:700">collega l'account →</a></div>`
        : `<div class="banner">Per pubblicare/programmare su TikTok inserisci Client Key e Secret nelle Impostazioni. Il download dei video funziona comunque.</div>`);

    if (!jobs.length) {
      $('#jobsList').innerHTML = '<div class="empty">Nessun video ancora. Premi <b>⚡ Genera i 10 video di oggi</b> oppure scegli un prodotto dal tab 🔥 Trend.</div>';
    } else {
      $('#jobsList').innerHTML = jobs.map((j) => `
        <div class="job">
          <div class="preview">${j.status === 'done' && j.file
            ? `<video src="/media/videos/${esc(j.file)}" controls muted loop></video>`
            : (j.imageUrl ? `<img src="${esc(j.imageUrl)}"/>` : (j.cover ? `<img src="${esc(j.cover)}" style="opacity:.4"/>` : 'anteprima'))}</div>
          <div class="body">
            <div class="jtitle">${esc(j.productTitle)}</div>
            ${stepBar(j)}
            <textarea class="caption" data-id="${j.id}" onchange="saveCaption(this)">${esc(j.caption)}</textarea>
            <div class="actions">
              ${j.status === 'done' ? `
                <a class="btn btn-ghost btn-sm" href="/api/videos/${j.id}/download">⬇ Scarica MP4</a>
                <button class="btn btn-primary btn-sm" onclick="publishNow('${j.id}', this)">📤 Pubblica ora</button>
                <input type="datetime-local" id="dt-${j.id}"/>
                <button class="btn btn-ghost btn-sm" onclick="scheduleVid('${j.id}')">⏰ Programma</button>` : ''}
              ${pubChip(j)}
              <span style="margin-left:auto;color:var(--muted);font-size:11px">${new Date(j.createdAt).toLocaleString('it-IT')}</span>
            </div>
          </div>
        </div>`).join('');
    }

    clearTimeout(studioTimer);
    if (inProgress > 0 && $('#tab-studio').classList.contains('active')) {
      studioTimer = setTimeout(loadStudio, 5000);
    }
  } catch (e) {
    $('#studioBanner').innerHTML = `<div class="banner err">Errore: ${esc(e.message)}</div>`;
  }
}

$('#btnDaily').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await api('/api/videos/generate-daily', { method: 'POST', body: JSON.stringify({}) });
    toast(r.started ? `Avviata la generazione di ${r.count} video 🎬` : r.reason, r.started ? 'ok' : 'err');
    loadStudio();
  } catch (err) { toast(err.message, 'err'); }
  btn.disabled = false;
});

window.saveCaption = async (el) => {
  try { await api(`/api/videos/${el.dataset.id}/caption`, { method: 'POST', body: JSON.stringify({ caption: el.value }) }); toast('Caption salvata', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
};

window.publishNow = async (id, btn) => {
  btn.disabled = true; btn.textContent = '📤 Invio…';
  try { await api(`/api/videos/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }); toast('Video pubblicato su TikTok ✓', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
  loadStudio();
};

window.scheduleVid = async (id) => {
  const when = $(`#dt-${id}`).value;
  if (!when) return toast('Scegli prima data e ora', 'err');
  try { await api(`/api/videos/${id}/publish`, { method: 'POST', body: JSON.stringify({ when }) }); toast('Pubblicazione programmata ⏰ (il tool deve restare aperto)', 'ok'); loadStudio(); }
  catch (e) { toast(e.message, 'err'); }
};

/* =================== AFFILIATE =================== */

function lineChart(series, key, color) {
  if (!series.length) return '';
  const w = 560, h = 170, pad = 28;
  const vs = series.map((p) => p[key]);
  const max = Math.max(...vs) || 1;
  const step = (w - pad * 2) / Math.max(1, series.length - 1);
  const pts = vs.map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`);
  return `<svg class="linechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    <polygon points="${pad},${h - pad} ${pts.join(' ')} ${pad + (series.length - 1) * step},${h - pad}" fill="${color}" opacity="0.08"/>
    <text x="${pad}" y="14" fill="#9a9aa6" font-size="10">max ${max.toLocaleString('it-IT')}</text>
    <text x="${pad}" y="${h - 8}" fill="#9a9aa6" font-size="10">${series[0].date}</text>
    <text x="${w - pad}" y="${h - 8}" fill="#9a9aa6" font-size="10" text-anchor="end">${series[series.length - 1].date}</text>
  </svg>`;
}

function md(line) {
  return esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

async function loadAffiliate() {
  try {
    const a = await api('/api/affiliate/analytics');
    if (!a.totals.orders) {
      $('#affContent').innerHTML = `
        <div class="dropzone" id="dropzone">
          <div style="font-size:34px;margin-bottom:10px">📂</div>
          Trascina qui il CSV degli ordini esportato dal <b>Centro Affiliazione TikTok Shop</b><br/>
          <span style="font-size:12px">(Centro Affiliazione → Dati → Analisi ordini → Esporta)</span>
        </div>`;
      bindDropzone();
      return;
    }
    const s = await api('/api/affiliate/strategy');
    $('#affContent').innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="v grad">${fmtEur(a.totals.commission)}</div><div class="l">commissioni totali</div></div>
        <div class="kpi"><div class="v">${fmtEur(a.totals.gmv)}</div><div class="l">vendite generate (GMV)</div></div>
        <div class="kpi"><div class="v">${fmtN(a.totals.orders)}</div><div class="l">ordini validi</div></div>
        <div class="kpi"><div class="v">${a.totals.avgRate ?? '–'}%</div><div class="l">commissione media</div></div>
        <div class="kpi"><div class="v">${fmtN(a.totals.cancelled)}</div><div class="l">annullati / resi</div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><h3>📈 Commissioni per giorno</h3>${lineChart(a.series, 'commission', '#25f4ee')}</div>
      <div class="aff-grid">
        <div class="card">
          <h3>🏆 Top prodotti per commissioni</h3>
          <table><tr><th>Prodotto</th><th class="num">Ordini</th><th class="num">GMV</th><th class="num">Commissioni</th><th class="num">Rate</th></tr>
          ${a.byProduct.slice(0, 12).map((p) => `<tr><td class="tname" title="${esc(p.name)}">${esc(p.name)}</td><td class="num">${p.orders}</td><td class="num">${fmtEur(p.gmv)}</td><td class="num" style="color:var(--cyan);font-weight:700">${fmtEur(p.commission)}</td><td class="num">${p.avgRate ?? '–'}%</td></tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h3>🤝 Top seller</h3>
          <table><tr><th>Negozio</th><th class="num">Ordini</th><th class="num">Commissioni</th><th class="num">Rate</th></tr>
          ${a.byShop.slice(0, 12).map((p) => `<tr><td class="tname" title="${esc(p.name)}">${esc(p.name)}</td><td class="num">${p.orders}</td><td class="num" style="color:var(--cyan);font-weight:700">${fmtEur(p.commission)}</td><td class="num">${p.avgRate ?? '–'}%</td></tr>`).join('')}
          </table>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🧠 Strategia per massimizzare le vendite affiliate</h3>
        ${s.ready ? s.sections.map((sec) => `
          <div class="strategy-section">
            <h4>${sec.icon} ${esc(sec.title)}</h4>
            ${sec.lines.map((l) => `<p>${md(l)}</p>`).join('')}
          </div>`).join('') : `<p class="sub">${esc(s.message)}</p>`}
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
        <span class="hint">File importati: ${a.files.map((f) => `${esc(f.name)} (${f.added} nuovi)`).join(', ') || 'nessuno'}</span>
        <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="resetAffiliate()">🗑 Azzera dati</button>
      </div>`;
  } catch (e) {
    $('#affBanner').innerHTML = `<div class="banner err">Errore: ${esc(e.message)}</div>`;
  }
}

async function importFiles(files) {
  for (const file of files) {
    try {
      const text = await file.text();
      const r = await api(`/api/affiliate/import?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'content-type': 'text/csv' }, body: text,
      });
      toast(`${file.name}: ${r.added} ordini nuovi (${r.skipped} duplicati saltati)`, 'ok');
    } catch (e) { toast(`${file.name}: ${e.message}`, 'err'); }
  }
  loadAffiliate();
}

$('#csvInput').addEventListener('change', (e) => importFiles([...e.target.files]));

function bindDropzone() {
  const dz = $('#dropzone');
  if (!dz) return;
  dz.addEventListener('click', () => $('#csvInput').click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
}

window.resetAffiliate = async () => {
  if (!confirm('Eliminare tutti i dati affiliate importati?')) return;
  await api('/api/affiliate/reset', { method: 'POST' });
  loadAffiliate();
};

/* =================== IMPOSTAZIONI =================== */

async function loadSettings() {
  const s = await api('/api/settings');
  $('#settingsForm').innerHTML = `
    <div class="card">
      <h3>🍌 Freepik API (immagini + video)</h3>
      <div class="field"><label>API Key</label><input id="set-fp-key" type="password" value="${esc(s.freepik.apiKey)}" placeholder="FPSX…"/></div>
      <div class="field"><label>Modello immagine</label>
        <select id="set-fp-img">
          ${['nano-banana-2', 'nano-banana-pro', 'gemini-2-5-flash-image-preview'].map((m) => `<option ${s.freepik.imageModel === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></div>
      <div class="field"><label>Modello video</label>
        <select id="set-fp-vid">
          ${['kling-v2-5-pro', 'kling-v2-1-pro', 'kling-v2'].map((m) => `<option ${s.freepik.videoModel === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></div>
      <p class="hint">⚠️ L'API Freepik usa <b>crediti API a consumo</b>, fatturati separatamente dal piano Unlimited della webapp. Chiave: <a href="https://www.freepik.com/developers/dashboard/api-key" target="_blank">freepik.com/developers</a></p>
    </div>
    <div class="card">
      <h3>🎵 TikTok (pubblicazione)</h3>
      <div class="field"><label>Client Key</label><input id="set-tt-key" value="${esc(s.tiktok.clientKey)}"/></div>
      <div class="field"><label>Client Secret</label><input id="set-tt-secret" type="password" value="${esc(s.tiktok.clientSecret)}"/></div>
      <div class="field"><label>Privacy dei post</label>
        <select id="set-tt-privacy">
          ${['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS'].map((p) => `<option ${s.tiktok.privacyLevel === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select></div>
      <div><a class="btn btn-ghost btn-sm" href="/api/tiktok/login" target="_blank">🔗 Collega account TikTok</a></div>
      <p class="hint">Crea un'app su <a href="https://developers.tiktok.com" target="_blank">developers.tiktok.com</a> con scope <b>video.publish</b>. Finché l'app non è approvata da TikTok, i post sono forzati a SELF_ONLY (visibili solo a te). Redirect URI da registrare: <b>http://127.0.0.1:4280/api/tiktok/callback</b></p>
    </div>
    <div class="card">
      <h3>📡 Scraping trend</h3>
      <div class="field"><label>Regione TikTok Shop</label>
        <select id="set-region">${['IT', 'US', 'GB', 'ES', 'FR', 'DE', 'ID', 'TH', 'VN', 'MY', 'PH', 'SG', 'MX', 'BR'].map((r) => `<option ${s.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label>Focus categorie moda donna</label>
        <select id="set-focus"><option value="1" ${s.categoryFocus?.enabled !== false ? 'selected' : ''}>Attivo — solo abbigliamento, pantaloni, top, abiti e accessori donna</option><option value="0" ${s.categoryFocus?.enabled === false ? 'selected' : ''}>Disattivo — tutte le categorie</option></select></div>
      <div class="field"><label>Keyword di ricerca categoria (con cookie)</label><input id="set-keywords" value="${esc((s.searchKeywords || []).join(', '))}"/></div>
      <div class="field"><label>Accesso FastMoss (per classifica completa di categoria)</label><textarea id="set-fm-cookie" class="caption" rows="3" placeholder="Incolla qui il comando 'Copy as cURL' di una richiesta www.fastmoss.com/api/… (DevTools → Network → tasto destro → Copy → Copy as cURL). In alternativa va bene anche il solo header Cookie.">${esc(s.fastmossCookie)}</textarea></div>
      <div class="field"><label>Orario scraping giornaliero (cron)</label><input id="set-cron-scrape" value="${esc(s.scrapeCron)}"/></div>
      <p class="hint">Formato cron: <b>30 7 * * *</b> = ogni giorno alle 7:30 (fuso ${esc(s.timezone)}).</p>
    </div>
    <div class="card">
      <h3>⚡ Automazione video</h3>
      <div class="field"><label>Video al giorno</label><input id="set-daily-count" type="number" min="1" max="30" value="${s.dailyVideoCount}"/></div>
      <div class="field"><label>Orario generazione (cron)</label><input id="set-cron-video" value="${esc(s.videoCron)}"/></div>
      <p class="hint">Ogni giorno il tool sceglie i top prodotti in crescita non ancora coperti e genera automaticamente i video. Il Mac deve essere acceso con TTPED Studio in esecuzione.</p>
    </div>`;
}

$('#btnSaveSettings').addEventListener('click', async () => {
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        region: $('#set-region').value,
        dailyVideoCount: Number($('#set-daily-count').value) || 10,
        scrapeCron: $('#set-cron-scrape').value,
        videoCron: $('#set-cron-video').value,
        fastmossCookie: $('#set-fm-cookie').value,
        categoryFocus: { enabled: $('#set-focus').value === '1' },
        searchKeywords: $('#set-keywords').value.split(',').map((k) => k.trim()).filter(Boolean),
        freepik: { apiKey: $('#set-fp-key').value, imageModel: $('#set-fp-img').value, videoModel: $('#set-fp-vid').value },
        tiktok: { clientKey: $('#set-tt-key').value, clientSecret: $('#set-tt-secret').value, privacyLevel: $('#set-tt-privacy').value },
      }),
    });
    toast('Impostazioni salvate ✓', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

/* ---------- stato globale ---------- */
async function refreshTopStatus() {
  try {
    const { status } = await api('/api/trends');
    $('#topStatus').innerHTML = `<span class="dot ${status.ok ? '' : 'off'}"></span> ${status.ok ? 'dati aggiornati' : 'in attesa di dati'}`;
  } catch {
    $('#topStatus').innerHTML = '<span class="dot off"></span> server non raggiungibile';
  }
}

loadTrends();
refreshTopStatus();
setInterval(refreshTopStatus, 60000);
