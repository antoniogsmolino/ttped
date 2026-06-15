# 🚀 TTPED Studio

**TikTok Shop Trend Radar + Affiliate Intelligence** per la nicchia **moda donna**.

Due modalità:

1. **Cloud gratis (consigliata)** — dashboard statica su **GitHub Pages**, aggiornata ogni mattina da **GitHub Actions**. Niente server, niente Mac acceso, accessibile da mobile.
2. **Full locale** — versione completa con generazione video AI (Freepik) e pubblicazione TikTok (richiede Node in esecuzione sul Mac). Vedi sezione in fondo.

---

## ☁️ Versione cloud (GitHub Pages + Actions)

### Come funziona
- **GitHub Actions** ([.github/workflows/scrape.yml](.github/workflows/scrape.yml)) esegue `node scripts/scrape.js` ogni mattina (cron `30 5 * * *` UTC = ~07:30 in Italia) e a comando.
- Lo scraper interroga le classifiche TikTok Shop Italia di FastMoss (Womenswear & Underwear `l1_cid=2`, Fashion Accessories `l1_cid=8`, vendite + popolarità, giornaliere + settimanali) e le ricerche per keyword, accumula lo storico in [docs/data/products.json](docs/data/products.json) e scrive la top 20 in [docs/data/trends.json](docs/data/trends.json).
- **GitHub Pages** serve [docs/](docs/): la dashboard legge i JSON statici. L'**affiliate gira interamente nel browser** (CSV + `localStorage`), nessun dato lascia il dispositivo.

### Ranking trend
Impennata vendite ultimi 7 giorni (55%) + commissione affiliate (30%) + volume 7gg (15%), filtrato su moda donna (priorità abbigliamento/pantaloni 1.0 > top/abiti 0.95 > accessori 0.75).

### Configurazione (una tantum)
1. Account GitHub gratuito.
2. Repo creato e pushato (via `gh`, vedi sotto).
3. **Secret `FASTMOSS_COOKIE`** = il cookie di sessione FastMoss (contiene `fd_tk`). Scade ogni qualche settimana: se la dashboard si svuota, rigeneralo (Copy as cURL su una richiesta `www.fastmoss.com/api/...`) e aggiorna il Secret.
4. **Pages** attivo su branch `main`, cartella `/docs`.

Il link finale è `https://<utente>.github.io/<repo>/`.

---

## 💻 Versione full locale (opzionale)

```bash
npm install
npm start          # → http://127.0.0.1:4280
```

Aggiunge i tab **Video Studio** (Nano Banana 2 → Kling 2.5 via API Freepik, download MP4, pubblicazione/programmazione TikTok) e **Impostazioni**. Richiede:
- API key Freepik ([freepik.com/developers](https://www.freepik.com/developers/dashboard/api-key)) — ⚠️ l'API è a **crediti separati dal piano Unlimited** della webapp.
- App TikTok ([developers.tiktok.com](https://developers.tiktok.com)) con scope `video.publish` per pubblicare.

Per esporre la versione full su un server con login: imposta `ACCESS_PASSWORD`, `HOST=0.0.0.0`, `PUBLIC_URL`. Vedi [Dockerfile](Dockerfile) / [deploy/provision.sh](deploy/provision.sh).

> ⚠️ Tutti i dati locali (chiavi, cookie, token, video) stanno in `/data` e **non vengono mai committati** (`.gitignore`).
