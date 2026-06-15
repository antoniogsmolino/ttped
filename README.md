# 🚀 TTPED Studio

**TikTok Shop Trend & Profit Engine Dashboard** — radar giornaliero dei prodotti in crescita su TikTok Shop, fabbrica di video AI (Freepik: Nano Banana + Kling 2.5) e analisi strategica delle tue vendite affiliate.

## Avvio

```bash
npm install
npm start          # → http://127.0.0.1:4280
```

Per l'avvio automatico all'accensione del Mac puoi usare `pm2` (`npm i -g pm2 && pm2 start server.js --name ttped && pm2 save`).

## I 4 tab

### 🔥 Trend
Classifica dei **top 20 prodotti moda donna realmente su TikTok Shop** (regione default IT), filtrati sulle categorie: **abbigliamento donna, pantaloni donna, top donna, abiti donna, accessori donna** (accessori con priorità ridotta). Il ranking combina:
- **55% impennata vendite ultimi 7 giorni** (media ultimi 3 gg vs 4 precedenti + pendenza, sullo storico giornaliero reale per prodotto fornito da FastMoss),
- **30% commissione affiliate** (più è alta, più sale),
- **15% volume di vendita 7gg**,
- il tutto pesato per categoria (abbigliamento/pantaloni 1.0, top/abiti 0.95, accessori 0.75).

Lo scraping gira ogni mattina su classifiche giornaliere + settimanali e ricerche per keyword di categoria, salva snapshot e accumula lo storico. Il focus categorie si può disattivare nelle Impostazioni.

> 🔒 **Limiti FastMoss per piano** (verificati sul campo):
> - **Anonimo**: liste generiche da 5 item, keyword/filtri ignorati.
> - **Account free** (cookie nelle Impostazioni, anche via "Copy as cURL"): liste da 10 item (solo pagina 1), **classifiche filtrate per categoria TikTok via `l1_cid`** (2 = Womenswear & Underwear, 8 = Fashion Accessories) e **ricerca keyword** via `/api/search/v2/search?words=…` (prodotti in `data.goods.list`, con storico vendite 7gg). Con focus attivo il tool raccoglie ~350 prodotti/giorno di cui ~250 moda donna.
> - **Piano a pagamento**: in più paginazione oltre pagina 1 (il tool pagina automaticamente finché il piano lo consente).
>
> Nota: i codici `MAG_AUTH_3006/3011` indicano limiti di piano e arrivano con una lista-fallback US che il tool riconosce e scarta. Il classificatore moda donna lavora comunque client-side su tutto il raccolto.

### 🎬 Video Studio
Pipeline automatica per ogni prodotto: **prompt → immagine (Nano Banana 2, 9:16) → video (Kling 2.5 Pro, 10s) → download MP4**, con caption e hashtag già pronti.
- "⚡ Genera i 10 video di oggi" sceglie i top prodotti in crescita non ancora coperti; il cron lo fa da solo ogni mattina.
- Ogni video: anteprima, download MP4, **Pubblica ora** o **Programma** su TikTok.

> ⚠️ **Costi Freepik:** l'API Freepik (api.freepik.com) è fatturata **a crediti API, separati dal piano Unlimited della webapp**. Il piano Unlimited copre la generazione su freepik.com/magnific.com ma non le chiamate API. Controlla i prezzi su freepik.com/developers prima di lanciare 10 video/giorno.

### 💰 Affiliate
Importa il CSV ordini dal **Centro Affiliazione TikTok Shop** (Dati → Analisi ordini → Esporta, header IT/EN riconosciuti automaticamente): KPI, commissioni per giorno, top prodotti, top seller e una **strategia operativa generata sui tuoi numeri** (prodotti da raddoppiare, da rilanciare, seller con cui negoziare, incrocio con i prodotti in trend OGGI, timing di pubblicazione, piano dei 10 video giornalieri).

### ⚙️ Impostazioni
- **Freepik API key** ([freepik.com/developers](https://www.freepik.com/developers/dashboard/api-key)) e scelta modelli (fallback automatico nano-banana-2 → nano-banana-pro → gemini-2.5-flash).
- **TikTok**: crea un'app su [developers.tiktok.com](https://developers.tiktok.com) con scope `video.publish` + `video.upload`, registra il redirect URI `http://127.0.0.1:4280/api/tiktok/callback`, inserisci Client Key/Secret e collega l'account.
  - Finché l'app TikTok non supera l'audit, i post sono **forzati privati (SELF_ONLY)** — è un limite di TikTok, non del tool.
  - La programmazione è gestita da una coda locale: il tool deve essere in esecuzione all'orario programmato.
- Regione, cookie FastMoss, orari cron e numero di video giornalieri.

## Note tecniche
- Nessun database: tutto in `data/` (JSON + snapshot giornalieri + MP4 in `data/videos/`).
- Le chiavi restano in `data/settings.json` sul tuo Mac e non vengono mai inviate altrove.
- Stack: Node ≥18, Express, node-cron, frontend vanilla senza build step.
