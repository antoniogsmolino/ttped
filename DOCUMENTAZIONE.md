# 📘 TTPED Studio — Documentazione tecnica

**TikTok Shop Trend Radar + Affiliate Intelligence** per il profilo **Sharon Rapisarda** (moda donna, mercato Italia).
La dashboard ha **3 sezioni** (tab): **Abbigliamento** (abiti, bottom, top), **Accessori**, **Intimo**. Ogni sezione ha tre viste: **🏆 Migliori** (massimo potenziale di vendita), **🚀 Emergenti** (in forte crescita), **🎯 Per te** (simili ai tuoi vincenti).
Resoconto completo di funzionalità, fonti dati e formule.

- **Dashboard live:** https://antoniogsmolino.github.io/ttped/
- **Repo:** `antoniogsmolino/ttped`
- Ultimo aggiornamento doc: 2026-06-15

---

## Indice
1. [Panoramica e architettura](#1-panoramica-e-architettura)
2. [Fonte dati: FastMoss](#2-fonte-dati-fastmoss)
3. [Pipeline di scraping](#3-pipeline-di-scraping)
4. [Classificazione nelle 3 sezioni](#4-classificazione-nelle-3-sezioni)
5. [Metriche e formule](#5-metriche-e-formule)
6. [Formula di ranking completa](#6-formula-di-ranking-completa)
7. [Le tre finestre temporali](#7-le-tre-finestre-temporali)
8. [Vista "Per te" (personalizzazione)](#8-vista-per-te-personalizzazione)
9. [Modulo Affiliate](#9-modulo-affiliate)
10. [Automazione e alert](#10-automazione-e-alert)
11. [Struttura file e formati dati](#11-struttura-file-e-formati-dati)
12. [Privacy e sicurezza](#12-privacy-e-sicurezza)
13. [Limiti noti e manutenzione](#13-limiti-noti-e-manutenzione)
14. [Versione full locale](#14-versione-full-locale-opzionale)

---

## 1. Panoramica e architettura

TTPED Studio esiste in **due modalità**:

### A) Versione cloud (attualmente in produzione)
Dashboard statica gratuita, senza server sempre acceso.

```
┌─────────────────────┐     cron giornaliero      ┌──────────────────────┐
│   GitHub Actions     │ ───  node scripts/  ────► │   FastMoss API       │
│  (.github/workflows) │      scrape.js            │  (classifiche + cerca)│
└─────────┬───────────┘                            └──────────────────────┘
          │ scrive + committa
          ▼
   docs/data/*.json  ──────►  GitHub Pages (docs/)  ──────►  Browser utente
   (trends, products,         dashboard statica              (desktop/mobile)
    status)                   + affiliate client-side
```

- **GitHub Actions** esegue lo scraping ogni mattina (cron) e a comando, committando i JSON in `docs/data/`.
- **GitHub Pages** serve la cartella `docs/`: la dashboard legge i JSON statici.
- L'**analisi affiliate gira interamente nel browser** (nessun dato di vendita lascia il dispositivo).
- Nessun database: tutto in file JSON; lo storico vive in `docs/data/products.json` (versionato in git).

### B) Versione full locale (opzionale, non deployata)
`server.js` (Express) aggiunge generazione video AI (Freepik: Nano Banana 2 → Kling 2.5), pubblicazione/programmazione TikTok e login con password. Vedi §14.

### Stack
- **Runtime:** Node.js ≥ 18 (Actions usa Node 22). Nessuna dipendenza npm per lo scraper (solo moduli core + `fetch` globale).
- **Frontend:** HTML/CSS/JS vanilla, nessun build step.
- **Persistenza:** file JSON.

---

## 2. Fonte dati: FastMoss

I trend provengono dall'API pubblica di **FastMoss** (piattaforma di analytics per TikTok Shop). Non esistono API ufficiali pubbliche di TikTok Shop per i trend di vendita.

### Endpoint usati
| Endpoint | Uso |
|---|---|
| `GET /api/goods/saleRank` | Classifica per vendite, filtrabile per categoria/periodo |
| `GET /api/goods/popRank` | Classifica per popolarità |
| `GET /api/goods/V2/search` | Ricerca per keyword (include lo **storico vendite 7 giorni** per prodotto) |
| `GET /api/goods/goodsCategory` | Albero categorie (mappatura `l1_cid`) |

### Parametri chiave
- `region=IT` — mercato Italia.
- `l1_cid` — categoria di primo livello TikTok Shop: **`2` = Womenswear & Underwear**, **`8` = Fashion Accessories**.
- `date_type` — **`1` = giornaliero**, **`2` = settimanale**.
- `page`, `pagesize`.

### Autenticazione
Header `Cookie` di sessione FastMoss (contiene il token `fd_tk`), più header `lang: EN_US`, `source: pc`, `region: IT`.
Nel deploy cloud il cookie è il **GitHub Secret `FASTMOSS_COOKIE`**; lo scraper lo legge da `process.env.FASTMOSS_COOKIE`.

### Limiti per piano (verificati sul campo)
| Piano | Risultato |
|---|---|
| Anonimo | liste generiche da 5 item, keyword/filtri ignorati |
| **Free** (cookie utente) | liste da **10 item** (solo pagina 1), **filtri categoria `l1_cid` attivi**, **ricerca keyword attiva** con storico 7gg |
| A pagamento | in più paginazione oltre pagina 1 |

Codici risposta: `200` e `MAG_AUTH_3004` = dati validi; `MAG_AUTH_3006/3011` = limite di piano → arriva una lista-fallback USA che il tool **riconosce e scarta** (`isRealData()`).

---

## 3. Pipeline di scraping

File: [`lib/scraper.js`](lib/scraper.js), entry point [`scripts/scrape.js`](scripts/scrape.js).

### Sequenza (funzione `runScrape()`)
1. **Classifiche** — per le categorie donna (`l1_cid=2` Womenswear & Underwear, `l1_cid=8` Accessori), per ogni tipo (`saleRank`, `popRank`), per ogni periodo (`date_type=1` e `2`), fino a 4 pagine:
   `GET /api/goods/{kind}?region=IT&pagesize=10&date_type={1|2}&l1_cid={2|8}`
2. **Ricerca keyword** — keyword moda donna (`pantaloni donna`, `abito donna`, `top donna`, `accessori donna`, …) via `GET /api/goods/V2/search?words=…`, che fornisce per ogni prodotto l'array `trend` con le **vendite giornaliere degli ultimi 7 giorni** e la commissione.
3. **Dedup e merge** (`collect()`): a parità di prodotto su più fonti, tiene i dati migliori — descrizione/categorie dalla ricerca (più ricca), e il **massimo** per i campi numerici (commissione, saturazione, volume).
4. **Storico** (`mergeHistory()`): aggiorna `products.json`. Lo storico 7gg di FastMoss è autoritativo e sovrascrive le date che copre. Saturazione e commissione vengono mantenute al massimo tra giorni (un valore 0 transitorio non cancella un dato già noto). I prodotti spariti da > 30 giorni vengono rimossi.
5. **Pubblicazione** (`computeAllRankings()`): calcola le classifiche per sezione/vista e scrive `trends.json`.

### Campi normalizzati per prodotto
`id, title, cover, price, currency, cats[], shop, soldDaily, soldTotal, amountDaily, incRate, commissionRate, creators (total_author_count), videosCount, sold7, sold14, rating, region, tiktokUrl, fastmossUrl`.

- `creators` = `total_author_count` = **numero di affiliate che hanno già spinto il prodotto** (= saturazione).
- `commissionRate` = percentuale di commissione affiliate.

---

## 4. Classificazione nelle 3 sezioni

File: [`docs/models.js`](docs/models.js) — modulo **condiviso** tra scraper (Node, prodotti in trend) e browser (affiliate, prodotti venduti).

Funzione `classify(title, cats, price, l1Hint)` → `{ model, fit }` (`model` = id sezione o `null`). Profilo **solo donna**: i prodotti uomo vengono esclusi dal gate di genere.

### Logica (in ordine)
1. **Esclusione** (`EXCLUDE`): non-moda (elettronica, casa, beauty, hair care, smartwatch, integratori…) e bambino.
2. **Genere**: `m` (uomo) → escluso. `w`/`u` (donna o unisex) → ammesso.
3. **Sezione** (ordine di match per evitare collisioni): **Intimo** → **Accessori "forti"** → **Abbigliamento** → **Accessori "deboli"**.

| Sezione | Match (estratto) |
|---|---|
| **Intimo** | reggiseno, lingerie, slip, shapewear/shaper/modellante, pigiama, calze, collant, costume/bikini |
| **Accessori** | borse, occhiali/eyewear, gioielli/collane/orecchini/anelli, cappelli, sciarpe, orologi (forti); cinture, guanti (deboli, controllati dopo l'abbigliamento) |
| **Abbigliamento** | abiti, gonne, pantaloni/jeans/shorts/bermuda/leggings, top/maglie/camicie/felpe/giacche, completi/set, tute, body |

L'ordine evita errori come "pantaloni **con cintura**" → Abbigliamento (non Accessori) e "Body **Shaper**" → Intimo. I match usano word-boundary (``) per evitare falsi positivi da sottostringa (es. "orec**chino**" ≠ "chino").

---

## 5. Metriche e formule

Calcolate in `computeRanking()` ([`lib/scraper.js`](lib/scraper.js)).

### 5.1 €/vendita (la metrica che fa i soldi)
```
€/vendita = prezzo × (%commissione / 100)
```
**Lezione dai dati reali (giugno 2026):** Bermuda Miami = 90 ordini ma solo €20 di commissioni (rate 5,1%); Abito Desy = 48 ordini ma €143 di commissioni (rate 21,3%). Stesso volume non significa stesso guadagno: il €/vendita varia di 10× ed è il vero driver delle commissioni. Per questo NON si ottimizzano gli ordini ma le **commissioni**.

### 5.2 Volume
`sold7` = unità vendute negli ultimi 7 giorni (da FastMoss o sommando lo storico). Proxy degli ordini che un video può generare.

### 5.3 Impennata (momentum)
`spike7d` (regressione + accelerazione su 7 giorni) e `windowSpike(recentDays, baselineDays)` (medie su finestre, dati giornalieri). Usate come modificatore di traiettoria e per la vista Emergenti.

### 5.4 Saturazione — perché NON penalizza più
`creators` = `total_author_count` (quanti affiliate vendono il capo). **Non è una penalità**: un prodotto spinto da 217 creator (caso Bermuda Miami) vende lo stesso ogni giorno, perché la concorrenza tra creator non frena la domanda del pubblico. I creator vengono **mostrati come informazione**, non sottratti dallo score. (Versioni precedenti dividevano per i creator: era l'errore corretto qui.)

---

## 6. Formula di ranking

### Filtri di idoneità
- storico non vuoto; visto di recente (`ageDays ≤ MAX_AGE_DAYS`, default 3); sezione = quella del tab; `sold7 ≥ 3` (dev'essere un venditore reale).

### Vista 🏆 Migliori (potenziale di vendita) — default
```
volNorm   = clamp(log10(sold7 + 1) × 33, 0, 100)     // 100u→66, 1000u→99
epsNorm   = clamp(€/vendita × 28, 0, 100)            // €3,6/vendita → 100
momFactor = clamp(1 + impennata7gg/400, 0.7, 1.25)   // declino frena, crescita spinge
score = pesoSezione × (0.55 × volNorm + 0.45 × epsNorm) × momFactor
```
- **55% volume** (quanti ordini potenziali = il "best-seller sicuro")
- **45% €/vendita** (quanto guadagni per ordine)
- × **momentum** (gentile; nessuna penalità saturazione)
- `pesoSezione = 0.6 + 0.4 × fit`

Validazione: con i dati reali, **Abito Desy** (alto volume + alto €/vendita) risulta #1 in Abbigliamento — coincide col vero top-earner dell'utente a giugno.

### Vista 🚀 Emergenti
```
spikeNorm = clamp(impennataRecente, 0, 300) / 3
volFloor  = clamp(log10(sold7 + 1) / 2.2, 0, 1)      // serve un minimo di vendite
score = spikeNorm × (0.6 + 0.4 × volFloor) + 0.25 × min(€/vendita × 8, 25)
```
Per anticipare i vincenti: prodotti in forte crescita con un minimo di volume reale.

### Ordinamento
`score` desc; a parità, **`comm./sett mercato` (€/vendita × volume)** desc. Top 20 per vista.

`computeAllRankings()` → `{ abbigliamento:{migliori,emergenti}, accessori:{...}, intimo:{...} }`.

---

## 8. Vista "Per te" (personalizzazione)

Incrocia la classifica trend con il **tuo storico di conversione** (gli ordini affiliate importati). Tutto **client-side** ([`docs/affiliate.js`](docs/affiliate.js) + [`docs/app.js`](docs/app.js)).

**Per sezione:** la vista "Per te" di ogni tab usa solo gli ordini che `Models.classify` assegna a quella sezione (dal nome prodotto). Il tab Affiliate mostra anche la **ripartizione commissioni per sezione** (Abbigliamento/Accessori/Intimo).

### Profilo personale (`profile(orders)`)
Dai tuoi ordini validi (non annullati), pesati per commissione incassata:
- **keyword vincenti** (`kw`): token del nome prodotto (lunghezza > 3, esclusi stopword come "donna", "stampa", "taglia"…) → somma delle commissioni generate.
- **fascia di prezzo vincente**: `priceMean` = media dei prezzi pesata sulle commissioni; banda `[priceMean × 0.6 , priceMean × 1.6]`.

### Match (`personalMatch(titolo, prezzo)`)
```
kwNorm   = min(1, sommaCommissioni(token in comune) / (maxKw × 1.5))
priceFit = 1 se prezzo ∈ [priceLo, priceHi], altrimenti decadimento lineare verso 0
match    = 0.7 × kwNorm + 0.3 × priceFit
```

### Uso nella dashboard
- **Badge 🎯** sulle classifiche normali per i prodotti con `match ≥ 0.4` (con la motivazione: "capi simili ti hanno già reso (…)", "fascia prezzo che converte per te (~€X)").
- **Pulsante 🎯 Per te**: unisce le tre finestre, tiene i prodotti con `match > 0.15`, e li ordina per `match` poi per `comm./sett mercato`. Mostra i capi in trend più simili a ciò che già ti rende.
- Senza ordini importati la vista invita a importare il CSV/Excel. Più ordini importi, più il profilo è preciso.

---

## 9. Modulo Affiliate

Import e analisi dei tuoi ordini dal **Centro Affiliazione TikTok Shop** (Dati → Analisi ordini → Esporta). 100% nel browser.

### Import: CSV ed Excel (.xlsx)
- **CSV**: parser con auto-rilevamento del separatore (`,` `;` tab), gestione virgolette.
- **XLSX**: lettore nativo senza librerie — decomprime lo ZIP con `DecompressionStream('deflate-raw')`, legge `xl/worksheets/sheet1.xml` con `DOMParser`, supporta sia stringhe inline sia `sharedStrings`.

### Mappatura colonne (export TikTok IT, ~47 colonne)
Il riconoscimento intestazioni è a **due passate** (match esatto, poi per prefisso) per disambiguare le numerose colonne "Commissione…":

| Campo | Colonna TikTok |
|---|---|
| Ordine | `ID ordine` |
| Prodotto | `Nome prodotto` |
| Negozio | `Nome del negozio` |
| Stato | `Stato pagamento ordini` |
| GMV (importo) | `Valore lordo della merce (GMV)` |
| Commissione stimata | `Commissione stimata standard` |
| **Commissione incassata** | **`Importo totale finale guadagnato`** |
| Data | `Data ordine` (gg/mm/aaaa hh:mm:ss) |

> ⚠️ **Trappola evitata:** `Commissione base stimata` e `Base commissione effettiva` sono la **base imponibile (≈ GMV)**, NON la commissione → escluse esplicitamente.
> L'export non ha la colonna **% commissione**: viene **derivata** come `commissione / GMV × 100`.

Importi gestiti in formato italiano (`1.234,56`) e internazionale; ordini deduplicati per `ID ordine`; storage in `localStorage`.

### Analytics (`analytics(orders)`)
- `commissionOf(o)` = `actualCommission || estCommission`.
- Ordini **validi** = non annullati/rimborsati (`isCancelled`).
- Aggregati per **prodotto** e per **seller**: ordini, GMV, commissioni, rate medio, ultimo ordine.
- Serie temporale giornaliera, distribuzione per giorno della settimana e per ora.
- Totali: ordini, GMV, commissioni, % saldati, rate medio.

### Strategia (`strategy(orders, trends)`)
Genera consigli operativi sui tuoi numeri:
1. 🏆 **Prodotti vincenti** — su cui raddoppiare i contenuti.
2. 🔁 **Da rilanciare** — convertivano ma fermi da 2+ settimane.
3. 🤝 **Seller migliori** — con cui negoziare commissioni; alert se uno concentra > 60%.
4. 🚀 **Occasioni calde** — tuoi prodotti che sono ORA in trend (cross-match titoli con la classifica).
5. ⏰ **Timing** — giorno e fasce orarie con più ordini.
6. 📋 **Piano operativo** — allocazione contenuti **60% vincenti / 30% trend nuovi / 10% sperimentale**.

---

## 10. Automazione e alert

### Cron giornaliero
File [`.github/workflows/scrape.yml`](.github/workflows/scrape.yml):
```
cron: '30 5 * * *'   # UTC → ~07:30 in Italia (06:30 in ora solare)
```
Più avvio manuale (`workflow_dispatch`) dal tab **Actions** di GitHub. Il job esegue lo scraping e committa `docs/data/{trends,products,status}.json`.

### Rilevamento cookie FastMoss scaduto
Quando il cookie scade, FastMoss restituisce pochi prodotti. In `scripts/scrape.js`:
```
se (focus attivo) e (prodotti moda donna trovati < 20):
   → NON sovrascrive i dati buoni
   → esce con errore (exit 1)
   → GitHub invia un'email automatica di "workflow fallito"
```
È così che ci si accorge che il cookie va rigenerato (Copy as cURL su una richiesta `www.fastmoss.com/api/…` → aggiornare il Secret `FASTMOSS_COOKIE`).

---

## 11. Struttura file e formati dati

```
TTPED/
├── .github/workflows/scrape.yml   # cron giornaliero
├── scripts/scrape.js              # entry point Actions
├── lib/
│   ├── scraper.js                 # scraping + scoring (cuore del tool)
│   ├── store.js                   # I/O JSON, impostazioni
│   ├── affiliate.js               # (versione full locale)
│   ├── freepik.js / videogen.js   # (versione full: video AI)
│   └── tiktok.js                  # (versione full: publish)
├── docs/                          # ── sito GitHub Pages ──
│   ├── index.html
│   ├── app.js                     # UI, rendering, vista "Per te"
│   ├── affiliate.js               # import CSV/XLSX + analytics + profilo (client-side)
│   ├── styles.css
│   └── data/
│       ├── trends.json            # le 3 classifiche pubblicate
│       ├── products.json          # storico cumulativo (sorgente delle classifiche)
│       └── status.json            # esito ultimo scraping
├── server.js                      # (versione full locale)
└── DOCUMENTAZIONE.md              # questo file
```

### `trends.json`
```jsonc
{
  "status": { "lastRun", "ok", "count", "matched", "limited", "region", "focus", "error" },
  "generatedAt": "ISO",
  "top": [ /* unione di tutti i modelli (d7): per il cross-match affiliate */ ],
  "rankings": {
    "abbigliamento": { "migliori": [ /*top 20*/ ], "emergenti": [ /*…*/ ] },
    "accessori":     { "migliori": [ … ], "emergenti": [ … ] },
    "intimo":        { "migliori": [ … ], "emergenti": [ … ] }
  }
}
```
Ogni elemento `trend` include: `view`, `model` (id sezione), `score`, `spikePct`, `euroPerSale`, `marketComm` (€ commissioni/sett di mercato = €/vendita × volume), `sold7`, `creators`, `videos`, `priceValue`, `spark`.
Ogni elemento ha il prodotto + un oggetto `trend`:
```jsonc
"trend": {
  "window": "d7|h48|h24",
  "score": 86.2,
  "spikePct": 184.6,        // impennata della finestra
  "euroPerSale": 2.7,       // €/vendita
  "marketComm": 1167,       // € commissioni/sett di mercato (€/vendita × volume)
  "creators": 12,           // affiliate che lo vendono (info, non penalizza)
  "videos": 47,
  "priceValue": 27.0,
  "sold7": 333,
  "catLabel": "Pantaloni donna",
  "days": 8,                // giorni di storico
  "spark": [ { "date", "v" }, … ]  // sparkline 14gg
}
```

---

## 12. Privacy e sicurezza

- I **dati di vendita affiliate** (CSV/XLSX) sono elaborati **solo nel browser** e salvati in `localStorage` del dispositivo: **non vengono mai caricati online**.
- Il **cookie FastMoss** è un GitHub Secret cifrato, mai presente nel codice del repo.
- `.gitignore` esclude dal repo pubblico: `*.xlsx`, `*.csv`, `affiliate_orders*`, `/data/` (dati versione full), snapshot.
- La versione full (locale) protegge l'accesso con `ACCESS_PASSWORD` e sessioni; le chiavi (Freepik, TikTok) restano in `data/settings.json` sul dispositivo.

---

## 13. Limiti noti e manutenzione

- **Granularità giornaliera**: "24h/48h" sono approssimazioni su dati giornalieri (FastMoss non espone dati orari).
- **Conteggi FastMoss**: sono il tracking di un osservatore esterno, non i numeri ufficiali interni di TikTok (standard del settore).
- **Saturazione = informazione, non penalità**: i creator che vendono il capo sono mostrati ma non abbassano lo score (un best-seller resta tale anche con tanti creator).
- **Piano free**: 10 item per lista, solo pagina 1; con un piano FastMoss a pagamento il tool pagina automaticamente e raccoglie di più.
- **Cookie**: scade ogni qualche settimana → email automatica di workflow fallito → rigenerare il Secret.
- **Link "Cerca su TikTok"**: le pagine prodotto di TikTok Shop sono deep-link app bloccati per regione sul web (502), quindi il pulsante fa una **ricerca per nome** (affidabile da loggati, mostra i video già fatti sul capo).

---

## 14. Versione full locale (opzionale)

Non deployata, presente nel repo per uso locale.

```bash
npm install
npm start          # → http://127.0.0.1:4280
```

Aggiunge:
- **🎬 Video Studio** — pipeline AI via **API Freepik**: prompt → immagine (Nano Banana 2, 9:16) → video (Kling 2.5 Pro, 10s) → download MP4 con caption/hashtag. Generazione automatica giornaliera dei top prodotti.
- **Pubblicazione TikTok** — Content Posting API (OAuth), pubblicazione immediata o programmata (coda locale).
- **⚙️ Impostazioni** — chiavi API, cookie, cron, regione.

> ⚠️ L'API Freepik è fatturata a **crediti API separati dal piano Unlimited** della webapp.
> Per esporre la versione full su un server: `ACCESS_PASSWORD`, `HOST=0.0.0.0`, `PUBLIC_URL` (vedi `Dockerfile` / `deploy/provision.sh`).

---

*Documento generato per TTPED Studio. Per modifiche alle formule vedi `lib/scraper.js` (funzioni `computeRanking`, `spike7d`, `windowSpike`, `videoEarnings`, `euroPerSale`, `categoryMatch`).*
