/* TTPED — classificatore in 3 sezioni per il profilo Sharon Rapisarda (solo donna).
   Usato sia dallo scraper (Node, prodotti in trend) sia dal browser (affiliate, vendite). */
(function (root) {
  'use strict';

  // Le 3 sezioni (= i tab della dashboard). Ordine = ordine dei tab.
  const MODELS = [
    { id: 'abbigliamento', name: 'Abbigliamento', emoji: '👗', tag: 'Abiti · bottom · top — donna',
      desc: 'Tutto l\'abbigliamento donna: abiti, gonne, pantaloni, jeans, shorts/bermuda, top, maglie, camicie, felpe, giacche, completi. I capi da indossare nei video.' },
    { id: 'accessori', name: 'Accessori', emoji: '👜', tag: 'Borse · occhiali · gioielli · cinture',
      desc: 'Accessori moda: borse e tracolle, occhiali da sole, gioielli, cinture, cappelli, accessori per capelli. Separati dall\'abbigliamento per non confonderli.' },
    { id: 'intimo', name: 'Intimo', emoji: '🩲', tag: 'Lingerie · reggiseni · pigiami · shapewear',
      desc: 'Intimo e lingerie: reggiseni, slip, body modellanti/shapewear, pigiami e homewear, calze e collant, costumi.' },
  ];

  // Esclusioni: non-moda + bambino (l'uomo è gestito dal gate di genere).
  const EXCLUDE = /power tools|personal care|appliance|electronic|\bphone|computer|automotive|motorcycle|kitchen|household|home supplies|furnitur|\bpet\b|hardware|\bbook|\btoy|grocery|beverage|stationery|collectible|musical|fitness equipment|outdoor recreation|bath|body care|skincare|hair care|haircare|deodor|\bcrema\b|sapone|shampoo|balsam|conditioner|\bsiero\b|olio per capelli|batana|integrat|vitamin|profum|fragranz|makeup|mascara|rossetto|smalto|rasoio|shaver|trimmer|epilat|igiene|supplement|aliment|cucina|arred|monopattin|attrezz|elettrodom|smartwatch|smart ?watch|orologio intelligente|fitness tracker|smartband|safety|antinfortun|work &|\bletto\b|lenzuol|\bbedding|federe|copripiumin|copriletto|tovagli|asciugam|\btenda\b|\btende\b|cuscin|tappeto|microfibra|\bkid|child|toddler|\bbaby\b|neonat|bambin/i;

  function genderOf(hay, l1Hint) {
    if (/\bwomen|woman|\bdonna|donne|femmin|\blady|ladies|\bgirl/.test(hay)) return 'w';
    if (/\bmen'?s\b|\buomo\b|uomini|\bman\b|maschil|homme/.test(hay)) return 'm';
    if (l1Hint === 'womenswear') return 'w';
    if (l1Hint === 'menswear') return 'm';
    return 'u';
  }

  // Sezioni. L'ordine di controllo conta: intimo → accessori "forti" → abbigliamento → accessori "deboli".
  const INTIMO = /reggiseno|reggicalze|\bbra\b|bralette|lingerie|\bintimo\b|mutand|perizoma|culotte|boxer|\bslip\b|shapewear|shaper|shaping|modellante|guaina|contenitiv|pigiam|camicia da notte|sleepwear|homewear|\bcalze\b|collant|autoregg|costume da bagno|\bbikini|swimwear/i;
  // Accessori inequivocabili (nomi che non compaiono nei titoli di abbigliamento).
  const ACC_STRONG = /\bborse?\b|handbag|tracoll|marsup|\bzaino|backpack|portafogl|wallet|cappell|\bhat\b|berretto|occhial|eyewear|sunglass|sciarp|foulard|\bscarf|gioiell|jewel|collan|necklace|orecchin|earring|braccial|\banello\b|cerchiett|fermagl|scrunchie|hair ?clip|orolog|\bwatch\b/i;
  const ABBIGLIAMENTO = /abito|abiti|vestit|\bdress|gonna|\bskirt|pantalon|\bjeans\b|\bshort|bermuda|legging|\btop\b|maglia|maglion|maglieri|\bknit|camici|felp[ae]|hoodie|giacc|cappotto|blazer|cardigan|\btuta\b|jumpsuit|salopette|completo|coordinato|\bset\b|canotta|\btank\b|t-?shirt|tubino|\bbody\b|\bcrop|two ?piece|due pezzi|2 ?pezzi|romper|playsuit|overall/i;
  // Accessori che però possono apparire dentro titoli di capi ("pantaloni con cintura"): controllati DOPO l'abbigliamento.
  const ACC_WEAK = /cintur|\bbelt\b|guant|\bglove/i;

  // Classifica un prodotto in una sezione (solo donna/unisex). { model, fit } o { model:null }.
  function classify(title, cats, price, l1Hint) {
    const hay = [title || '', ...(Array.isArray(cats) ? cats : [cats || ''])].join(' || ').toLowerCase();
    if (EXCLUDE.test(hay)) return { model: null, fit: 0 };
    const g = genderOf(hay, l1Hint);
    if (g === 'm') return { model: null, fit: 0 };            // niente uomo
    const womanSure = g === 'w' || l1Hint === 'womenswear';
    if (INTIMO.test(hay)) return { model: 'intimo', fit: womanSure ? 1 : 0.85 };
    if (ACC_STRONG.test(hay)) return { model: 'accessori', fit: 0.9 };
    if (ABBIGLIAMENTO.test(hay) || l1Hint === 'womenswear') return { model: 'abbigliamento', fit: womanSure ? 1 : 0.85 };
    if (ACC_WEAK.test(hay)) return { model: 'accessori', fit: 0.85 };
    return { model: null, fit: 0 };
  }

  // ---------- Creator ----------
  const CREATORS = [
    { id: 'sharon', name: 'Sharon', emoji: '👑', tag: 'Moda donna — tutti i best-seller' },
    { id: 'alena', name: 'Alena', emoji: '✨', tag: 'Gen-Z / young — trendy e virali' },
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Tassonomia estetica Gen-Z (top, denim, pantaloni, shorts, gonne, abiti, set, felpe, giacche,
  // beachwear, activewear/pilates, scarpe, borse, accessori capelli, bijoux, occhiali, aesthetics).
  // Termini distintivi (non i generici "top"/"dress" che hanno tutti), in italiano e inglese.
  const GENZ_POS = new RegExp([
    // top
    'baby ?tee', 'ringer', 'shrunken', 't-?shirt (crop|corta|aderente|grafica|fitted)', '\\bcrop', 'cropp', 'tube top', 'bandeau', 'top a fascia', '\\bhalter', 'off ?shoulder', 'one ?shoulder', 'monospalla', 'bardot', 'spalle scoperte', 'bow top', 'tie ?front', 'annodat', 'lace ?up', 'ruched', 'arricciat', 'drappeggiat', 'ribbed', 'a costine', 'racerback', '\\bcami\\b', 'corset', 'bustier', '\\bmesh', 'crochet', 'uncinet', 'cut ?out', 'open ?back', 'schiena scoperta', 'polo crop', 'bolero', 'shrug', 'coprispalle',
    // denim + pantaloni + shorts
    'baggy', 'wide ?leg', '\\bcargo', 'parachute', 'boyfriend', 'mom fit', 'barrel', 'balloon', 'slouchy', 'puddle', 'jorts', 'ripped', 'strappat', 'low ?rise', 'low ?waist', 'vita bassa', 'drawstring', 'coulisse', '\\bflare', 'capri', 'pinocchiett', 'culotte', 'utility', 'boxer short', 'dolphin', 'sweat ?short', 'micro ?short',
    // gonne
    'minigonna', 'mini ?skirt', 'pleated', 'plissett', 'plissé', 'tennis skirt', 'gonna tennis', '\\bskort', 'cargo skirt', 'denim skirt', 'wrap skirt', 'gonna pareo', 'ruffle', 'a balze', 'coquette',
    // abiti
    'mini ?dress', 'abito (corto|mini|cami)', 'bodycon', 'slip dress', 'sottoveste', 'babydoll', 'bubble dress', 'tennis dress', 't-?shirt dress', 'party dress', 'going out',
    // set
    'two ?piece', 'co-?ord', 'coordinat', 'due pezzi', '2 ?pezzi', 'set (top|crop|fascia|halter|crochet|lino|tennis|denim|cargo)',
    // felpe / streetwear
    'hoodie', 'oversize', 'zip ?hoodie', 'college', 'varsity', 'tracksuit', 'quarter zip', 'mezza zip', 'bomber', 'track jacket', 'windbreaker',
    // beach / holiday
    'bikini', 'cover ?up', 'copricostume', 'pareo', 'kaftano', 'straw bag', 'borsa paglia',
    // activewear / pilates
    'pilates', 'biker short', 'flare legging', 'yoga', 'sports bra', 'racerback',
    // scarpe
    'ballet ?flat', 'ballerin', 'mary ?jane', 'platform', 'slingback', 'kitten heel', 'cowboy boot', 'chunky', 'jelly sandal',
    // borse
    'baguette', 'crescent', 'hobo', 'mini bag', 'belt bag', 'marsup', 'crossbody', 'tote', 'tracolla',
    // capelli / bijoux / occhiali
    'fiocc', '\\bbow', 'claw clip', 'butterfly clip', 'mollett', 'scrunchie', 'cerchietto', 'headband', 'ribbon', 'choker', 'layered', 'perl', 'small hoop', 'stack ring', 'bag charm', 'cat ?eye', 'small sunglass', 'occhiali (piccoli|ovali|y2k)', 'trucker', 'bucket hat', 'baseball cap',
    // intimo fashion
    'bralette', 'bodysuit', '\\bbody\\b', 'seamless',
    // aesthetics
    'y2k', 'coquette', 'balletcore', 'tenniscore', 'preppy', 'clean girl', 'soft girl', 'streetwear', 'grunge', 'indie', 'gingham', 'a quadrett', 'animalier', 'leopard', 'a righe', 'striped', 'graphic', 'grafica', 'denim',
  ].join('|'), 'i');

  // Stili "maturi / da signora" (sezione da evitare per Alena).
  const GENZ_NEG = /tailleur|cerimonia|\btubino\b|tunica|\bufficio\b|formale|shapewear|modellante|guaina|contenitiv|décolleté|decolt[eé]|over ?40|da signora|giacca pantalone classic|cappotto classic|palazzo elegante|business|blazer sartorial/i;

  // Quanto un prodotto è "Gen-Z / young" (0..1): match con la tassonomia + prezzo basso, meno stili maturi.
  function genZFit(title, cats, price) {
    const hay = [title || '', ...(Array.isArray(cats) ? cats : [cats || ''])].join(' ').toLowerCase();
    const hits = (hay.match(new RegExp(GENZ_POS.source, 'gi')) || []).length;
    if (hits === 0) return price > 0 && price <= 15 ? 0.2 : 0.05; // niente segnale Gen-Z esplicito → quasi escluso
    const style = Math.min(1, 0.6 + 0.2 * (hits - 1)); // 1 segnale=0.6, 2=0.8, 3+=1.0
    const mature = GENZ_NEG.test(hay) ? 1 : 0;
    const cheap = price > 0 ? clamp((30 - price) / 30, 0, 1) : 0.4; // sotto ~€30 = giovane
    return clamp(0.6 * style + 0.25 * cheap + 0.15 - 0.6 * mature, 0, 1);
  }

  const API = { MODELS, CREATORS, classify, genderOf, genZFit };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Models = API;
})(typeof window !== 'undefined' ? window : globalThis);
