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
