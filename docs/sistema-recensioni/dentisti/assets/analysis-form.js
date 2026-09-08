(() => {
  'use strict';
  const config = window.SR_ANALYSIS_CONFIG || {};
  const form = document.getElementById('lead-form');
  if (!form) return;
  const input = document.getElementById('business-name');
  const phone = document.getElementById('phone');
  const search = form.querySelector('.business-search');
  const list = document.getElementById('business-results');
  const panel = document.getElementById('suggestion-panel');
  const status = document.getElementById('business-status');
  const card = document.getElementById('selected-business');
  const confirm = document.getElementById('confirm-business');
  const change = document.getElementById('change-business');
  const submit = document.getElementById('analysis-submit');
  const feedback = document.getElementById('form-status');
  const phoneError = document.getElementById('phone-error');
  let sdk, session, timer, sequence = 0, options = [], active = -1, selection = null, submitting = false;
  let requestId = null, submittedPayload = null;
  const timeout = (promise, ms = 12000) => new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(value => { clearTimeout(id); resolve(value); }, error => { clearTimeout(id); reject(error); });
  });
  function loadPlaces() {
    if (window.google?.maps?.importLibrary) return window.google.maps.importLibrary('places');
    if (sdk) return sdk;
    if (!config.googleMapsApiKey) return Promise.reject(new Error('not-configured'));
    sdk = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => { script.remove(); sdk = null; reject(new Error('google-unavailable')); };
      const watchdog = setTimeout(fail, 12000);
      window.srPlacesReady = async () => {
        clearTimeout(watchdog);
        try { resolve(await window.google.maps.importLibrary('places')); } catch { fail(); }
      };
      window.gm_authFailure = () => { clearTimeout(watchdog); fail(); status.textContent = 'La ricerca Google non è disponibile al momento. Riprova più tardi.'; };
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.search = new URLSearchParams({key:config.googleMapsApiKey,loading:'async',libraries:'places',callback:'srPlacesReady',language:'it',region:'IT',v:'weekly'}).toString();
      script.src = url.toString(); script.async = true;
      script.onerror = () => { clearTimeout(watchdog); fail(); };
      document.head.append(script);
    });
    return sdk;
  }
  function closeList() { panel.hidden = true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function loading(value) { search.classList.toggle('loading',value); input.setAttribute('aria-busy',String(value)); }
  function clearSelection() {
    selection = null; card.hidden = true; card.classList.remove('confirmed');
    search.hidden = false; document.getElementById('business-hint').hidden = false;
    confirm.disabled = false; confirm.textContent = 'Conferma questa scheda';
    document.getElementById('selection-label').textContent = 'Scheda selezionata';
  }
  function setActive(index) {
    active = index;
    [...list.children].forEach((el,i) => el.setAttribute('aria-selected',String(i === index)));
    if (index >= 0) { input.setAttribute('aria-activedescendant',list.children[index].id); list.children[index].scrollIntoView({block:'nearest'}); }
  }
  function render(predictions) {
    options = predictions; list.replaceChildren(); active = -1;
    predictions.forEach((prediction,index) => {
      const item = document.createElement('li'); item.id = `business-option-${sequence}-${index}`; item.dataset.index = index;
      item.setAttribute('role','option'); item.setAttribute('aria-selected','false');
      const name = document.createElement('strong'); name.textContent = prediction.mainText?.toString() || prediction.text.toString();
      const address = document.createElement('span'); address.className = 'suggestion-address'; address.textContent = prediction.secondaryText?.toString() || '';
      item.append(name,address); list.append(item);
    });
    panel.hidden = !predictions.length; input.setAttribute('aria-expanded',String(!!predictions.length));
    status.textContent = predictions.length ? `${predictions.length} schede trovate. Seleziona la tua attività.` : 'Nessuna scheda trovata. Prova ad aggiungere la città o a modificare il nome.';
  }
  async function find(query, version) {
    loading(true); status.textContent = 'Ricerca delle schede Google…';
    try {
      const {AutocompleteSuggestion, AutocompleteSessionToken} = await timeout(loadPlaces());
      if (version !== sequence) return;
      session ||= new AutocompleteSessionToken();
      const result = await timeout(AutocompleteSuggestion.fetchAutocompleteSuggestions({input:query,sessionToken:session,language:'it',region:'it',includedRegionCodes:['it']}));
      if (version !== sequence) return;
      if (document.activeElement !== input) { status.textContent = ''; return; }
      render(result.suggestions.map(s => s.placePrediction).filter(p => p && (p.types?.includes('establishment') || p.types?.includes('point_of_interest'))).slice(0,5));
    } catch {
      if (version === sequence) { closeList(); status.textContent = 'La ricerca Google non è disponibile al momento. Riprova tra poco.'; }
    } finally { if (version === sequence) loading(false); }
  }
  async function choose(index) {
    const prediction = options[index]; if (!prediction || submitting) return;
    const version = ++sequence; clearTimeout(timer); closeList(); loading(true); status.textContent = 'Caricamento della scheda…';
    // A details request closes this Google autocomplete session; later typing starts a fresh one.
    session = null;
    try {
      const place = prediction.toPlace();
      await timeout(place.fetchFields({fields:['id','displayName','formattedAddress']}));
      if (version !== sequence) return;
      if (!place.id || !place.displayName) throw new Error('invalid-place');
      selection = {placeId:place.id,name:place.displayName,address:place.formattedAddress || '',confirmed:false};
      input.value = selection.name; input.removeAttribute('aria-invalid');
      document.getElementById('selected-name').textContent = selection.name;
      document.getElementById('selected-address').textContent = selection.address;
      const map = new URL('https://www.google.com/maps/search/');
      map.search = new URLSearchParams({api:'1',query:selection.name,query_place_id:selection.placeId}).toString();
      document.getElementById('selected-map').href = map.toString();
      card.hidden = false; search.hidden = true; document.getElementById('business-hint').hidden = true; status.textContent = 'Controlla nome e indirizzo, poi conferma la scheda.';
      confirm.focus({preventScroll:true});
    } catch {
      if (version === sequence) { clearSelection(); status.textContent = 'Non è stato possibile caricare la scheda. Cerca di nuovo la tua attività.'; }
    } finally { if (version === sequence) loading(false); }
  }
  input.addEventListener('input', () => {
    ++sequence; clearTimeout(timer); closeList(); clearSelection(); loading(false); input.removeAttribute('aria-invalid');
    feedback.textContent = ''; options = [];
    const query = input.value.trim();
    if (query.length < 2) { status.textContent = query ? 'Inserisci almeno 2 caratteri.' : ''; return; }
    const version = sequence;
    timer = setTimeout(() => find(query,version),300);
  });
  input.addEventListener('keydown',event => {
    if (event.key === 'Escape') { ++sequence; clearTimeout(timer); closeList(); loading(false); status.textContent = ''; return; }
    if (panel.hidden || !options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setActive(active < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (event.key === 'Enter') { event.preventDefault(); if (active >= 0) choose(active); }
  });
  list.addEventListener('mousedown',event => event.preventDefault());
  list.addEventListener('click',event => { const item = event.target.closest('[data-index]'); if(item) choose(Number(item.dataset.index)); });
  document.addEventListener('pointerdown',event => { if(!form.querySelector('.business-field').contains(event.target)) closeList(); });
  input.addEventListener('blur',() => { setTimeout(() => { if(document.activeElement !== input) closeList(); },120); });
  change.addEventListener('click',() => { ++sequence; clearSelection(); input.value = ''; status.textContent = ''; input.focus(); });
  confirm.addEventListener('click',() => {
    if (!selection) return;
    selection.confirmed = true; card.classList.add('confirmed'); confirm.disabled = true; confirm.textContent = 'Scheda confermata ✓';
    document.getElementById('selection-label').textContent = 'Scheda confermata'; status.textContent = '';
    phone.focus();
  });
  phone.addEventListener('input',() => { phone.removeAttribute('aria-invalid'); phoneError.textContent = ''; feedback.textContent = ''; });
  form.addEventListener('submit',async event => {
    event.preventDefault(); if(submitting) return;
    feedback.textContent = ''; feedback.className = 'form-status';
    if (!selection || !selection.confirmed || input.value !== selection.name) {
      input.setAttribute('aria-invalid','true'); status.textContent = selection ? 'Conferma la scheda Google prima di proseguire.' : 'Cerca la tua attività e seleziona la scheda Google corretta.';
      (selection ? confirm : input).focus(); return;
    }
    const raw = phone.value.trim(); const digits = raw.replace(/\D/g,'');
    if (!/^\+?[\d\s().-]+$/.test(raw) || digits.length < 7 || digits.length > 15) {
      phone.setAttribute('aria-invalid','true'); phoneError.textContent = 'Inserisci un numero di telefono valido, con prefisso internazionale se necessario.'; phone.focus(); return;
    }
    let endpoint;
    try { endpoint = new URL(config.leadEndpoint); if(endpoint.protocol !== 'https:') throw new Error('invalid-endpoint'); }
    catch { feedback.classList.add('error'); feedback.textContent = 'L’invio della richiesta non è disponibile al momento. I tuoi dati non sono stati inviati. Riprova più tardi.'; return; }
    const normalizedPhone = raw.startsWith('+') ? '+'+digits : digits.startsWith('00') ? '+'+digits.slice(2) : '+39'+digits;
    if (normalizedPhone.slice(1).length > 15) { phoneError.textContent = 'Controlla il numero e il prefisso internazionale.'; phone.setAttribute('aria-invalid','true'); phone.focus(); return; }
    const payload = {businessName:selection.name,googlePlaceId:selection.placeId,googleAddress:selection.address,phone:normalizedPhone,source:'Sistema Recensioni / Dentisti',requestType:'analisi competitiva e della reputazione'};
    const serialized = JSON.stringify(payload);
    if (submittedPayload !== serialized) { requestId = crypto.randomUUID(); submittedPayload = serialized; }
    submitting = true; submit.disabled = true; submit.textContent = 'Invio della richiesta…'; form.setAttribute('aria-busy','true');
    input.disabled = phone.disabled = change.disabled = confirm.disabled = true;
    const controller = new AbortController(); const watchdog = setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch(endpoint.toString(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId}),signal:controller.signal,credentials:'omit'});
      if (!response.ok) throw new Error('submission-failed');
      const result = await response.json();
      if (result.ok !== true) throw new Error('not-confirmed');
      feedback.classList.add('success'); feedback.textContent = 'Richiesta ricevuta. Ti contatteremo per le tue analisi: il confronto con le attività della tua zona e i segnali che emergono dalla tua reputazione online.';
      submit.textContent = 'Analisi richiesta ✓'; submit.disabled = true;
      input.disabled = phone.disabled = false; input.readOnly = phone.readOnly = true; change.disabled = true;
    } catch {
      feedback.classList.add('error'); feedback.textContent = 'Non possiamo confermare l’invio. Riprova: i dati inseriti sono ancora qui.';
      input.disabled = phone.disabled = change.disabled = false; confirm.disabled = !!selection?.confirmed;
      submit.disabled = false; submit.textContent = 'Richiedi la mia analisi'; submitting = false;
    } finally { clearTimeout(watchdog); form.removeAttribute('aria-busy'); }
  });
})();
