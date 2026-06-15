/* TTPED — analisi affiliate 100% lato client (nessun server).
   Funziona sia nel browser (window.Affiliate) sia in Node (module.exports) per i test. */
(function (root) {
  'use strict';

  // ---------- Parser CSV ----------
  function sniffDelimiter(headerLine) {
    let best = ',', bestCount = 0;
    for (const d of [',', ';', '\t']) {
      const count = headerLine.split(d).length;
      if (count > bestCount) { bestCount = count; best = d; }
    }
    return best;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const firstLine = text.slice(0, (text.indexOf('\n') + 1) || text.length);
    const delim = sniffDelimiter(firstLine);
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
    return rows;
  }

  const HEADER_MAP = {
    orderId: ['order id', 'id ordine', 'order_id', 'numero ordine', 'order number'],
    productName: ['product name', 'nome prodotto', 'nome del prodotto', 'product', 'prodotto', 'titolo prodotto'],
    productId: ['product id', 'id prodotto', 'product_id'],
    shopName: ['shop name', 'nome negozio', 'nome del negozio', 'negozio', 'seller', 'seller name', 'nome venditore', 'venditore', 'shop'],
    status: ['stato pagamento ordini', 'order status', 'stato ordine', "stato dell'ordine", 'status', 'stato', 'order substatus'],
    commissionRate: ['commission rate', 'tasso di commissione', 'percentuale di commissione', 'commission rate(%)', 'commission rate (%)', 'tasso commissione'],
    // NB: "Commissione base stimata"/"Base commissione effettiva" sono la base imponibile (≈GMV), non la commissione → escluse.
    estCommission: ['commissione stimata standard', 'estimated commission', 'commissione stimata', 'est. commission', 'estimated commission amount'],
    actualCommission: ['importo totale finale guadagnato', 'actual commission', 'commissione effettiva', 'actual commission amount', 'commissione reale'],
    amount: ['valore lordo della merce (gmv)', 'valore lordo della merce(gmv)', 'valore lordo della merce', 'order amount', 'importo ordine', "importo dell'ordine", 'payment amount', 'importo pagato', 'gmv', 'total revenue', 'order paid amount', 'prezzo totale', 'importo totale'],
    date: ['data ordine', 'order created time', 'created time', 'data di creazione', 'order create time', 'data creazione ordine', 'order time', 'ora di creazione', 'time', 'data'],
    contentType: ['tipo di contenuto', 'content type', 'source', 'fonte', 'canale'],
  };

  const normHeader = (h) => h.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();

  function mapHeaders(headerRow) {
    const headers = headerRow.map(normHeader);
    const mapping = {};
    // Passata 1: match esatti (deterministici, gestiscono le tante colonne "Commissione…").
    headers.forEach((h, idx) => {
      for (const [field, variants] of Object.entries(HEADER_MAP)) {
        if (mapping[field] !== undefined) continue;
        if (variants.includes(h)) { mapping[field] = idx; break; }
      }
    });
    // Passata 2: match per prefisso, solo per i campi ancora liberi.
    headers.forEach((h, idx) => {
      if (Object.values(mapping).includes(idx)) return;
      for (const [field, variants] of Object.entries(HEADER_MAP)) {
        if (mapping[field] !== undefined) continue;
        if (variants.some((v) => h.startsWith(v))) { mapping[field] = idx; break; }
      }
    });
    return mapping;
  }

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
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).toISOString();
    const d = new Date(t);
    return isNaN(d) ? null : d.toISOString();
  }

  const isCancelled = (s) => /cancel|annull|refund|rimbors|reso|return/.test((s || '').toLowerCase());
  const isSettled = (s) => /settl|complet|pagat|paid|liquidat/.test((s || '').toLowerCase());
  const commissionOf = (o) => o.actualCommission || o.estCommission || 0;

  // Converte righe (array di array) in ordini. Usata sia per CSV sia per Excel.
  function rowsToOrders(rows) {
    if (rows.length < 2) throw new Error('File vuoto o senza dati');
    const mapping = mapHeaders(rows[0]);
    if (mapping.productName === undefined && mapping.orderId === undefined) {
      throw new Error('Intestazioni non riconosciute: ' + rows[0].slice(0, 8).join(' | '));
    }
    const get = (row, field) => (mapping[field] !== undefined ? String(row[mapping[field]] ?? '').trim() : '');
    const orders = [];
    for (const row of rows.slice(1)) {
      const o = {
        orderId: get(row, 'orderId') || ('row-' + orders.length + '-' + (get(row, 'date') || '').slice(0, 10)),
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
      if (!o.productName && !o.amount) continue;
      // L'export TikTok non ha una colonna "% commissione": la deriviamo dall'incassato sul GMV.
      if (!o.commissionRate) {
        const c = o.actualCommission || o.estCommission;
        if (c && o.amount) o.commissionRate = Math.round((c / o.amount) * 1000) / 10;
      }
      orders.push(o);
    }
    return { orders, mappedFields: Object.keys(mapping) };
  }

  // Parsing CSV (testo).
  function parse(text) {
    return rowsToOrders(parseCSV(text));
  }

  // ---------- Lettore XLSX nativo (niente librerie: usa DecompressionStream) ----------
  function colIndex(ref) {
    const m = (ref || '').match(/^([A-Z]+)/);
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  // Estrae il testo di un file dall'archivio ZIP (.xlsx) leggendo la central directory.
  async function readZipEntry(buf, name) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('File Excel non valido');
    let off = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true);
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const fname = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
      if (fname === name) {
        const lNameLen = dv.getUint16(lho + 26, true);
        const lExtraLen = dv.getUint16(lho + 28, true);
        const start = lho + 30 + lNameLen + lExtraLen;
        const data = u8.subarray(start, start + compSize);
        if (method === 0) return dec.decode(data);
        if (method === 8) return dec.decode(await inflateRaw(data));
        throw new Error('Compressione Excel non supportata');
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('Foglio non trovato nel file Excel');
  }

  function parseSharedStrings(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return [...doc.getElementsByTagName('si')].map((si) =>
      [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  }

  function sheetToRows(xml, shared) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [];
    for (const r of doc.getElementsByTagName('row')) {
      const row = [];
      for (const c of r.getElementsByTagName('c')) {
        const idx = colIndex(c.getAttribute('r'));
        const type = c.getAttribute('t');
        let val = '';
        if (type === 'inlineStr') {
          const tEl = c.getElementsByTagName('t')[0];
          val = tEl ? tEl.textContent : '';
        } else {
          const v = c.getElementsByTagName('v')[0];
          val = v ? v.textContent : '';
          if (type === 's' && shared && shared.length) val = shared[+val] || ''; // riferimento a shared strings
        }
        row[idx] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows.push(row);
    }
    return rows;
  }

  // Parsing XLSX (ArrayBuffer). Async per via della decompressione.
  async function parseXlsx(arrayBuffer) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Il tuo browser non supporta i file Excel: esporta in CSV o aprilo con Chrome/Safari aggiornato');
    }
    let shared = [];
    try { shared = parseSharedStrings(await readZipEntry(arrayBuffer, 'xl/sharedStrings.xml')); } catch { /* inline strings */ }
    let xml;
    try { xml = await readZipEntry(arrayBuffer, 'xl/worksheets/sheet1.xml'); }
    catch { xml = await readZipEntry(arrayBuffer, 'xl/worksheets/sheet01.xml'); }
    return rowsToOrders(sheetToRows(xml, shared));
  }

  // ---------- Analytics ----------
  function analytics(allOrders) {
    const valid = allOrders.filter((o) => !isCancelled(o.status));
    const cancelled = allOrders.length - valid.length;

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
        name, orders: e.orders,
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

    const weekdays = Array(7).fill(0), hours = Array(24).fill(0);
    for (const o of valid) {
      if (!o.date) continue;
      const d = new Date(o.date);
      weekdays[d.getDay()]++; hours[d.getHours()]++;
    }

    const totals = {
      orders: valid.length, cancelled,
      gmv: Math.round(valid.reduce((s, o) => s + o.amount, 0) * 100) / 100,
      commission: Math.round(valid.reduce((s, o) => s + commissionOf(o), 0) * 100) / 100,
      settled: valid.filter((o) => isSettled(o.status)).length,
      avgRate: (() => {
        const r = valid.filter((o) => o.commissionRate);
        return r.length ? Math.round((r.reduce((s, o) => s + o.commissionRate, 0) / r.length) * 10) / 10 : null;
      })(),
    };
    return { totals, byProduct, byShop, series, weekdays, hours };
  }

  // ---------- Cross-match con i trend del giorno ----------
  function tokens(s) {
    return new Set((s || '').toLowerCase().replace(/[^a-z0-9àèéìòù ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3));
  }
  function matchTrending(byProduct, trendsTop) {
    const matches = [];
    for (const prod of byProduct.slice(0, 30)) {
      const pt = tokens(prod.name);
      if (pt.size === 0) continue;
      for (const t of (trendsTop || [])) {
        const tt = tokens(t.title);
        let overlap = 0;
        for (const w of pt) if (tt.has(w)) overlap++;
        const ratio = overlap / Math.min(pt.size, tt.size || 1);
        if (overlap >= 2 && ratio >= 0.4) {
          matches.push({ affiliateProduct: prod.name, trendingProduct: t.title, growthPct: (t.trend && (t.trend.spikePct ?? t.trend.growthPct)) || 0, commission: prod.commission });
          break;
        }
      }
    }
    return matches;
  }

  // ---------- Strategia ----------
  const WEEKDAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const fmtEur = (n) => '€' + (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function strategy(allOrders, trendsTop) {
    const a = analytics(allOrders);
    if (a.totals.orders === 0) {
      return { ready: false, message: 'Importa il CSV degli ordini dal Centro Affiliazione TikTok Shop (Dati → Ordini → Esporta).' };
    }
    const sections = [];
    const top = a.byProduct.slice(0, 5);
    const topShops = a.byShop.slice(0, 5);
    const recentCut = new Date(Date.now() - 14 * 86400000).toISOString();

    const winners = top.filter((p) => p.commission > 0);
    sections.push({
      icon: '🏆', title: 'Prodotti vincenti — raddoppia i contenuti',
      lines: [
        'I tuoi top ' + winners.length + ' prodotti generano ' + fmtEur(winners.reduce((s, p) => s + p.commission, 0)) + ' di commissioni (' + Math.round(winners.reduce((s, p) => s + p.commission, 0) / Math.max(1, a.totals.commission) * 100) + '% del totale).',
        ...winners.map((p) => '• **' + p.name + '** — ' + p.orders + ' ordini, ' + fmtEur(p.commission) + ' di commissioni' + (p.avgRate ? ', rate ' + p.avgRate + '%' : '') + ': pubblica 2-3 nuovi video a settimana finché converte, variando hook e formato (unboxing, demo, POV).'),
        'Regola: un prodotto che ha già convertito sul tuo profilo ha il pubblico "caldo" — TikTok lo rispinge sulle stesse persone. Non mollarlo finché il trend non muore.',
      ],
    });

    const stale = a.byProduct.filter((p) => p.commission > 0 && p.lastOrder && p.lastOrder < recentCut).slice(0, 5);
    if (stale.length) {
      sections.push({
        icon: '🔁', title: 'Da rilanciare — convertivano ma sono fermi',
        lines: [
          'Questi prodotti hanno generato commissioni ma non vendono da 2+ settimane. Spesso basta un nuovo angolo creativo:',
          ...stale.map((p) => '• **' + p.name + '** — ultimo ordine ' + p.lastOrder.slice(0, 10) + ', ' + fmtEur(p.commission) + ' storiche. Riprova con un hook diverso o un audio di tendenza attuale.'),
        ],
      });
    }

    if (topShops.length) {
      sections.push({
        icon: '🤝', title: 'Seller che ti pagano di più',
        lines: [
          ...topShops.map((s) => '• **' + s.name + '** — ' + fmtEur(s.commission) + ' di commissioni su ' + s.orders + ' ordini' + (s.avgRate ? ' (rate medio ' + s.avgRate + '%)' : '') + '.'),
          'Azioni: contatta i primi 2-3 seller in chat dal Centro Affiliazione e chiedi (1) commissione esclusiva più alta, (2) campioni gratuiti, (3) accesso a promo in anteprima. Con uno storico di vendite dimostrabile quasi sempre accettano.',
          topShops.length >= 3 && topShops[0].commission > a.totals.commission * 0.6
            ? '⚠️ ' + topShops[0].name + ' vale oltre il 60% delle tue commissioni: diversifica con 1-2 seller alternativi nella stessa categoria.'
            : 'Distribuzione tra seller sana: mantieni 3-5 seller attivi in parallelo.',
        ],
      });
    }

    const matches = matchTrending(a.byProduct, trendsTop);
    if (matches.length) {
      sections.push({
        icon: '🚀', title: 'Occasioni calde: tuoi prodotti ORA in trend',
        lines: [
          'Prodotti che hai già venduto e che stanno crescendo su TikTok Shop in questo momento — priorità massima:',
          ...matches.map((m) => '• **' + m.affiliateProduct + '** ↔ in trend come "' + m.trendingProduct + '" (+' + m.growthPct + '% ordini). Hai già ' + fmtEur(m.commission) + ' di storico: rilancialo oggi.'),
        ],
      });
    }

    const bestDay = a.weekdays.indexOf(Math.max(...a.weekdays));
    const bestHours = a.hours.map((v, h) => [h, v]).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([h]) => h + ':00');
    if (a.totals.orders >= 10) {
      sections.push({
        icon: '⏰', title: 'Timing di pubblicazione',
        lines: [
          'Il giorno con più ordini è ' + WEEKDAY_NAMES[bestDay] + '; le fasce più calde sono ' + bestHours.join(', ') + '.',
          'Gli ordini arrivano 1-3 ore dopo la visualizzazione: pubblica 1-2 ore prima di questi picchi.',
        ],
      });
    }

    const rate = a.totals.avgRate;
    sections.push({
      icon: '📋', title: 'Piano operativo settimanale',
      lines: [
        'Allocazione consigliata dei contenuti:',
        '• **60%** sui prodotti vincenti e sui cross-match col trend (conversione provata).',
        '• **30%** sui top della classifica Trend (tab 🔥) non ancora testati, con commission rate ≥ ' + (rate ? rate + '%' : '10%') + ' e crescita ordini a doppia cifra.',
        '• **10%** sperimentale: categoria o formato nuovo, per scoprire la prossima miniera.',
        'Con un rate medio del ' + (rate || '~10') + '% e ordine medio di ' + fmtEur(a.totals.gmv / Math.max(1, a.totals.orders)) + ', ogni 100 ordini incassi ≈ ' + fmtEur((a.totals.commission / Math.max(1, a.totals.orders)) * 100) + '. La leva più diretta è il volume di contenuti.',
        a.totals.cancelled > a.totals.orders * 0.15
          ? '⚠️ Il ' + Math.round(a.totals.cancelled / Math.max(1, a.totals.orders + a.totals.cancelled) * 100) + '% degli ordini risulta annullato/rimborsato: evita aspettative gonfiate nei video, i resi azzerano le commissioni.'
          : null,
      ].filter(Boolean),
    });

    return { ready: true, generatedAt: new Date().toISOString(), sections, matches };
  }

  // ---------- Profilo storico personale (cosa converte PER TE) ----------
  // Parole troppo generiche da ignorare quando si confrontano i titoli.
  const STOP = new Set(['donna', 'donne', 'women', 'woman', 'lady', 'ladies', 'with', 'from', 'your', 'that', 'this',
    'pezzi', 'colore', 'color', 'stampa', 'print', 'taglia', 'taglie', 'size', 'nuovo', 'nuova', 'stile', 'style',
    'moda', 'design', 'estate', 'inverno', 'casual', 'elegante', 'sexy', 'vita', 'alta']);

  function profileTokens(s) {
    return [...new Set((s || '').toLowerCase().replace(/[^a-z0-9àèéìòù ]+/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)))];
  }

  // Estrae dai tuoi ordini i segnali di ciò che converte: parole-chiave e fascia di prezzo vincenti.
  function profile(allOrders) {
    const valid = (allOrders || []).filter((o) => !isCancelled(o.status));
    const kw = new Map();
    let totalComm = 0;
    const prices = [];
    for (const o of valid) {
      const c = commissionOf(o);
      totalComm += c;
      const weight = Math.max(c, 0.01);
      for (const t of profileTokens(o.productName)) kw.set(t, (kw.get(t) || 0) + weight);
      if (o.amount > 0) prices.push({ amount: o.amount, w: weight });
    }
    let pMean = 0, wsum = 0;
    for (const p of prices) { pMean += p.amount * p.w; wsum += p.w; }
    pMean = wsum ? pMean / wsum : 0;
    const topKw = [...kw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    return {
      orders: valid.length,
      totalComm: Math.round(totalComm * 100) / 100,
      kw: Object.fromEntries(topKw),
      maxKw: topKw.length ? topKw[0][1] : 1,
      priceMean: Math.round(pMean * 100) / 100,
      priceLo: Math.round(pMean * 0.6 * 100) / 100,
      priceHi: Math.round(pMean * 1.6 * 100) / 100,
    };
  }

  // Quanto un prodotto in trend somiglia ai tuoi vincenti (0..1) + motivazioni.
  function personalMatch(title, priceValue, prof) {
    if (!prof || prof.orders === 0) return null;
    const toks = profileTokens(title);
    let kwScore = 0; const hits = [];
    for (const t of toks) if (prof.kw[t]) { kwScore += prof.kw[t]; hits.push(t); }
    const kwNorm = Math.min(1, kwScore / (prof.maxKw * 1.5));
    let priceFit = 0;
    if (priceValue > 0 && prof.priceMean > 0) {
      if (priceValue >= prof.priceLo && priceValue <= prof.priceHi) priceFit = 1;
      else {
        const d = priceValue < prof.priceLo ? (prof.priceLo - priceValue) / prof.priceLo : (priceValue - prof.priceHi) / prof.priceHi;
        priceFit = Math.max(0, 1 - d);
      }
    }
    const score = 0.7 * kwNorm + 0.3 * priceFit;
    const reasons = [];
    if (hits.length) reasons.push('capi simili ti hanno già reso (' + hits.slice(0, 3).join(', ') + ')');
    if (priceFit >= 0.8 && prof.priceMean > 0) reasons.push('fascia prezzo che converte per te (~€' + prof.priceMean.toFixed(0) + ')');
    return { score: Math.round(score * 100) / 100, reasons };
  }

  const API = { parse, parseXlsx, analytics, strategy, profile, personalMatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Affiliate = API;
})(typeof window !== 'undefined' ? window : globalThis);
