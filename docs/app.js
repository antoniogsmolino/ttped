/* TTPED Studio — frontend statico (GitHub Pages). Niente backend:
   i trend arrivano da data/trends.json (aggiornato ogni giorno da GitHub Actions),
   l'affiliate gira interamente nel browser (CSV + localStorage). */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => (n ?? 0).toLocaleString('it-IT');
const fmtEur = (n) => '€' + (n ?? 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STORAGE_KEY = 'ttped_affiliate_orders';

let trendsTop = []; // cache dei trend per il cross-match affiliate

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5500);
}

/* ---------- tabs ---------- */
const loaders = { trends: loadTrends, affiliate: loadAffiliate };
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
    const res = await fetch('data/trends.json?t=' + Date.now());
    if (!res.ok) throw new Error('Dati trend non ancora disponibili');
    const { status, top, generatedAt } = await res.json();
    trendsTop = top || [];

    const meta = [];
    const when = generatedAt || status?.lastRun;
    if (when) meta.push(`Aggiornato: ${new Date(when).toLocaleString('it-IT')}`);
    meta.push(`Fonte: FastMoss · Regione ${status?.region || 'IT'} · ${status?.matched ?? status?.count ?? 0} prodotti moda donna`);
    meta.push('Aggiornamento automatico ogni mattina');
    $('#trendsMeta').textContent = meta.join('  ·  ');

    let banner = '';
    if (status?.error) banner = `<div class="banner err">⚠️ Ultimo aggiornamento fallito: ${esc(status.error)}</div>`;
    else if (status?.limited && (top || []).length < 20) banner = `<div class="banner">🔒 Cookie FastMoss assente o scaduto: classifica parziale. Aggiorna il Secret FASTMOSS_COOKIE su GitHub.</div>`;
    $('#trendsBanner').innerHTML = banner;

    if (!trendsTop.length) {
      $('#trendsGrid').innerHTML = '<div class="empty">Nessun dato ancora. Il primo aggiornamento popolerà la classifica.</div>';
      return;
    }
    $('#trendsGrid').innerHTML = trendsTop.map((p, i) => {
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
          <a class="btn btn-primary btn-sm" href="${esc(p.tiktokUrl)}" target="_blank">Vedi su TikTok ↗</a>
          <a class="btn btn-ghost btn-sm" href="${esc(p.fastmossUrl)}" target="_blank">Dettagli ↗</a>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    $('#trendsBanner').innerHTML = `<div class="banner err">${esc(e.message)}</div>`;
    $('#trendsGrid').innerHTML = '<div class="empty">In attesa del primo aggiornamento giornaliero.</div>';
  }
}

$('#btnReload').addEventListener('click', () => { loadTrends(); toast('Dati ricaricati', 'ok'); });

/* =================== AFFILIATE (client-side) =================== */

function getOrders() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function setOrders(orders) { localStorage.setItem(STORAGE_KEY, JSON.stringify(orders)); }

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

function loadAffiliate() {
  const orders = getOrders();
  if (!orders.length) {
    $('#affContent').innerHTML = `
      <div class="dropzone" id="dropzone">
        <div style="font-size:34px;margin-bottom:10px">📂</div>
        Trascina qui il CSV degli ordini esportato dal <b>Centro Affiliazione TikTok Shop</b><br/>
        <span style="font-size:12px">(Centro Affiliazione → Dati → Analisi ordini → Esporta) · i dati restano sul tuo dispositivo</span>
      </div>`;
    bindDropzone();
    return;
  }
  const a = Affiliate.analytics(orders);
  const s = Affiliate.strategy(orders, trendsTop);
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
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span class="hint">${orders.length} ordini in memoria sul dispositivo</span>
      <label class="btn btn-ghost btn-sm" for="csvInput2">⬆ Aggiungi altro CSV</label>
      <input type="file" id="csvInput2" accept=".csv,text/csv" hidden multiple />
      <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="resetAffiliate()">🗑 Azzera dati</button>
    </div>`;
  const extra = $('#csvInput2');
  if (extra) extra.addEventListener('change', (e) => importFiles([...e.target.files]));
}

async function importFiles(files) {
  let orders = getOrders();
  const existing = new Set(orders.map((o) => o.orderId));
  for (const file of files) {
    try {
      const text = await file.text();
      const { orders: parsed } = Affiliate.parse(text);
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

/* ---------- stato globale ---------- */
async function refreshTopStatus() {
  try {
    const res = await fetch('data/trends.json?t=' + Date.now());
    const d = await res.json();
    const ok = d.status?.ok;
    $('#topStatus').innerHTML = `<span class="dot ${ok ? '' : 'off'}"></span> ${ok ? 'dati aggiornati' : 'in attesa di dati'}`;
  } catch {
    $('#topStatus').innerHTML = '<span class="dot off"></span> dati non disponibili';
  }
}

loadTrends();
refreshTopStatus();
