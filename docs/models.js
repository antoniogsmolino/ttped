/* TTPED — classificatore di sotto-nicchia per i 4 modelli del profilo.
   Usato sia dallo scraper (Node, per i prodotti in trend) sia dal browser
   (affiliate, per i prodotti venduti). Funziona su titolo + categorie + prezzo. */
(function (root) {
  'use strict';

  // Profili dei 4 modelli (ordine = ordine dei tab in dashboard).
  const MODELS = [
    { id: 'sofia', name: 'Sofia', emoji: '💗', tag: 'Streetwear / Y2K Gen-Z',
      desc: 'Capi ad alto impulso e basso prezzo: jeans baggy, crop, felpe oversize, sneakers chunky, mini-bag, accessori virali. Palette pastello + denim + cromo.' },
    { id: 'emma', name: 'Emma', emoji: '🤍', tag: 'Minimal / Clean girl',
      desc: 'Look da aperitivo/ufficio/evento: blazer, abiti sartoriali, jeans dritti, maglieria fine, mocassini, borsa strutturata. Palette neutra. AOV medio, alta conversione.' },
    { id: 'marco', name: 'Marco', emoji: '🧥', tag: 'Uomo elegante (AOV alto)',
      desc: 'Total look elegante: maglieria fine, camicie oxford, chino/sartoriali, capispalla (trench, cappotto), mocassini/sneakers minimal in pelle. Niente loghi vistosi.' },
    { id: 'luca', name: 'Luca', emoji: '🏃', tag: 'Uomo sport / streetwear',
      desc: 'Coda impulsiva e a basso prezzo: tute, felpe tecniche, joggers, t-shirt tecniche, sneakers sportive, cappellini. Look uscita palestra/città.' },
  ];

  // Esclusioni: famiglie di categoria non-moda + beauty + bambino + calzature speciali.
  const EXCLUDE = /power tools|personal care|appliance|electronic|\bphone|computer|automotive|motorcycle|kitchen|household|home supplies|furnitur|\bpet\b|hardware|\bbook|\btoy|grocery|beverage|stationery|collectible|musical|fitness equipment|sport.?equipment|outdoor recreation|bath|body care|skincare|deodor|\bcrema\b|sapone|shampoo|balsam|\bsiero\b|integrat|vitamin|profum|fragranz|makeup|mascara|rossetto|smalto|rasoio|shaver|trimmer|epilat|igiene|supplement|aliment|cucina|arred|monopattin|attrezz|elettrodom|safety|antinfortun|work &|\bkid|child|toddler|\bbaby\b|neonat|bambin/i;

  function genderOf(hay, l1Hint) {
    if (/\bwomen|woman|\bdonna|donne|femmin|\blady|ladies|\bgirl/.test(hay)) return 'w';
    if (/\bmen'?s\b|\buomo\b|uomini|\bman\b|maschil|homme/.test(hay)) return 'm';
    if (l1Hint === 'womenswear') return 'w';
    if (l1Hint === 'menswear') return 'm';
    return 'u';
  }

  // Configurazione per modello: genere richiesto, fascia prezzo ideale, keyword pro/contro.
  const CFG = {
    sofia: {
      gender: 'w', price: [0, 30],
      pos: /baggy|\blarghi|\blarghe|oversize|\bcrop\b|cropp|\bcargo\b|parachute|y2k|denim|\bjeans\b|jorts|felp[ae]|hoodie|cappuccio|sneaker|chunky|platform|mini ?bag|marsup|tracoll|occhial|eyewear|sunglass|cerchiett|fermagl|scrunchie|mollett|hair ?clip|ballerin|\btank\b|canotta|tube top|\bbody\b|grunge|graphic|strappat/i,
      neg: /blazer|sartorial|tailored|cappotto|trench|mocassin|décolleté|decolt|oxford|cashmere|dolcevita|\bsuit\b/i,
    },
    emma: {
      gender: 'w', price: [20, 90],
      pos: /blazer|\babito|abiti|\bdress|tubino|bustino|sartorial|tailored|\bdritt|straight|maglieri|\bknit\b|maglione|cardigan|mocassin|décolleté|decolt|camici|longuette|\bmidi\b|elegante|\braso\b|satin|saten|completo|tailleur|\bgonna|\bsuit\b|overall|trench|cappotto/i,
      neg: /baggy|oversize|\bcrop\b|felp[ae]|hoodie|jogger|\bcargo\b|y2k|chunky|tecnic|tracksuit|grunge/i,
    },
    marco: {
      gender: 'm', price: [35, 250],
      pos: /maglier|maglione|\bknit\b|dolcevita|camici|oxford|\bchino\b|chinos|sartorial|trench|cappotto|blazer|giacca|cardigan|\blana\b|cashmere|\bpolo\b|mocassin|\blino\b|gilet|\bsuit\b|overall|chemise/i,
      neg: /\btuta|\btute\b|felp[ae]|hoodie|jogger|tecnic|training|\bgym\b|tracksuit|running|cappellino|\bshorts?\b/i,
    },
    luca: {
      gender: 'm', price: [0, 45],
      pos: /\btuta|\btute\b|felp[ae]|hoodie|cappuccio|jogger|t-?shirt|tecnic|sneaker|sportiv|training|\bgym\b|tracksuit|cappellino|pantaloncin|\bshorts?\b|\btank\b|running|palestra|sport ?& ?outdoor/i,
      neg: /blazer|sartorial|cappotto|trench|oxford|mocassin|cardigan|cashmere|dolcevita|camici/i,
    },
  };

  const countMatches = (re, hay) => {
    const m = hay.match(new RegExp(re.source, 'gi'));
    return m ? m.length : 0;
  };

  function priceFit(price, [lo, hi]) {
    if (!price) return 0.5; // prezzo ignoto → neutro
    if (price >= lo && price <= hi) return 1;
    if (price < lo) return Math.max(0, 1 - (lo - price) / Math.max(lo, 1));
    return Math.max(0, 1 - (price - hi) / hi);
  }

  function fitFor(cfg, hay, g, price) {
    if (g !== 'u' && g !== cfg.gender) return 0;       // genere incompatibile
    const pos = countMatches(cfg.pos, hay);
    if (pos === 0) return 0;                            // serve almeno un segnale di stile
    const neg = countMatches(cfg.neg, hay);
    const net = pos - 0.8 * neg;
    if (net <= 0) return 0;
    const base = Math.min(net / 2, 1);                 // 2+ segnali = pieno
    let fit = 0.75 * base + 0.25 * priceFit(price, cfg.price);
    if (g === cfg.gender) fit = Math.min(1, fit * 1.1); // bonus genere esplicito
    return fit;
  }

  // Classifica un prodotto nel modello che meglio lo rappresenta.
  // Ritorna { model, fit } con fit 0..1; model null se non rientra in nessuna nicchia.
  function classify(title, cats, price, l1Hint) {
    const hay = [title || '', ...(Array.isArray(cats) ? cats : [cats || ''])].join(' || ').toLowerCase();
    if (EXCLUDE.test(hay)) return { model: null, fit: 0 };
    const g = genderOf(hay, l1Hint);
    let best = null, bestFit = 0;
    for (const id of Object.keys(CFG)) {
      const f = fitFor(CFG[id], hay, g, price);
      if (f > bestFit) { bestFit = f; best = id; }
    }
    return bestFit >= 0.2 ? { model: best, fit: Math.round(bestFit * 100) / 100 } : { model: null, fit: 0 };
  }

  const API = { MODELS, classify, genderOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Models = API;
})(typeof window !== 'undefined' ? window : globalThis);
