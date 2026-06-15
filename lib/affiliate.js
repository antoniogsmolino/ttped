// Analisi vendite TikTok Shop Affiliate: import CSV dal Centro Affiliazione,
// metriche per prodotto/seller e generazione della strategia operativa.
const { FILES, readJSON, writeJSON } = require('./store');
const { computeTrends } = require('./scraper');

// ---------- Parser CSV ----------

function sniffDelimiter(headerLine) {
  const candidates = [',', ';', '\t'];
  let best = ',', bestCount = 0;
  for (const d of candidates) {
    const count = headerLine.split(d).length;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const delim = sniffDelimiter(firstLine);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  return rows;
}

// Mappa intestazioni CSV (varianti EN/IT del Centro Affiliazione TikTok Shop).
const HEADER_MAP = {
  orderId: ['order id', 'id ordine', 'order_id', 'numero ordine', 'order number'],
  productName: ['product name', 'nome prodotto', 'nome del prodotto', 'product', 'prodotto', 'titolo prodotto'],
  productId: ['product id', 'id prodotto', 'product_id'],
  shopName: ['shop name', 'nome negozio', 'nome del negozio', 'negozio', 'seller', 'seller name', 'nome venditore', 'venditore', 'shop'],
  status: ['order status', 'stato ordine', "stato dell'ordine", 'status', 'stato', 'order substatus'],
  commissionRate: ['commission rate', 'tasso di commissione', 'percentuale di commissione', 'commission rate(%)', 'commission rate (%)', 'tasso commissione'],
  estCommission: ['estimated commission', 'commissione stimata', 'est. commission', 'estimated commission amount'],
  actualCommission: ['actual commission', 'commissione effettiva', 'actual commission amount', 'commissione reale', 'commission', 'commissione'],
  amount: ['order amount', 'importo ordine', "importo dell'ordine", 'payment amount', 'importo pagato', 'gmv', 'total revenue', 'order paid amount', 'prezzo totale', 'importo totale'],
  date: ['order created time', 'created time', 'data ordine', 'data di creazione', 'order create time', 'data creazione ordine', 'time', 'data', 'order time', 'ora di creazione'],
  contentType: ['content type', 'tipo di contenuto', 'source', 'fonte', 'canale'],
};

function normHeader(h) {
  return h.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

function mapHeaders(headerRow) {
  const mapping = {};
  headerRow.forEach((raw, idx) => {
    const h = normHeader(raw);
    for (const [field, variants] of Object.entries(HEADER_MAP)) {
      if (mapping[field] !== undefined) continue;
      if (variants.some((v) => h === v || h.startsWith(v))) { mapping[field] = idx; break; }
    }
  });
  return mapping;
}

// Gestisce sia "1.234,56 €" sia "$1,234.56".
function parseMoney(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  let v = String(s).replace(/[^\d.,-]/g, '');
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

function parseDate(s) {
  if (!s) return null;
  const t = s.trim();
  // gg/mm/aaaa [hh:mm[:ss]]
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).toISOString();
  const d = new Date(t);
  return isNaN(d) ? null : d.toISOString();
}

function isCancelled(status) {
  const s = (status || '').toLowerCase();
  return /cancel|annull|refund|rimbors|reso|return/.test(s);
}

function isSettled(status) {
  const s = (status || '').toLowerCase();
  return /settl|complet|pagat|paid|liquidat/.test(s);
}

// ---------- Import ----------

function importCSV(text, fileName) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV vuoto o non valido');
  const mapping = mapHeaders(rows[0]);
  if (mapping.productName === undefined && mapping.orderId === undefined) {
    throw new Error(`Intestazioni non riconosciute: ${rows[0].slice(0, 8).join(' | ')}`);
  }
  const get = (row, field) => (mapping[field] !== undefined ? (row[mapping[field]] || '').trim() : '');
  const orders = [];
  for (const row of rows.slice(1)) {
    const order = {
      orderId: get(row, 'orderId') || `row-${orders.length}-${(get(row, 'date') || '').slice(0, 10)}`,
      productName: get(row, 'productName'),
      productId: get(row, 'productId'),
      shopName: get(row, 'shopName'),
      status: get(row, 'status'),
      commissionRate: parseMoney(get(row, 'commissionRate')),
      estCommission: parseMoney(get(row, 'estCommission')),
      actualCommission: parseMoney(get(row, 'actualCommission')),
      amount: parseMoney(get(row, 'amount')),
      date: parseDate(get(row, 'date')),
      contentType: get(row, 'contentType'),
    };
    if (!order.productName && !order.amount) continue;
    orders.push(order);
  }

  const db = readJSON(FILES.affiliate, { orders: [], files: [] });
  const existing = new Set(db.orders.map((o) => o.orderId));
  const added = orders.filter((o) => !existing.has(o.orderId));
  db.orders.push(...added);
  db.files = db.files.filter((f) => f.name !== fileName);
  db.files.push({ name: fileName, importedAt: new Date().toISOString(), rows: orders.length, added: added.length });
  writeJSON(FILES.affiliate, db);
  return { total: db.orders.length, added: added.length, skipped: orders.length - added.length, mappedFields: Object.keys(mapping) };
}

// ---------- Analytics ----------

function commissionOf(o) {
  return o.actualCommission || o.estCommission || 0;
}

function analytics() {
  const db = readJSON(FILES.affiliate, { orders: [], files: [] });
  const valid = db.orders.filter((o) => !isCancelled(o.status));
  const cancelled = db.orders.length - valid.length;

  const agg = (keyFn) => {
    const map = new Map();
    for (const o of valid) {
      const key = keyFn(o) || '(sconosciuto)';
      const e = map.get(key) || { orders: 0, gmv: 0, commission: 0, rates: [], lastOrder: null };
      e.orders++; e.gmv += o.amount; e.commission += commissionOf(o);
      if (o.commissionRate) e.rates.push(o.commissionRate);
      if (o.date && (!e.lastOrder || o.date > e.lastOrder)) e.lastOrder = o.date;
      map.set(key, e);
    }
    return [...map.entries()].map(([name, e]) => ({
      name,
      orders: e.orders,
      gmv: Math.round(e.gmv * 100) / 100,
      commission: Math.round(e.commission * 100) / 100,
      avgRate: e.rates.length ? Math.round((e.rates.reduce((a, b) => a + b, 0) / e.rates.length) * 10) / 10 : null,
      lastOrder: e.lastOrder,
    }));
  };

  const byProduct = agg((o) => o.productName).sort((a, b) => b.commission - a.commission);
  const byShop = agg((o) => o.shopName).sort((a, b) => b.commission - a.commission);

  const daily = new Map();
  for (const o of valid) {
    if (!o.date) continue;
    const d = o.date.slice(0, 10);
    const e = daily.get(d) || { orders: 0, commission: 0, gmv: 0 };
    e.orders++; e.commission += commissionOf(o); e.gmv += o.amount;
    daily.set(d, e);
  }
  const series = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, e]) => ({ date, orders: e.orders, commission: Math.round(e.commission * 100) / 100, gmv: Math.round(e.gmv * 100) / 100 }));

  const weekdays = Array(7).fill(0);
  const hours = Array(24).fill(0);
  for (const o of valid) {
    if (!o.date) continue;
    const d = new Date(o.date);
    weekdays[d.getDay()]++; hours[d.getHours()]++;
  }

  const totals = {
    orders: valid.length,
    cancelled,
    gmv: Math.round(valid.reduce((s, o) => s + o.amount, 0) * 100) / 100,
    commission: Math.round(valid.reduce((s, o) => s + commissionOf(o), 0) * 100) / 100,
    settled: valid.filter((o) => isSettled(o.status)).length,
    avgRate: (() => {
      const r = valid.filter((o) => o.commissionRate);
      return r.length ? Math.round((r.reduce((s, o) => s + o.commissionRate, 0) / r.length) * 10) / 10 : null;
    })(),
  };

  return { totals, byProduct, byShop, series, weekdays, hours, files: db.files };
}

// ---------- Cross-match con i trend ----------

function tokens(s) {
  return new Set((s || '').toLowerCase().replace(/[^a-z0-9àèéìòù ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3));
}

function matchTrending(byProduct) {
  const trends = computeTrends(40);
  const matches = [];
  for (const prod of byProduct.slice(0, 30)) {
    const pt = tokens(prod.name);
    if (pt.size === 0) continue;
    for (const t of trends) {
      const tt = tokens(t.title);
      let overlap = 0;
      for (const w of pt) if (tt.has(w)) overlap++;
      const ratio = overlap / Math.min(pt.size, tt.size || 1);
      if (overlap >= 2 && ratio >= 0.4) {
        matches.push({ affiliateProduct: prod.name, trendingProduct: t.title, growthPct: t.trend.growthPct, commission: prod.commission, trendId: t.id });
        break;
      }
    }
  }
  return matches;
}

// ---------- Strategia ----------

const WEEKDAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const fmtEur = (n) => '€' + (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function strategy() {
  const a = analytics();
  if (a.totals.orders === 0) {
    return { ready: false, message: 'Importa prima il CSV degli ordini dal Centro Affiliazione TikTok Shop (Dati > Ordini > Esporta).' };
  }
  const sections = [];
  const top = a.byProduct.slice(0, 5);
  const topShops = a.byShop.slice(0, 5);
  const recentCut = new Date(Date.now() - 14 * 86400000).toISOString();

  // 1. Prodotti vincenti
  const winners = top.filter((p) => p.commission > 0);
  sections.push({
    icon: '🏆',
    title: 'Prodotti vincenti — raddoppia i contenuti',
    lines: [
      `I tuoi top ${winners.length} prodotti generano ${fmtEur(winners.reduce((s, p) => s + p.commission, 0))} di commissioni (${Math.round(winners.reduce((s, p) => s + p.commission, 0) / Math.max(1, a.totals.commission) * 100)}% del totale).`,
      ...winners.map((p) => `• **${p.name}** — ${p.orders} ordini, ${fmtEur(p.commission)} di commissioni${p.avgRate ? `, rate ${p.avgRate}%` : ''}: pubblica 2-3 nuovi video a settimana finché converte, variando hook e formato (unboxing, demo, POV).`),
      'Regola: un prodotto che ha già convertito sul tuo profilo ha il CPM "caldo" — TikTok lo spinge sullo stesso pubblico. Non abbandonarlo finché il trend non muore.',
    ],
  });

  // 2. Prodotti da rilanciare (vendevano, ora fermi)
  const stale = a.byProduct.filter((p) => p.commission > 0 && p.lastOrder && p.lastOrder < recentCut).slice(0, 5);
  if (stale.length) {
    sections.push({
      icon: '🔁',
      title: 'Da rilanciare — convertivano ma sono fermi',
      lines: [
        'Questi prodotti hanno generato commissioni ma non vendono da 2+ settimane. Spesso basta un nuovo angolo creativo per riattivarli:',
        ...stale.map((p) => `• **${p.name}** — ultimo ordine ${p.lastOrder.slice(0, 10)}, ${fmtEur(p.commission)} storiche. Riprova con un hook diverso o aggancialo a un trend audio attuale.`),
      ],
    });
  }

  // 3. Seller migliori
  if (topShops.length) {
    sections.push({
      icon: '🤝',
      title: 'Seller che ti pagano di più',
      lines: [
        ...topShops.map((s) => `• **${s.name}** — ${fmtEur(s.commission)} di commissioni su ${s.orders} ordini${s.avgRate ? ` (rate medio ${s.avgRate}%)` : ''}.`),
        'Azioni: contatta i primi 2-3 seller in chat dal Centro Affiliazione e chiedi (1) commissione esclusiva più alta, (2) campioni gratuiti per contenuti migliori, (3) accesso a campagne/promo in anteprima. Con uno storico di vendite dimostrabile quasi sempre accettano.',
        topShops.length >= 3 && topShops[0].commission > a.totals.commission * 0.6
          ? `⚠️ Concentrazione: ${topShops[0].name} vale oltre il 60% delle tue commissioni. Diversifica con 1-2 seller alternativi nella stessa categoria per non dipendere da un solo negozio.`
          : 'La distribuzione tra seller è sana: mantieni 3-5 seller attivi in parallelo.',
      ].filter(Boolean),
    });
  }

  // 4. Cross-match con i trend del giorno
  const matches = matchTrending(a.byProduct);
  if (matches.length) {
    sections.push({
      icon: '🚀',
      title: 'Occasioni calde: tuoi prodotti ORA in trend',
      lines: [
        'Questi prodotti che hai già venduto sono in crescita su TikTok Shop in questo momento — priorità massima per i prossimi contenuti:',
        ...matches.map((m) => `• **${m.affiliateProduct}** ↔ in trend come "${m.trendingProduct}" (+${m.growthPct}% ordini). Hai già ${fmtEur(m.commission)} di storico: rilancialo oggi.`),
      ],
    });
  }

  // 5. Timing
  const bestDay = a.weekdays.indexOf(Math.max(...a.weekdays));
  const bestHours = a.hours.map((v, h) => [h, v]).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([h]) => `${h}:00`);
  if (a.totals.orders >= 10) {
    sections.push({
      icon: '⏰',
      title: 'Timing di pubblicazione',
      lines: [
        `Il giorno con più ordini è ${WEEKDAY_NAMES[bestDay]}; le fasce orarie più calde sono ${bestHours.join(', ')}.`,
        'Gli ordini arrivano 1-3 ore dopo la visualizzazione del video: programma le pubblicazioni 1-2 ore prima di questi picchi (puoi farlo dal tab Video Studio).',
      ],
    });
  }

  // 6. Piano operativo giornaliero
  const rate = a.totals.avgRate;
  sections.push({
    icon: '📋',
    title: 'Piano operativo: 10 video al giorno',
    lines: [
      'Allocazione consigliata della produzione giornaliera:',
      '• **6 video** sui prodotti vincenti e su quelli in cross-match col trend (conversione provata).',
      '• **3 video** sui top della classifica Trend (tab 🔥) che non hai ancora testato: scegli quelli con commission rate ≥ ' + (rate ? `${rate}%` : '10%') + ' e crescita ordini a doppia cifra.',
      '• **1 video** sperimentale: categoria nuova o formato nuovo, per scoprire la prossima miniera.',
      `Con un tasso medio del ${rate || '~10'}% e il tuo ordine medio di ${fmtEur(a.totals.gmv / Math.max(1, a.totals.orders))}, ogni 100 ordini incassi ≈ ${fmtEur((a.totals.commission / Math.max(1, a.totals.orders)) * 100)}. Scala il volume di contenuti: è la leva più diretta.`,
      a.totals.cancelled > a.totals.orders * 0.15
        ? `⚠️ Il ${Math.round(a.totals.cancelled / Math.max(1, a.totals.orders + a.totals.cancelled) * 100)}% degli ordini risulta annullato/rimborsato: evita prodotti con aspettative gonfiate nei video — i resi uccidono le commissioni e il punteggio del profilo.`
        : null,
    ].filter(Boolean),
  });

  return { ready: true, generatedAt: new Date().toISOString(), sections, matches };
}

function reset() {
  writeJSON(FILES.affiliate, { orders: [], files: [] });
}

module.exports = { importCSV, analytics, strategy, reset };
