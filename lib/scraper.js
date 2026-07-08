// Scraper dei prodotti TikTok Shop via API pubblica FastMoss.
// Fonti: classifiche vendite (saleRank/popRank, giornaliera + settimanale) e ricerca prodotti
// (V2/search, che include lo storico vendite degli ultimi 7 giorni per prodotto).
// Senza login FastMoss restituisce solo liste generiche (~5 item/endpoint); con il cookie di
// sessione (impostazioni) le ricerche per keyword si sbloccano e la top 20 di categoria è completa.
const { FILES, DIRS, readJSON, writeJSON, getSettings } = require('./store');
const Models = require('../docs/models.js'); // classificatore nicchie condiviso col browser
const path = require('path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function fmGet(urlPath, auth, region = 'IT') {
  const headers = {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    referer: 'https://www.fastmoss.com/e-commerce/saleslist',
    lang: 'EN_US',
    source: 'pc',
    region,
  };
  if (auth) Object.assign(headers, auth); // cookie + eventuali token (possono sovrascrivere UA/referer)
  const res = await fetch(`https://www.fastmoss.com${urlPath}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`FastMoss HTTP ${res.status}`);
  return res.json();
}

// Header di autenticazione: env (deploy GitHub Actions) → header completi dal cURL → solo cookie.
function getAuth(settings) {
  if (process.env.FASTMOSS_COOKIE) return { cookie: process.env.FASTMOSS_COOKIE };
  if (settings.fastmossHeaders && Object.keys(settings.fastmossHeaders).length > 0) return settings.fastmossHeaders;
  if (settings.fastmossCookie) return { cookie: settings.fastmossCookie };
  return null;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const n = parseFloat(v.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Interpreta un importo gestendo formati misti ("€1.234,56", "5.31", "7,80").
function parseMoney(s) {
  let v = String(s).replace(/[^\d.,]/g, '');
  if (v.includes(',') && v.includes('.')) {
    if (v.lastIndexOf(',') > v.lastIndexOf('.')) v = v.replace(/\./g, '').replace(',', '.');
    else v = v.replace(/,/g, '');
  } else if (v.includes(',')) {
    const dec = v.split(',')[1];
    v = dec && dec.length <= 2 ? v.replace(',', '.') : v.replace(/,/g, '');
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Estrae il prezzo da una stringa, prendendo il primo valore (utile per i range "19,92 - 31,60 €").
function parsePrice(s) {
  if (!s) return 0;
  const m = String(s).match(/\d[\d.,]*/);
  return m ? parseMoney(m[0]) : 0;
}

const flatCats = (...vals) => [...new Set(vals.flat(2).filter((c) => typeof c === 'string' && c))];

// Normalizza un item delle classifiche saleRank/popRank.
// dateType=2 (settimanale): sold_count è il totale a 7 giorni → sold7; dateType=1: è il giornaliero.
function normalizeRankItem(p, dateType) {
  const weekly = dateType === 2;
  return {
    id: String(p.product_id),
    title: p.title || '',
    cover: p.cover || '',
    price: p.real_price || '',
    currency: p.currency || 'EUR',
    cats: flatCats(p.category_name || []),
    shop: (p.shop_info && (p.shop_info.shop_name || p.shop_info.name)) || '',
    soldDaily: weekly ? null : toNumber(p.sold_count),
    sold7: weekly ? toNumber(p.sold_count) : null,
    soldTotal: toNumber(p.total_sold_count),
    amountDaily: toNumber(p.sale_amount),
    incRate: toNumber(p.sold_count_inc_rate),
    commissionRate: toNumber(p.commission_rate),
    region: p.region || '',
    creators: toNumber(p.total_author_count) || toNumber(p.author_count),
    videosCount: toNumber(p.aweme_count),
    trendArr: null,
    sold14: null,
    rating: null,
    tiktokUrl: `https://www.tiktok.com/view/product/${p.product_id}`,
    fastmossUrl: `https://www.fastmoss.com/e-commerce/detail/${p.product_id}`,
  };
}

// Normalizza un item della ricerca V2/search (include trend 7 giorni e aggregati 7/14/28gg).
function normalizeSearchItem(p) {
  return {
    id: String(p.product_id || p.id),
    title: p.title || '',
    cover: p.img || '',
    price: p.price || '',
    currency: p.currency || 'EUR',
    cats: flatCats(p.category_name || [], p.category_name_l1 || [], p.category_name_l2 || [], p.category_name_l3 || []),
    shop: p.shop_name || (p.shop_info && p.shop_info.shop_name) || '',
    soldDaily: toNumber(p.yday_sold_count),
    soldTotal: toNumber(p.sold_count),
    amountDaily: toNumber(p.yday_sale_amount),
    incRate: 0,
    commissionRate: toNumber(p.crate),
    region: p.region || '',
    creators: toNumber(p.total_author_count) || toNumber(p.relate_author_count),
    videosCount: toNumber(p.relate_video_count),
    trendArr: Array.isArray(p.trend) ? p.trend.map((t) => ({ date: t.dt, v: toNumber(t.inc_sold_count) })) : null,
    sold7: toNumber(p.day7_sold_count),
    sold14: toNumber(p.day14_sold_count),
    rating: toNumber(p.product_rating) || null,
    tiktokUrl: `https://www.tiktok.com/view/product/${p.product_id || p.id}`,
    fastmossUrl: `https://www.fastmoss.com/e-commerce/detail/${p.product_id || p.id}`,
  };
}

// ---------- Classificazione categorie moda donna ----------

const MALE_OR_KIDS = /\buomo\b|\bmens?wear\b|(^|[\s(,/])men'?s\b|\bbambin\w*|\bkids?\b|\bchildren|\btoddler|\bbaby\b|\bneonat/i;
const FEMALE_HINT = /\bdonnas?\b|\bdonne\b|women|woman|\blady\b|\bladies\b|femminil|\bgirl/i;
// Beauty, cura del corpo, casa ecc. non sono moda anche se "da donna".
const NON_FASHION = /bath & body|body care|skincare|deodorant|\bcrema\b|sapone|shampoo|balsam|\bsiero\b|integrator|vitamin|profum|fragranz|trucco|makeup|mascara|rossetto|smalto|igiene|salviette|supplement|aliment|kitchen|cucina|elettrodomestic/i;

// Regole in ordine di specificità. "inherent" = categorie/termini intrinsecamente femminili;
// "generic" = termini validi solo se il prodotto ha un indizio femminile nel titolo/categoria.
const CATEGORY_RULES = [
  {
    // Intimo e notte prima dei pantaloni: "culotte"/"shorts" nei titoli di slip e pigiami
    // altrimenti finirebbero in Pantaloni.
    label: 'Abbigliamento donna', weight: 1.0,
    inherent: /sleepwear|loungewear|nightwear|underwear|lingerie|biancheria intima|camicia da notte|pigiam|reggiseno|\bbra\b|shapewear|modellante|guaina|\bintimo\b/i,
    generic: null,
  },
  {
    label: 'Pantaloni donna', weight: 1.0,
    inherent: /legging|jegging|palazzo|culotte|skirt pants|skorts?|women'?s (pants|bottoms|trousers|jeans|shorts)/i,
    generic: /pantalon|\bjeans\b|\bshorts?\b|trousers|\bpants\b|bottoms/i,
  },
  {
    label: 'Abiti donna', weight: 1.0,
    inherent: /\bdress(es)?\b|\bskirts?\b|\babito\b|\babiti\b|vestito|vestiti|\bgonn[ae]\b|tubino|longuette/i,
    generic: null,
  },
  {
    label: 'Top donna', weight: 0.95,
    inherent: /tank & tube|tube tops?|blouse|camisole|canotta|camicett|\bblusa\b|\bbody\b|\bcrop ?top/i,
    generic: /\btops?\b|t-?shirt|\bmaglia\b|maglione|maglietta|sweater|hoodie|felpa|cardigan|camicia|knitwear|pullover/i,
  },
  {
    label: 'Abbigliamento donna', weight: 1.0,
    inherent: /womenswear|women'?s (clothing|underwear|lingerie|sleepwear|outerwear|suits?|sets?)|lingerie|reggiseno|\bbra\b|intimo donna|pigiama donna|bikini|swimwear|costume da bagno/i,
    generic: /clothing|abbigliamento|outerwear|giacca|cappotto|blazer|jacket|\bcoats?\b|\btuta\b|jumpsuit|salopette|completo/i,
  },
  {
    label: 'Accessori donna', weight: 0.75,
    inherent: /collan[ae]|collier|necklace|choker|pendant|anell[oi]|orecchin|bracciale|cavigliera|fermagli|cerchietto|scrunchie|foulard|hair accessor|jewel/i,
    generic: /fashion accessor|\baccessori\b|cintur|\bbelts?\b|cappell|\bhats?\b|sciarpa|scar(f|ves)|guant|\bgloves?\b|\bcalze\b|collant|tights|\bsocks\b|sunglass|occhiali da sole|\bborsa\b|\bborse\b|\bbags?\b|portafogli|wallet/i,
  },
];

function categoryMatch(p) {
  const hay = [p.title, ...(p.cats || [])].join(' || ');
  if (MALE_OR_KIDS.test(hay)) return null;
  if (NON_FASHION.test(hay)) return null;
  // l1Hint = categoria TikTok Shop di provenienza (liste filtrate con l1_cid): vale come indizio forte.
  // Gli accessori sono già classificati da TikTok: inutile passare dalle regole testuali.
  if (p.l1Hint === 'accessories') return { label: 'Accessori donna', weight: 0.75 };
  const female = FEMALE_HINT.test(hay) || p.l1Hint === 'womenswear';
  for (const r of CATEGORY_RULES) {
    if (r.inherent && r.inherent.test(hay)) return { label: r.label, weight: r.weight };
    if (r.generic && female && r.generic.test(hay)) return { label: r.label, weight: r.weight };
  }
  if (p.l1Hint === 'womenswear') return { label: 'Abbigliamento donna', weight: 1.0 };
  if (p.l1Hint === 'accessories') return { label: 'Accessori donna', weight: 0.75 };
  return null;
}

// ---------- Raccolta ----------

// La ricerca per keyword è bloccata dal piano free (MAG_AUTH_3001): la copertura ora arriva
// dalle sotto-categorie (l2_cid). Lista vuota = nessuna chiamata di ricerca.
const DEFAULT_KEYWORDS = [];

async function runScrape() {
  const settings = getSettings();
  const auth = getAuth(settings);
  const hasAuth = Boolean(auth);
  // Solo catalogo Italia (Sharon e Alena pescano entrambi da IT; Alena si differenzia per stile Gen-Z).
  const regions = (process.env.SCRAPE_REGIONS || 'IT').split(',').map((s) => s.trim());
  const seen = new Map();
  let lastError = null;

  const collect = (items, l1Hint, region) => {
    for (const p of items) {
      if (!p.id || p.id === 'undefined' || !p.title) continue;
      if (l1Hint) p.l1Hint = l1Hint;
      p.regions = [region]; // regione da cui è stato visto (un prodotto può essere in più cataloghi)
      const prev = seen.get(p.id);
      if (!prev) { seen.set(p.id, p); continue; }
      // Fonde i duplicati tenendo i dati migliori: la ricerca (trendArr) è più ricca per
      // descrizione/categorie; per i numerici (saturazione, commissione, volume) tiene il massimo.
      const base = p.trendArr ? { ...prev, ...p } : { ...p, ...prev };
      base.commissionRate = Math.max(prev.commissionRate || 0, p.commissionRate || 0);
      base.creators = Math.max(prev.creators || 0, p.creators || 0);
      base.videosCount = Math.max(prev.videosCount || 0, p.videosCount || 0);
      base.sold7 = Math.max(prev.sold7 || 0, p.sold7 || 0) || null;       // dal rank settimanale
      base.soldDaily = Math.max(prev.soldDaily || 0, p.soldDaily || 0) || null; // dal rank giornaliero
      base.trendArr = p.trendArr || prev.trendArr;
      base.l1Hint = prev.l1Hint || p.l1Hint;
      base.regions = [...new Set([...(prev.regions || []), region])]; // unione cataloghi
      seen.set(p.id, base);
    }
  };

  // Codici accettati: 200 (autenticato) e MAG_AUTH_3004 (anonimo ma con dati reali).
  // 3006/3011 = limite di piano superato → FastMoss risponde con una lista fallback US da scartare.
  const isRealData = (j) => j && (j.code === 200 || j.code === 'MAG_AUTH_3004');
  const focusOn = settings.categoryFocus?.enabled !== false;

  // 1) Classifiche vendite/popolarità, giornaliera (date_type=1) e settimanale (date_type=2).
  //    Con focus attivo si interrogano le categorie moda TikTok Shop via l1_cid:
  //    2 = Womenswear (Sofia/Emma), 3 = Menswear (Marco/Luca), 6 = Scarpe, 8 = Accessori, 9 = Sport.
  //    L'hint genere (womenswear/menswear) aiuta il classificatore quando il titolo non lo dice.
  //    Piano free: max pagesize 10 e solo pagina 1; piani superiori paginano oltre.
  // Profilo Sharon: solo donna. Si interrogano le SOTTO-categorie (l2_cid): ognuna dà una top-10
  // dedicata → molta più copertura (es. Bottoms include i Bermuda, Dresses gli abiti) rispetto
  // alla sola categoria madre. l1=2 Womenswear&Underwear (abbigliamento+intimo), l1=8 Accessori.
  // Sotto-categorie chiave (ridotte per non superare il limite richieste MAG_AUTH_3025 di FastMoss).
  const catFilters = focusOn
    ? [
        ['&l1_cid=2&l2_cid=842376', 'womenswear'], // Women's Bottoms
        ['&l1_cid=2&l2_cid=842248', 'womenswear'], // Women's Tops
        ['&l1_cid=2&l2_cid=842504', 'womenswear'], // Women's Dresses
        ['&l1_cid=2&l2_cid=842760', 'womenswear'], // Women's Suits & Overalls (set/completi)
        ['&l1_cid=2&l2_cid=842888', 'womenswear'], // Women's Underwear → intimo
        ['&l1_cid=2&l2_cid=843016', 'womenswear'], // Sleepwear & Loungewear → intimo
        ['&l1_cid=8&l2_cid=905608', null],          // Costume Jewelry & Accessories
        ['&l1_cid=8&l2_cid=905352', null],          // Eyewear
        ['&l1_cid=8&l2_cid=905864', null],          // Hair Accessories
      ]
    : [['', null]];
  // Solo saleRank (i best-seller). Si scrappano tutte le regioni: IT (Sharon) e GB/UK (Alena).
  // (La ricerca per keyword è bloccata dal piano free — MAG_AUTH_3001 — quindi non si usa più.)
  for (const region of regions) {
    for (const [catQ, hint] of catFilters) {
      for (const kind of ['saleRank']) {
        for (const dateType of [1, 2]) {
          for (let page = 1; page <= 4; page++) {
            try {
              const j = await fmGet(`/api/goods/${kind}?region=${region}&page=${page}&pagesize=${hasAuth ? 10 : 5}&date_type=${dateType}${catQ}`, auth, region);
              if (process.env.DBG) console.error('DBG', region, catQ, 'dt' + dateType, '→', j?.code, (j?.data?.rank_list || [])[0]?.region);
              if (!isRealData(j)) break;
              const list = (j?.data?.rank_list || []).map((it) => normalizeRankItem(it, dateType));
              if (list.length === 0) break;
              const before = seen.size;
              collect(list, hint, region);
              if (seen.size === before) break; // pagine ripetute
            } catch (e) {
              lastError = e.message;
              break;
            }
            await sleep(Number(process.env.SCRAPE_SLEEP_MS) || 2500); // pause ampie: FastMoss limita le raffiche
          }
        }
      }
    }
  }

  // Tiene solo i prodotti dei cataloghi richiesti (IT/GB), scartando il fallback US.
  const items = [...seen.values()].filter((p) => (p.regions || []).some((r) => regions.includes(r)));
  const matched = items.filter((p) => Models.classify(p.title, p.cats, parsePrice(p.price), p.l1Hint).model).length;

  const status = {
    lastRun: new Date().toISOString(),
    ok: items.length > 0,
    count: items.length,
    matched,
    limited: !hasAuth,
    source: 'fastmoss',
    region: regions.join('/'),
    focus: settings.categoryFocus?.enabled !== false,
    error: items.length === 0 ? (lastError || 'Nessun prodotto ricevuto') : null,
  };
  writeJSON(FILES.status, status);

  if (items.length > 0) {
    const date = today();
    writeJSON(path.join(DIRS.snapshots, `${date}.json`), { date, regions, items });
    mergeHistory(items, date);
  }
  return status;
}

function mergeHistory(items, date) {
  const products = readJSON(FILES.products, {});
  for (const p of items) {
    const prev = products[p.id] || { history: [] };
    const byDate = new Map((prev.history || []).map((h) => [h.date, h]));
    // Lo storico 7gg di FastMoss è autoritativo: sovrascrive le date che copre.
    if (p.trendArr) {
      for (const t of p.trendArr) {
        if (t.date) byDate.set(t.date, { date: t.date, soldDaily: t.v });
      }
    }
    // Punto giornaliero solo se abbiamo un valore reale (i prodotti solo-settimanali non inquinano).
    if (p.soldDaily) byDate.set(date, { date, soldDaily: p.soldDaily });
    const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
    const { trendArr, ...fields } = p;
    const merged = { ...prev, ...fields, history, lastSeen: date };
    // Non lasciare che uno 0 transitorio cancelli un valore già noto; sold7/soldDaily: preferisci il fresco.
    merged.creators = Math.max(prev.creators || 0, fields.creators || 0);
    merged.videosCount = Math.max(prev.videosCount || 0, fields.videosCount || 0);
    merged.commissionRate = fields.commissionRate || prev.commissionRate || 0;
    merged.sold7 = fields.sold7 || prev.sold7 || null;
    merged.soldDaily = fields.soldDaily || prev.soldDaily || null;
    merged.regions = [...new Set([...(prev.regions || []), ...(fields.regions || [])])]; // unione cataloghi
    products[p.id] = merged;
  }
  // Pulizia: rimuove i prodotti spariti da più di 30 giorni.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  for (const [id, p] of Object.entries(products)) {
    if ((p.lastSeen || '') < cutoff) delete products[id];
  }
  writeJSON(FILES.products, products);
}

// ---------- Scoring ----------

function slopeScore(history) {
  const pts = history.slice(-7).map((h, i) => [i, h.soldDaily || 0]);
  if (pts.length < 2) return 0;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  const slope = (n * sxy - sx * sy) / denom;
  const mean = Math.max(1, sy / n);
  return (slope / mean) * 100;
}

// Impennata % su una finestra mobile: media dei giorni recenti vs i giorni baseline precedenti.
// I dati FastMoss sono giornalieri → "24 ore" = ultimo giorno vs precedente, "48 ore" = ultimi 2gg vs 2gg prima.
function windowSpike(history, recentDays, baselineDays) {
  const vals = (history || []).map((h) => h.soldDaily || 0);
  if (vals.length < recentDays + 1) return null; // storico insufficiente per questa finestra
  const recent = vals.slice(-recentDays);
  const baseline = vals.slice(Math.max(0, vals.length - recentDays - baselineDays), vals.length - recentDays);
  if (baseline.length === 0) return null;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const r = avg(recent), b = avg(baseline);
  return b > 0 ? ((r / b) - 1) * 100 : (r > 0 ? 100 : 0);
}

// Impennata 7 giorni: media ultimi 3gg vs precedenti + pendenza (più stabile sul medio periodo).
function spike7d(p) {
  const h = (p.history || []).slice(-7);
  if (h.length >= 4) {
    const vals = h.map((x) => x.soldDaily || 0);
    const k = Math.min(3, Math.floor(vals.length / 2));
    const recent = vals.slice(-k);
    const prevV = vals.slice(0, vals.length - k);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const pa = avg(prevV), ra = avg(recent);
    const accel = pa > 0 ? ((ra / pa) - 1) * 100 : (ra > 0 ? 100 : 0);
    return 0.6 * accel + 0.4 * slopeScore(h);
  }
  if (p.sold14 && p.sold7) {
    const prev7 = Math.max(1, p.sold14 - p.sold7);
    return ((p.sold7 / prev7) - 1) * 100;
  }
  return p.incRate || 0;
}

// €/vendita = prezzo × %commissione. È ciò che converte gli ordini in commissioni reali.
function euroPerSale(p) {
  return Math.round(parsePrice(p.price) * (p.commissionRate || 0) / 100 * 100) / 100;
}

// Volume settimanale stimato (unità vendute negli ultimi 7 giorni).
function weeklyUnits(p) {
  return p.sold7 || (p.history || []).slice(-7).reduce((s, h) => s + (h.soldDaily || 0), 0);
}

// POTENZIALE DI VENDITA: bilancia il VOLUME (quanto vende = quanti ordini potenziali) con il
// €/VENDITA (quanto guadagni per ordine), modulato dalla traiettoria. NESSUNA penalità per la
// saturazione: i best-seller restano in cima anche con tanti creator, perché la concorrenza tra
// creator non frena la domanda del pubblico (caso Bermuda Miami: 217 creator e vende ogni giorno).
function potentialScore(eps, units, spike) {
  const volNorm = clamp(Math.log10(units + 1) * 33, 0, 100);   // 100u→66, 1000u→99
  const epsNorm = clamp(eps * 28, 0, 100);                     // €3,6/vendita → 100
  const momFactor = clamp(1 + (spike || 0) / 400, 0.7, 1.25);  // declino frena, crescita spinge
  return (0.55 * volNorm + 0.45 * epsNorm) * momFactor;
}

// EMERGENTI: prodotti che accelerano ORA, con un minimo di volume reale — per anticipare i vincenti.
function emergingScore(eps, units, spikeRecent) {
  const spikeNorm = clamp(spikeRecent, 0, 300) / 3;
  const volFloor = clamp(Math.log10(units + 1) / 2.2, 0, 1);
  const epsBonus = clamp(eps * 8, 0, 25);
  return spikeNorm * (0.6 + 0.4 * volFloor) + 0.25 * epsBonus;
}

// Classifica per vista ('migliori' | 'emergenti') e per sezione.
function computeRanking(view, sectionId, creator = 'sharon', limit = 20) {
  const settings = getSettings();
  const focusOn = settings.categoryFocus?.enabled !== false;
  const products = readJSON(FILES.products, {});
  const date = today();
  const scored = [];

  const maxAge = Number(process.env.MAX_AGE_DAYS) || 3; // prodotti spariti da più giorni vengono esclusi
  for (const p of Object.values(products)) {
    if (!p.history || p.history.length === 0) continue;
    const ageDays = (new Date(date) - new Date(p.lastSeen || p.history[p.history.length - 1].date)) / 86400000;
    if (ageDays > maxAge) continue;

    // Solo catalogo italiano per entrambi i creator (Alena si differenzia per stile Gen-Z, non per mercato).
    const regs = p.regions || (p.region ? [p.region] : []);
    if (regs.length && !regs.includes('IT')) continue;

    const cls = Models.classify(p.title, p.cats, parsePrice(p.price), p.l1Hint);
    if (focusOn && cls.model !== sectionId) continue;

    const eps = euroPerSale(p);
    const units = weeklyUnits(p);
    if (units < 3) continue; // dev'essere un venditore reale, non rumore
    const trend7 = spike7d(p);

    // Alena: solo prodotti "young", ri-pesati per aderenza Gen-Z.
    let genZ = 0;
    if (creator === 'alena') {
      genZ = Models.genZFit(p.title, p.cats, parsePrice(p.price));
      if (genZ < 0.25) continue;
    }

    let score, spikeShown;
    if (view === 'emergenti') {
      const recent = windowSpike(p.history, 2, 2);
      const sr = recent != null ? recent : trend7;
      if (sr == null || sr <= 0) continue;       // emergenti = in crescita
      score = emergingScore(eps, units, sr);
      spikeShown = sr;
    } else { // migliori
      score = potentialScore(eps, units, trend7);
      spikeShown = trend7 || 0;
    }
    if (!(score > 0)) continue;

    let weight = focusOn ? 0.6 + 0.4 * cls.fit : 1;
    if (creator === 'alena') weight *= (0.4 + 0.6 * genZ); // spinge i capi più giovani
    score *= weight;

    // Pubblica SOLO i campi che servono alla UI (niente history/cats: alleggerisce molto trends.json).
    scored.push({
      id: p.id,
      title: p.title,
      cover: p.cover,
      price: p.price,
      currency: p.currency,
      commissionRate: p.commissionRate,
      fastmossUrl: p.fastmossUrl,
      trend: {
        view,
        model: cls.model,
        fit: cls.fit,
        score: Math.round(score * 10) / 10,
        spikePct: Math.round((spikeShown || 0) * 10) / 10,
        euroPerSale: eps,
        marketComm: Math.round(eps * units),     // € commissioni/sett che il prodotto genera sul mercato
        sold7: units,
        creators: p.creators || 0,
        videos: p.videosCount || 0,
        priceValue: parsePrice(p.price),
        catLabel: p.cats?.[0] || '',
        days: p.history.length,
        spark: p.history.slice(-8).map((h) => h.soldDaily || 0), // solo valori (la UI non usa le date)
      },
    });
  }
  // A parità di score vince il maggior potenziale di commissioni di mercato (€/vendita × volume).
  scored.sort((a, b) => (b.trend.score - a.trend.score) || (b.trend.marketComm - a.trend.marketComm));
  return scored.slice(0, limit);
}

// Le viste per una sezione (per un dato creator).
function rankingsForSection(sectionId, creator, limit = 20) {
  return {
    migliori: computeRanking('migliori', sectionId, creator, limit),
    emergenti: computeRanking('emergenti', sectionId, creator, limit),
  };
}

// Tutte le classifiche: per ogni creator, per ogni sezione { migliori, emergenti }.
function computeAllRankings(limit = 20) {
  const out = {};
  for (const c of Models.CREATORS) {
    out[c.id] = {};
    for (const m of Models.MODELS) out[c.id][m.id] = rankingsForSection(m.id, c.id, limit);
  }
  return out;
}

// Top unione per un creator (per il cross-match affiliate).
function topForCreator(creator, limit = 40) {
  const merged = {};
  for (const m of Models.MODELS) {
    for (const p of computeRanking('migliori', m.id, creator, 20)) merged[p.id] = p;
  }
  return Object.values(merged).sort((a, b) => b.trend.score - a.trend.score).slice(0, limit);
}

// Compat versione full locale (server.js, videogen): top migliori di Sharon.
function computeTrends(limit = 20) {
  return topForCreator('sharon', limit);
}

function getStatus() {
  return readJSON(FILES.status, { lastRun: null, ok: false, count: 0 });
}

module.exports = { runScrape, computeTrends, computeAllRankings, topForCreator, getStatus, DEFAULT_KEYWORDS };
