// Entry point per GitHub Actions: esegue lo scraping e scrive i JSON statici in docs/data.
// Nessuna dipendenza npm: usa solo i moduli core di Node 18+ (fetch globale).
// Variabili: FASTMOSS_COOKIE (Secret), REGION (default IT), DATA_DIR (default docs/data).
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'docs', 'data');

const { writeJSON } = require('../lib/store');
const scraper = require('../lib/scraper');

(async () => {
  const status = await scraper.runScrape();
  console.log('Scrape completato:', JSON.stringify(status));

  if (!status.ok) {
    console.error('Nessun prodotto raccolto: controlla il Secret FASTMOSS_COOKIE.');
    process.exit(1);
  }
  // Rilevamento cookie scaduto: con focus moda donna attivo dovremmo trovarne centinaia.
  // Se ne troviamo pochissimi il cookie è quasi certamente scaduto: NON sovrascrivere i dati
  // buoni e fai fallire il job, così GitHub invia un'email di notifica.
  if (status.focus && status.matched < 20) {
    console.error(`⚠️ Solo ${status.matched} prodotti moda donna trovati: il cookie FASTMOSS_COOKIE è probabilmente SCADUTO.`);
    console.error('   Rigeneralo (Copy as cURL su una richiesta www.fastmoss.com/api/...) e aggiorna il Secret su GitHub.');
    process.exit(1);
  }

  const rankings = scraper.computeAllRankings(20); // { sofia:{d7,h48,h24}, emma:{...}, marco:{...}, luca:{...} }
  writeJSON(path.join(process.env.DATA_DIR, 'trends.json'), {
    status,
    rankings,
    top: scraper.computeTrends(40), // unione di tutti i modelli: per il cross-match affiliate
    generatedAt: new Date().toISOString(),
  });
  const summary = Object.entries(rankings).map(([m, r]) => `${m}=${r.migliori.length}`).join(' · ');
  console.log(`Classifiche per sezione (migliori): ${summary}`);
})().catch((e) => {
  console.error('Scrape fallito:', e);
  process.exit(1);
});
