# 📘 TTPED Studio — Documentazione tecnica

**TikTok Shop Trend Radar + Affiliate Intelligence** per un profilo con **4 modelli/sotto-nicchie** (mercato Italia).
La dashboard ha un tab per ogni modello (Sofia, Emma, Marco, Luca); ogni tab mostra i prodotti in trend filtrati per la sua nicchia, con le viste 7 giorni / 48 ore / 24 ore / Per te.
Resoconto completo di funzionalità, fonti dati e formule.

- **Dashboard live:** https://antoniogsmolino.github.io/ttped/
- **Repo:** `antoniogsmolino/ttped`
- Ultimo aggiornamento doc: 2026-06-15

---

## Indice
1. [Panoramica e architettura](#1-panoramica-e-architettura)
2. [Fonte dati: FastMoss](#2-fonte-dati-fastmoss)
3. [Pipeline di scraping](#3-pipeline-di-scraping)
4. [Classificazione categorie moda donna](#4-classificazione-categorie-moda-donna)
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
1. **Classifiche** — per ogni categoria (`l1_cid=2`, `l1_cid=8`, e senza filtro), per ogni tipo (`saleRank`, `popRank`), per ogni periodo (`date_type=1` e `2`), fino a 4 pagine:
   `GET /api/goods/{kind}?region=IT&pagesize=10&date_type={1|2}&l1_cid={2|8}`
2. **Ricerca keyword** — 14 keyword moda donna (`pantaloni donna`, `abito donna`, `top donna`, `accessori donna`, …) via `GET /api/goods/V2/search?words=…`, che fornisce per ogni prodotto l'array `trend` con le **vendite giornaliere degli ultimi 7 giorni** e la commissione.
3. **Dedup e merge** (`collect()`): a parità di prodotto su più fonti, tiene i dati migliori — descrizione/categorie dalla ricerca (più ricca), e il **massimo** per i campi numerici (commissione, saturazione, volume).
4. **Storico** (`mergeHistory()`): aggiorna `products.json`. Lo storico 7gg di FastMoss è autoritativo e sovrascrive le date che copre. Saturazione e commissione vengono mantenute al massimo tra giorni (un valore 0 transitorio non cancella un dato già noto). I prodotti spariti da > 30 giorni vengono rimossi.
5. **Pubblicazione** (`computeAllRankings()`): calcola le 3 classifiche e scrive `trends.json`.

### Campi normalizzati per prodotto
`id, title, cover, price, currency, cats[], shop, soldDaily, soldTotal, amountDaily, incRate, commissionRate, creators (total_author_count), videosCount, sold7, sold14, rating, region, tiktokUrl, fastmossUrl`.

- `creators` = `total_author_count` = **numero di affiliate che hanno già spinto il prodotto** (= saturazione).
- `commissionRate` = percentuale di commissione affiliate.

---

## 4. Classificazione nelle 4 sotto-nicchie (modelli)

File: [`docs/models.js`](docs/models.js) — modulo **condiviso** tra scraper (Node, per i prodotti in trend) e browser (affiliate, per i prodotti venduti), così la stessa logica assegna sia i trend sia le vendite.

Funzione `classify(title, cats, price, l1Hint)` → `{ model, fit }` con `fit` 0–1; `model` è `null` se il prodotto non rientra in nessuna nicchia.

### Logica
1. **Esclusione** (`EXCLUDE`): scarta non-moda (power tools, personal care, elettronica, casa, beauty, integratori, rasoi…), bambino e calzature speciali (safety).
2. **Genere** (`genderOf`): `w` se titolo/categoria contiene `donna/women/lady/…`, `m` se `uomo/men/…`, altrimenti l'hint della categoria TikTok (`womenswear`/`menswear`), altrimenti `u` (unisex, es. accessori).
3. **Fit per modello**: per ognuno dei 4 modelli, gate di genere + conteggio keyword pro/contro + affinità di prezzo. Si assegna il modello con fit più alto (≥ 0.20).

| Modello | Genere | Prezzo ideale | Keyword pro (estratto) |
|---|---|---|---|
| **Sofia** (Streetwear/Y2K) | donna | €0–30 | baggy, crop, oversize, denim, felpa, sneakers chunky, mini-bag, occhiali, cerchietti, body |
| **Emma** (Minimal/Clean girl) | donna | €20–90 | blazer, abito, tubino, bustino, sartoriale, jeans dritti, maglieria, mocassini, camicia, raso |
| **Marco** (Uomo elegante) | uomo | €35–250 | maglione, camicia oxford, chino, cappotto/trench, blazer, polo, mocassini, lino, cashmere |
| **Luca** (Uomo sport) | uomo | €0–45 | tuta, felpa, hoodie, jogger, t-shirt tecnica, sneakers sportive, cappellino, shorts |

### Calcolo del fit
```
gate genere: se il genere del prodotto ≠ genere del modello (e non è unisex) → fit 0
pos = nº keyword positive trovate (deve essere ≥ 1)
neg = nº keyword negative trovate
net = pos − 0.8 × neg            (se ≤ 0 → fit 0)
base = min(net / 2, 1)           (2+ segnali = pieno)
fit  = 0.75 × base + 0.25 × priceFit(prezzo, fascia)
       × 1.1 se il genere combacia esplicitamente
```
Nel ranking, `fit` diventa il **peso categoria**: `weight = 0.5 + 0.5 × fit` (i capi più aderenti alla nicchia salgono). Dettagli tecnici importanti: i match usano i **word-boundary** (`\b`) per evitare falsi positivi da sottostringa (es. "orec**chino**" ≠ pantaloni "chino").

> La classificazione è euristica (titolo + categoria + prezzo): i casi ambigui (es. un denim maxi-dress tra Sofia ed Emma) sono inevitabili. Le keyword sono in `docs/models.js` (`CFG`) e si possono affinare.

---

## 5. Metriche e formule

Tutte le metriche sono calcolate in `computeRanking()` ([`lib/scraper.js`](lib/scraper.js)).

### 5.1 Impennata (spike)
Quanto stanno accelerando le vendite. Tre varianti (vedi §7). Usano lo storico vendite giornaliero.

**Pendenza** (`slopeScore`): regressione lineare sui (max) 7 punti giornalieri, normalizzata sulla media → % di crescita media al giorno.

**Impennata 7 giorni** (`spike7d`), con ≥ 4 giorni di storico:
```
k       = min(3, floor(n/2))           // n = giorni disponibili
accel   = (media(ultimi k gg) / media(gg precedenti) − 1) × 100
spike7d = 0.6 × accel + 0.4 × pendenza
```
Fallback con storico scarso: `(sold7 / (sold14 − sold7) − 1) × 100`, altrimenti `incRate` di FastMoss.

**Impennata finestra** (`windowSpike(recentDays, baselineDays)`):
```
windowSpike = (media(giorni recenti) / media(giorni baseline) − 1) × 100
```
Restituisce `null` se lo storico è insufficiente (il prodotto viene escluso da quella classifica).

### 5.2 Guadagno per vendita (€/vendita)
Il numero che conta davvero, non la percentuale:
```
€/vendita = prezzo × (%commissione / 100)
```
Es.: capo da €27 al 10% = **€2,70**, batte un €15 al 12% = €1,80.
Il prezzo è estratto da stringhe miste ("€7,80", "19,92 - 31,60 €" → si prende il primo valore).

### 5.3 Guadagno atteso per video (€/video) — saturazione
Il €/vendita è metà del conto; l'altra metà è **quante vendite porta realisticamente un tuo nuovo video**, che dipende dalla **saturazione** (quanti affiliate già spingono il capo).
```
affiliate     = creators (total_author_count di FastMoss)
denominatore  = affiliate > 0 ? affiliate + 1 : 15     // +1 = il tuo video; 15 = fallback prudente se dato assente
venditePerVideo = min( vendite7gg / denominatore , 12 ) // cap realistico: un video fa una manciata di vendite/sett.
€/video atteso  = €/vendita × venditePerVideo
```
**Interpretazione:** tanta domanda + pochi affiliate ⇒ ogni video cattura più vendite (spazio); tanti affiliate ⇒ mercato saturo, il tuo video rende meno.

**Taratura sui dati reali (giugno 2026):** il cap è **12 vendite/video/settimana** (non 60). I capi di punta dell'utente fanno ~0,5–1,3 vendite/giorno per prodotto su più video: un singolo nuovo video ne porta una manciata, non decine. Un cap troppo alto sovrastimava di 5–6× il €/video dei capi ad alto volume, spingendoli falsamente in cima. Con commissione mediana reale ~6,3% (range 1,6–35%) il €/vendita è modesto, quindi il moltiplicatore "vendite per video" pesa molto: un cap realistico è cruciale. Il fallback saturazione è **15** (alto e conservativo) per non far scavalcare i capi con dati veri da quelli mal tracciati.

### 5.4 Volume
`sold7` = vendite degli ultimi 7 giorni (da FastMoss o sommando lo storico).

---

## 6. Formula di ranking completa

Per ogni prodotto idoneo si calcola uno **score 0–100** e si ordina in modo decrescente.

### Filtri di idoneità
- storico non vuoto;
- visto negli ultimi **3 giorni** (`ageDays ≤ 3`, altrimenti considerato "morto");
- è moda donna (se il focus categoria è attivo);
- l'impennata della finestra non è `null`.

### Normalizzazioni (ognuna 0–100)
```
spikeNorm = clamp(impennata, 0, 200) / 2          // 200%+ = massimo (oltre è rumore)
euroNorm  = clamp(€/vendita × 20, 0, 100)         // €5/vendita → 100
videoNorm = clamp(log10(€/video + 1) × 55, 0, 100)// scala logaritmica
```

### Score finale
```
score = pesoCategoria × ( 0.50 × spikeNorm
                        + 0.35 × videoNorm
                        + 0.15 × euroNorm )
```
- **50% impennata** (timing: cosa accelera ora)
- **35% guadagno atteso €/video** (opportunità reale, già al netto di saturazione e volume)
- **15% guadagno €/vendita** (ricchezza per vendita)
- × **peso categoria** (1.0 / 0.95 / 0.75)

### Ordinamento
1. `score` decrescente.
2. A parità di score: **`€/video atteso` decrescente** (a parità di trend, vince chi ti fa guadagnare di più).

Si pubblicano i **top 20** per ogni finestra.

> **Nota sul cap dell'impennata a 200%:** sopra il 200% lo spike è considerato "già esploso" e non differenzia più; questo crea volutamente più "pareggi" in cima, dove decide il guadagno €/video. È coerente con l'obiettivo: tra i capi che stanno esplodendo, conta quanto ti rendono.

---

## 7. Le tre finestre temporali

La dashboard mostra **tre classifiche selezionabili**, stessa formula ma con impennata calcolata su orizzonti diversi:

| Pulsante | Funzione | Confronto (dati giornalieri) |
|---|---|---|
| 📈 **7 giorni** | `spike7d` | media ultimi 3gg vs precedenti + pendenza |
| ⚡ **48 ore** | `windowSpike(2, 2)` | ultimi 2 giorni vs i 2 precedenti |
| 🔥 **24 ore** | `windowSpike(1, 1)` | ultimo giorno vs il precedente |

> ⚠️ **Granularità:** i dati FastMoss sono **giornalieri**, non orari. Quindi "24 ore" = ultimo giorno vs precedente, "48 ore" = ultimi 2 giorni vs i 2 prima. Serve a far emergere le accelerazioni recenti rispetto al trend di 7 giorni che guarda più indietro.

`computeAllRankings()` produce `{ d7, h48, h24 }`, ciascuna una top 20.

---

## 8. Vista "Per te" (personalizzazione)

Incrocia la classifica trend con il **tuo storico di conversione** (gli ordini affiliate importati). Tutto **client-side** ([`docs/affiliate.js`](docs/affiliate.js) + [`docs/app.js`](docs/app.js)).

**Per modello:** la vista "Per te" di ogni tab usa solo gli ordini che `Models.classify` assegna a quel modello (dal nome prodotto), così Sofia consiglia sui vincenti di Sofia, Emma sui suoi, ecc. Il tab Affiliate mostra anche la **ripartizione commissioni per modello**.

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
- **Pulsante 🎯 Per te**: unisce le tre finestre, tiene i prodotti con `match > 0.15`, e li ordina per `match` poi per `€/video atteso`. Mostra i capi in trend più simili a ciò che già ti rende.
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
    "sofia": { "d7": [ /*top 20*/ ], "h48": [ /*…*/ ], "h24": [ /*…*/ ] },
    "emma":  { "d7": [ … ], "h48": [ … ], "h24": [ … ] },
    "marco": { "d7": [ … ], "h48": [ … ], "h24": [ … ] },
    "luca":  { "d7": [ … ], "h48": [ … ], "h24": [ … ] }
  }
}
```
Ogni elemento `trend` include anche `model` (id nicchia) e `fit` (0–1).
Ogni elemento ha il prodotto + un oggetto `trend`:
```jsonc
"trend": {
  "window": "d7|h48|h24",
  "score": 86.2,
  "spikePct": 184.6,        // impennata della finestra
  "euroPerSale": 2.7,       // €/vendita
  "euroPerVideo": 33.75,    // €/video atteso
  "salesPerVideo": 15.0,
  "creators": 12,           // affiliate (saturazione)
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
- **Saturazione assente**: se `total_author_count` non è disponibile, il €/video usa un denominatore prudente (15) e la card mostra "saturazione n/d" — è una stima.
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
