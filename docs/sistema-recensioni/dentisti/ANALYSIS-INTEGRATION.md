# Richiesta analisi — integrazione

## Stato
- Google Places Autocomplete (New) è collegato e usa la chiave browser in `assets/analysis-config.js`.
- Risultati limitati all'Italia, lingua italiana, session token per ricerca, dettagli minimi della scheda.
- Nessun CRM è stato scelto definitivamente. `leadEndpoint` resta intenzionalmente vuoto.
- In questo stato i dati del form non vengono inviati né salvati; il pulsante segnala che l'invio non è disponibile.
- Nessun risultato Google fittizio e nessuna falsa conferma di acquisizione.

## Attivazione futura
Configurare `leadEndpoint` con l'URL HTTPS di un endpoint pubblico controllato. Il relay server associa i campi al destinatario scelto (GHL o altro), custodisce eventuali token privati e risponde solo dopo avere acquisito realmente la richiesta.

Non inserire token privati CRM, webhook riservati o segreti server nel file JavaScript pubblico.
La chiave Google Maps browser va limitata ai referrer autorizzati, Maps JavaScript API e Places API (New), con billing e quote configurati. La chiave non viene riprodotta in questa documentazione.

### Contratto
POST JSON con `Content-Type: application/json`, senza cookie:

```json
{
  "requestId": "uuid-stabile-per-retry-del-medesimo-payload",
  "businessName": "Nome scheda selezionata",
  "googlePlaceId": "Google Place ID",
  "googleAddress": "Indirizzo restituito da Google",
  "phone": "+393331234567",
  "source": "Sistema Recensioni / Dentisti",
  "requestType": "analisi competitiva e della reputazione"
}
```

L'endpoint deve validare i dati lato server, applicare limiti antiabuso, deduplicare `requestId`, consentire CORS per l'origine della landing e rispondere 2xx con `{ "ok": true }` solo dopo l'effettiva acquisizione. Gli altri stati non producono una conferma di successo. Aggiornare informativa e configurazione del destinatario prima di attivare la raccolta.

## Verifica
- Ricerca reale italiana; selezione con mouse/touch e frecce/Enter.
- Conferma scheda e focus sul telefono; modifica del nome annulla la precedente conferma.
- Richieste asincrone obsolete ignorate.
- Errori Google, nessun risultato, telefono invalido e invio non configurato non cancellano i dati.
- Nessun invio verso un destinatario non ancora scelto.

Documentazione Google: https://developers.google.com/maps/documentation/javascript/place-autocomplete-data

## Thank-you personalizzate

Sono disponibili due percorsi distinti:

- `analisi/self-service/` per il percorso Self-Service da 49 €/mese;
- `analisi/managed/` per il ricontatto con un Local Marketing Strategist.

Le pagine ricevono soltanto `analysis_id` nella query string. Configurare in `assets/analysis-result-config.js`:

- `analysisEndpoint`: endpoint HTTPS da interrogare con `GET {endpoint}/{analysis_id}`;
- `checkoutUrl`: destinazione HTTPS della CTA Self-Service.

L’endpoint restituisce JSON con i soli campi pubblicabili:

```json
{
  "route": "SELF_SERVICE | FULL_MANAGED",
  "business_name": "Nome attività",
  "business_address": "Indirizzo",
  "google_rating": "4,8",
  "review_count": 127,
  "primary_strength": "Punto di forza emerso",
  "primary_gap": "Priorità principale",
  "competitor_context": "Confronto locale",
  "secondary_gap": "Seconda priorità opzionale",
  "report_url": "https://...",
  "phone_masked": "+39 333 *** **67"
}
```

I blocchi senza dati restano nascosti. Lo score, le soglie e la logica di instradamento restano nel backend/CRM e non vengono richiesti né renderizzati. Per integrazioni server-rendered è supportato anche `window.__SR_ANALYSIS_DATA__` con lo stesso contratto.

Eventi inviati a `dataLayer`: `ty_self_view`, `ty_full_view`, `report_open`, `checkout_click` e `strategist_section_view`. Gli eventi successivi all’uscita dalla pagina (`checkout_start`, `purchase_completed`, `sales_contacted`, `appointment`, `sale`) devono essere prodotti dai sistemi che gestiscono checkout e vendita.
