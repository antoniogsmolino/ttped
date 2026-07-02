/* TTPED Studio — frontend statico (GitHub Pages). Niente backend:
   i trend arrivano da data/trends.json (aggiornato ogni giorno da GitHub Actions),
   l'affiliate gira interamente nel browser (CSV + localStorage). */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => (n ?? 0).toLocaleString('it-IT');
const fmtEur = (n) => '€' + (n ?? 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STORAGE_KEY = 'ttped_affiliate_orders';

let trendsRankings = {}; // { sharon:{abbigliamento:{migliori,emergenti},...}, alena:{...} }
let trendsTopByCreator = {}; // { sharon:[...], alena:[...] } per il cross-match affiliate
const CREATORS = (window.Models && Models.CREATORS) || [];
const SECTIONS = (window.Models && Models.MODELS) || [];
let currentCreator = CREATORS.length ? CREATORS[0].id : 'sharon';
let currentSection = SECTIONS.length ? SECTIONS[0].id : 'abbigliamento';
let currentView = 'migliori';
let affCreator = currentCreator; // creator selezionato nel tab Affiliate
const VIEW_LABELS = { migliori: 'Migliori', emergenti: 'Emergenti', foryou: 'Per te' };

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5500);
}

/* ---------- tabs: 2 creator + Affiliate ---------- */
function buildNav() {
  const tabs = $('#tabs');
  const creatorBtns = CREATORS.map((c, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-creator="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('');
  tabs.innerHTML = creatorBtns + '<button class="tab" data-tab="affiliate">💰 Affiliate</button>';
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t === btn));
  if (btn.dataset.creator) {
    currentCreator = btn.dataset.creator;
    showPanel('trends');
    renderSectionTabs();
    renderCreatorHeader();
    renderRanking();
  } else {
    showPanel('affiliate');
    loadAffiliate();
  }
});

// Selettore sezioni (Abbigliamento/Accessori/Intimo) dentro il tab del creator.
function renderSectionTabs() {
  $('#sectionTabs').innerHTML = SECTIONS.map((s) =>
    `<button class="seg-btn${s.id === currentSection ? ' active' : ''}" data-section="${s.id}">${s.emoji} ${esc(s.name)}</button>`).join('');
}
$('#sectionTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  currentSection = btn.dataset.section;
  renderSectionTabs();
  renderCreatorHeader();
  renderRanking();
});

function renderCreatorHeader() {
  const c = CREATORS.find((x) => x.id === currentCreator);
  const s = SECTIONS.find((x) => x.id === currentSection);
  if (!c || !s) return;
  $('#modelTitle').innerHTML = `${c.emoji} ${esc(c.name)} <span class="accent">· ${esc(s.name)}</span>`;
  $('#modelDesc').textContent = `${c.tag} — ${s.desc}`;
}

/* =================== TREND =================== */

function sparkline(points, w = 110, h = 34) {
  if (!points || points.length < 2) return '<div class="spark" style="height:34px"></div>';
  const vs = points.map((p) => (typeof p === 'number' ? p : p.v)); // accetta numeri o {v}
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
    const res = await fetch('data/trends.json?t=' + Date.now());
    if (!res.ok) throw new Error('Dati trend non ancora disponibili');
    const data = await res.json();
    const status = data.status;
    trendsRankings = data.rankings || {};
    trendsTopByCreator = data.top || {};
    setTopStatus(status);

    const meta = [];
    const when = data.generatedAt || status?.lastRun;
    if (when) meta.push(`Aggiornato: ${new Date(when).toLocaleString('it-IT')}`);
    meta.push(`Fonte: FastMoss · ${status?.region || 'IT'} · ${status?.matched ?? status?.count ?? 0} prodotti classificati`);
    meta.push('aggiornamento automatico ogni mattina');
    $('#trendsMeta').textContent = meta.join('  ·  ');

    let banner = '';
    if (status?.error) banner = `<div class="banner err">⚠️ Ultimo aggiornamento fallito: ${esc(status.error)}</div>`;
    else if (status?.limited) banner = `<div class="banner">🔒 Cookie FastMoss assente o scaduto: classifica parziale. Aggiorna il Secret FASTMOSS_COOKIE su GitHub.</div>`;
    $('#trendsBanner').innerHTML = banner;

    renderSectionTabs();
    renderCreatorHeader();
    renderRanking();
  } catch (e) {
    $('#trendsBanner').innerHTML = `<div class="banner err">${esc(e.message)}</div>`;
    $('#trendsGrid').innerHTML = '<div class="empty">In attesa del primo aggiornamento giornaliero.</div>';
  }
}

// Profilo storico di UN creator per UNA sezione: usa solo i suoi ordini, classificati per nome.
function getProfile(creator, section) {
  try {
    const orders = getOrdersFor(creator);
    if (!orders.length || !window.Models) return null;
    const sub = orders.filter((o) => Models.classify(o.productName, [], o.amount || 0, null).model === section);
    return sub.length ? Affiliate.profile(sub) : null;
  } catch { return null; }
}

// Le pagine prodotto di TikTok Shop sono deep-link per l'app e bloccate per regione sul web (502).
// La ricerca per nome è affidabile (da loggati) e mostra i video già fatti sul capo: utile per i contenuti.
function tiktokSearchUrl(title) {
  const q = (title || '')
    .replace(/\[[^\]]*\]/g, ' ')        // togli i tag tra parentesi quadre [BRAND]
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')  // togli punteggiatura/simboli
    .trim().split(/\s+/).slice(0, 6).join(' ');
  return 'https://www.tiktok.com/search?q=' + encodeURIComponent(q);
}

function cardHTML(p, i, winLabel, match) {
  const t = p.trend;
  const g = t.spikePct, up = g >= 0;
  const sat = [];
  if (t.creators) sat.push(`👤 ${fmtN(t.creators)}`);
  if (t.videos) sat.push(`🎬 ${fmtN(t.videos)}`);
  const matchPill = match ? `<div class="match-pill">🎯 ${esc(match.reasons[0] || 'in linea col tuo storico')}</div>` : '';
  return `<div class="pcard" style="animation-delay:${i * 35}ms">
    <div class="pcard-media">
      <img class="cover" src="${esc(p.cover)}" loading="lazy" decoding="async" alt="${esc(p.title)}" onerror="this.style.opacity=0"/>
      <div class="media-scrim"></div>
      <div class="rank r${i + 1}">${i + 1}</div>
      <div class="spike-pill ${up ? 'up' : 'down'}" title="impennata ${winLabel}">${up ? '▲' : '▼'} ${Math.abs(g)}%</div>
      ${matchPill}
    </div>
    <div class="pcard-body">
      <div class="title">${esc(p.title)}</div>
      <div class="chips">
        ${t.catLabel ? `<span class="chip cat">🏷 ${esc(t.catLabel)}</span>` : ''}
        ${p.price ? `<span class="chip price">${esc(p.price)}</span>` : ''}
        ${p.commissionRate ? `<span class="chip comm">${p.commissionRate}% comm.</span>` : ''}
      </div>
      <div class="pstats">
        <div class="pstat"><div class="v">${fmtN(t.sold7)}</div><div class="l">vendite 7gg</div></div>
        <div class="pstat"><div class="v earn">${t.euroPerSale ? fmtEur(t.euroPerSale) : '–'}</div><div class="l">€/vendita</div></div>
        <div class="pstat"><div class="v">${t.marketComm ? '€' + fmtN(t.marketComm) : '–'}</div><div class="l">comm./sett mercato</div></div>
      </div>
      <div class="pmeta">
        <span class="sat">${sat.length ? sat.join(' · ') + ' lo vendono' : 'concorrenza n/d'}</span>
        ${sparkline(t.spark, 84, 28)}
      </div>
      <div class="pcard-actions">
        <a class="btn btn-primary btn-sm" href="${esc(tiktokSearchUrl(p.title))}" target="_blank" rel="noopener">🔍 Cerca su TikTok</a>
        <a class="btn btn-ghost btn-sm" href="${esc(p.fastmossUrl)}" target="_blank" rel="noopener">Dettagli ↗</a>
      </div>
    </div>
  </div>`;
}

function renderRanking() {
  const winLabel = VIEW_LABELS[currentView] || '';
  const modelR = (trendsRankings[currentCreator] || {})[currentSection] || { migliori: [], emergenti: [] };
  const profile = getProfile(currentCreator, currentSection);

  // Vista "Per te": incrocia le classifiche della sezione col tuo storico di vendite di QUELLA sezione.
  if (currentView === 'foryou') {
    if (!profile) {
      $('#trendsGrid').innerHTML = '<div class="empty">🎯 <b>Per te</b> incrocia questa sezione col tuo storico di vendite.<br/>Importa gli ordini nel tab <b>💰 Affiliate</b>: il sistema riconosce dai nomi prodotto quali vendite appartengono a questa sezione.</div>';
      return;
    }
    const seen = new Map();
    for (const w of ['migliori', 'emergenti']) for (const p of (modelR[w] || [])) if (!seen.has(p.id)) seen.set(p.id, p);
    const pool = [...seen.values()]
      .map((p) => ({ p, m: Affiliate.personalMatch(p.title, p.trend.priceValue, profile) }))
      .filter((x) => x.m && x.m.score > 0.15)
      .sort((a, b) => (b.m.score - a.m.score) || (b.p.trend.marketComm - a.p.trend.marketComm));
    if (!pool.length) {
      $('#trendsGrid').innerHTML = '<div class="empty">Nessun prodotto in trend somiglia ancora ai tuoi vincenti di questa nicchia. Importa più ordini o riprova domani.</div>';
      return;
    }
    $('#trendsGrid').innerHTML = pool.slice(0, 20).map((x, i) => cardHTML(x.p, i, VIEW_LABELS.migliori, x.m)).join('');
    return;
  }

  const list = modelR[currentView] || [];
  if (!list.length) {
    $('#trendsGrid').innerHTML = `<div class="empty">Nessun prodotto con dati sufficienti per la finestra ${winLabel} in questa nicchia. Lo storico si arricchisce ogni giorno.</div>`;
    return;
  }
  $('#trendsGrid').innerHTML = list.map((p, i) => {
    const m = profile ? Affiliate.personalMatch(p.title, p.trend.priceValue, profile) : null;
    return cardHTML(p, i, winLabel, m && m.score >= 0.4 ? m : null);
  }).join('');
}

$('#trendWindows').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  currentView = btn.dataset.win;
  document.querySelectorAll('#trendWindows .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderRanking();
});

$('#btnReload').addEventListener('click', () => { loadTrends(); toast('Dati ricaricati', 'ok'); });

/* =================== AFFILIATE (client-side) =================== */

// Ordini separati per creator (Sharon/Alena non si mischiano).
const storeKey = (creator) => `${STORAGE_KEY}_${creator}`;
function getOrdersFor(creator) {
  try { return JSON.parse(localStorage.getItem(storeKey(creator)) || '[]'); } catch { return []; }
}
function setOrdersFor(creator, orders) { localStorage.setItem(storeKey(creator), JSON.stringify(orders)); }
// Il tab Affiliate lavora sul creator selezionato (affCreator).
const getOrders = () => getOrdersFor(affCreator);
const setOrders = (orders) => setOrdersFor(affCreator, orders);

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

const md = (line) => esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// Ripartizione commissioni per sezione: classifica ogni ordine dal nome prodotto.
function modelBreakdownHTML(orders) {
  if (!window.Models) return '';
  const byModel = {};
  for (const m of SECTIONS) byModel[m.id] = { orders: 0, commission: 0 };
  let other = { orders: 0, commission: 0 };
  for (const o of orders) {
    if (/cancel|annull|refund|rimbors|reso|return/i.test(o.status || '')) continue;
    const c = o.actualCommission || o.estCommission || 0;
    const r = Models.classify(o.productName, [], o.amount || 0, null);
    const bucket = r.model ? byModel[r.model] : other;
    bucket.orders++; bucket.commission += c;
  }
  const cards = SECTIONS.map((m) => {
    const b = byModel[m.id];
    return `<div class="kpi"><div class="v" style="font-size:20px">${m.emoji} ${fmtEur(b.commission)}</div>
      <div class="l">${esc(m.name)} · ${b.orders} ordini</div></div>`;
  }).join('');
  const otherCard = other.orders ? `<div class="kpi"><div class="v" style="font-size:20px;color:var(--muted)">${fmtEur(other.commission)}</div><div class="l">non classificati · ${other.orders}</div></div>` : '';
  return `<div class="card" style="margin-bottom:16px"><h3>👗 Commissioni per sezione</h3>
    <div class="kpi-row" style="margin:0">${cards}${otherCard}</div></div>`;
}

// Selettore creator in cima al tab Affiliate: i dati di Sharon e Alena restano separati.
function affCreatorSelectorHTML() {
  return `<div class="seg" style="margin-bottom:16px" id="affCreatorSel">${CREATORS.map((c) =>
    `<button class="seg-btn${c.id === affCreator ? ' active' : ''}" data-affcreator="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('')}</div>`;
}

function loadAffiliate() {
  const orders = getOrders();
  if (!orders.length) {
    $('#affContent').innerHTML = affCreatorSelectorHTML() + `
      <div class="dropzone" id="dropzone">
        <div style="font-size:34px;margin-bottom:10px">📂</div>
        Ordini di <b>${esc((CREATORS.find((c) => c.id === affCreator) || {}).name || '')}</b> — trascina qui il file (<b>CSV o Excel .xlsx</b>) esportato dal <b>Centro Affiliazione TikTok Shop</b><br/>
        <span style="font-size:12px">(Centro Affiliazione → Dati → Analisi ordini → Esporta) · i dati restano sul tuo dispositivo · hai già un <b>backup .json</b>? Importalo qui.</span>
      </div>`;
    bindDropzone();
    bindAffCreatorSel();
    return;
  }
  const a = Affiliate.analytics(orders);
  const s = Affiliate.strategy(orders, trendsTopByCreator[affCreator] || []);
  $('#affContent').innerHTML = affCreatorSelectorHTML() + `
    <div class="kpi-row">
      <div class="kpi"><div class="v grad">${fmtEur(a.totals.commission)}</div><div class="l">commissioni totali</div></div>
      <div class="kpi"><div class="v">${fmtEur(a.totals.gmv)}</div><div class="l">vendite generate (GMV)</div></div>
      <div class="kpi"><div class="v">${fmtN(a.totals.orders)}</div><div class="l">ordini validi</div></div>
      <div class="kpi"><div class="v">${a.totals.avgRate ?? '–'}%</div><div class="l">commissione media</div></div>
      <div class="kpi"><div class="v">${fmtN(a.totals.cancelled)}</div><div class="l">annullati / resi</div></div>
    </div>
    ${modelBreakdownHTML(orders)}
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
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span class="hint">${orders.length} ordini salvati su questo dispositivo</span>
      <label class="btn btn-ghost btn-sm" for="csvInput2">⬆ Aggiungi file</label>
      <input type="file" id="csvInput2" accept=".csv,.xlsx,.json,text/csv,application/json" hidden multiple />
      <button class="btn btn-ghost btn-sm" onclick="exportBackup()">💾 Esporta backup</button>
      <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="resetAffiliate()">🗑 Azzera dati</button>
    </div>
    <p class="hint" style="margin-top:8px">📱 I dati restano su questo dispositivo (non vanno mai online). Per averli anche altrove: <b>Esporta backup</b> qui, poi importa il file <code>.json</code> sull'altro dispositivo.</p>`;
  const extra = $('#csvInput2');
  if (extra) extra.addEventListener('change', (e) => importFiles([...e.target.files]));
  bindAffCreatorSel();
}

// Cambio creator nel tab Affiliate.
function bindAffCreatorSel() {
  const sel = $('#affCreatorSel');
  if (!sel) return;
  sel.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    affCreator = b.dataset.affcreator;
    loadAffiliate();
  });
}

window.exportBackup = () => {
  const orders = getOrders();
  if (!orders.length) return toast('Nessun dato da esportare', 'err');
  const blob = new Blob([JSON.stringify({ type: 'ttped-affiliate-backup', version: 1, orders }, null, 0)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ttped-affiliate-backup.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup esportato: importalo sull\'altro dispositivo', 'ok');
};

async function importFiles(files) {
  let orders = getOrders();
  const existing = new Set(orders.map((o) => o.orderId));
  for (const file of files) {
    try {
      const isXlsx = /\.xlsx$/i.test(file.name) || /sheet|excel/i.test(file.type);
      const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';
      let parsed;
      if (isJson) {
        const data = JSON.parse(await file.text()); // backup TTPED
        parsed = Array.isArray(data) ? data : (data.orders || []);
        if (!parsed.length) throw new Error('backup vuoto o non valido');
      } else if (isXlsx) {
        ({ orders: parsed } = await Affiliate.parseXlsx(await file.arrayBuffer()));
      } else {
        ({ orders: parsed } = Affiliate.parse(await file.text()));
      }
      let added = 0;
      for (const o of parsed) { if (!existing.has(o.orderId)) { orders.push(o); existing.add(o.orderId); added++; } }
      toast(`${file.name}: ${added} ordini nuovi (${parsed.length - added} duplicati)`, 'ok');
    } catch (e) { toast(`${file.name}: ${e.message}`, 'err'); }
  }
  setOrders(orders);
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

window.resetAffiliate = () => {
  if (!confirm('Eliminare tutti i dati affiliate da questo dispositivo?')) return;
  localStorage.removeItem(STORAGE_KEY);
  loadAffiliate();
};

/* ---------- stato globale (riusa i dati già caricati: niente secondo download) ---------- */
function setTopStatus(status) {
  const ok = status?.ok;
  $('#topStatus').innerHTML = `<span class="dot ${ok ? '' : 'off'}"></span> ${ok ? 'dati aggiornati' : 'in attesa di dati'}`;
}

buildNav();
loadTrends();
