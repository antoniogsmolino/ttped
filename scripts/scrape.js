// Entry point per GitHub Actions: esegue lo scraping e scrive i JSON statici in docs/data.
// Nessuna dipendenza npm: usa solo i moduli core di Node 18+ (fetch globale).
// Variabili: FASTMOSS_COOKIE (Secret), REGION (default IT), DATA_DIR (default docs/data).
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'docs', 'data');

const { writeJSON } = require('../lib/store');
const scraper = require('../lib/scraper');

(async () => {
  const status = await scraper.runScrape();
  const top = scraper.computeTrends(20);
  writeJSON(path.join(process.env.DATA_DIR, 'trends.json'), {
    status,
    top,
    generatedAt: new Date().toISOString(),
  });
  console.log('Scrape completato:', JSON.stringify(status));
  if (!status.ok) {
    console.error('Nessun prodotto raccolto: controlla il Secret FASTMOSS_COOKIE.');
    process.exit(1);
  }
})().catch((e) => {
  console.error('Scrape fallito:', e);
  process.exit(1);
});
