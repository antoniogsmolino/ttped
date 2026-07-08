#!/usr/bin/env bash
# Scrape giornaliero LOCALE (dal Mac dell'utente, IP residenziale che FastMoss non blocca).
# Aggiorna la classifica e la pubblica sulla dashboard live (GitHub Pages).
# Pianificato da launchd (~/Library/LaunchAgents/com.ttped.dailyscrape.plist).
set -uo pipefail

# Cartella del progetto (questo script sta in <repo>/scripts).
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1

NODE="$(command -v node || echo /usr/local/bin/node)"
LOG="$REPO/data/local-daily.log"
mkdir -p "$REPO/data"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') — scrape locale =====" >> "$LOG"

# 1) Scrape con pause ampie (FastMoss limita le raffiche; ~5s tra le richieste evita il blocco).
#    Passa il cookie FastMoss da data/settings.json (dati autenticati, 10 item/pagina).
COOKIE="$("$NODE" -e "try{const s=require('./data/settings.json');process.stdout.write((s.fastmossHeaders&&s.fastmossHeaders.cookie)||s.fastmossCookie||'')}catch(e){}")"
SCRAPE_SLEEP_MS=5000 FASTMOSS_COOKIE="$COOKIE" "$NODE" scripts/scrape.js >> "$LOG" 2>&1
RC=$?
if [ $RC -ne 0 ]; then
  echo "scrape fallito (rc=$RC) — dati NON aggiornati (cookie FastMoss scaduto? rate-limit?)" >> "$LOG"
  exit 0
fi

# 2) Pubblica: commit dei dati + push su GitHub (token letto da data/settings.json, gitignorato).
git add docs/data/trends.json docs/data/products.json docs/data/status.json
if git diff --staged --quiet; then
  echo "nessuna modifica da pubblicare" >> "$LOG"
  exit 0
fi
git -c user.name='TTPED bot' -c user.email='bot@ttped.local' commit -q -m "Trend update $(date -u +'%Y-%m-%d %H:%M UTC')" >> "$LOG" 2>&1

read -r TOKEN REPO_SLUG < <("$NODE" -e "const s=require('./data/settings.json');process.stdout.write((s.github&&s.github.token||'')+' '+(s.github&&s.github.repo||''))")
if [ -z "$TOKEN" ] || [ -z "$REPO_SLUG" ]; then
  echo "token/repo GitHub mancanti in settings.json — commit fatto ma non pushato" >> "$LOG"
  exit 0
fi
# pull leggero in caso il remoto sia avanti, poi push
git pull --rebase -q "https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git" main >> "$LOG" 2>&1 || true
if git push -q "https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git" main >> "$LOG" 2>&1; then
  echo "pubblicato ✓ (dashboard aggiornata)" >> "$LOG"
else
  echo "push fallito — controlla il token GitHub in settings.json (scaduto?)" >> "$LOG"
fi
