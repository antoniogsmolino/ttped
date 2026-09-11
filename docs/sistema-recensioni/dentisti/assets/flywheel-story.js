(() => {
  const fly = document.querySelector('.fly');
  const visual = document.querySelector('.fly-visual');
  const storyHost = document.querySelector('.fly-grid > div:first-child');
  if (!fly || !visual || !storyHost) return;
  fly.classList.add('story-managed');
  const rotor = document.createElement('div');
  rotor.className = 'story-rotor';
  visual.append(rotor);

  const steps = [
    { title: 'Crea una buona <em>esperienza</em>', text: 'Tutto parte da un paziente soddisfatto. Una buona esperienza crea il presupposto per essere ricordati, consigliati e preferiti.' },
    { title: 'Attiva il tuo <em>team</em>', text: 'Coinvolgi il personale e rendi semplice chiedere una recensione nel momento giusto, con NFC, QR Code e automazioni.' },
    { title: 'Genera nuove <em>recensioni</em>', text: 'La soddisfazione del paziente diventa una recensione autentica e pubblica: una prova concreta per chi ancora non conosce lo studio.' },
    { title: 'Amplifica la tua <em>reputazione</em>', text: 'Le recensioni non rimangono ferme su Google: diventano contenuti, prove e segnali di fiducia che rafforzano la presenza locale.' },
    { title: 'Aumenta visibilità, fiducia e <em>preferenza</em>', text: 'Più recensioni, più contenuti e più autorevolezza aumentano le possibilità di essere trovati, riconosciuti e consigliati.' },
    { title: 'Conquista nuovi <em>clienti</em>', text: 'La preferenza si trasforma in azione: più telefonate, più richieste e più prenotazioni. Ogni nuovo paziente alimenta di nuovo il Volano.' }
  ];
  const nodeLabels = ['Esperienza', 'Team', 'Recensioni', 'Reputazione', 'Preferenza', 'Nuovi clienti'];
  const icons = [
    '<circle cx="12" cy="7" r="3"/><path d="M5 20c0-7 14-7 14 0"/>',
    '<circle cx="12" cy="7" r="3"/><circle cx="4" cy="10" r="2"/><circle cx="20" cy="10" r="2"/><path d="M7 21v-4c0-5 10-5 10 0v4M1 20v-3q0-4 4-3M23 20v-3q0-4-4-3"/>',
    '<path d="M14 21H4V3h15v9M7 7h8M7 11h5m6 3 1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4Z"/>',
    '<path d="m3 10 13-6v16L3 14Zm2 5 2 6h3l-2-5M20 9l3-2M20 15l3 2M20 12h4"/>',
    '<path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5Z"/><path d="m8 12 3 3 5-6"/>',
    '<path d="M3 21v-5h4v5M10 21v-9h4v9M17 21V7h4v14M3 11l14-8M13 3h5v5"/>'
  ];
  const nodes = [...document.querySelectorAll('.fly-node')].slice(0, 6);
  nodes.forEach((node, index) => {
    rotor.append(node);
    node.querySelector('b').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">' + icons[index] + '</svg>';
    node.style.setProperty('--angle', `${index * 60}deg`);
    node.setAttribute('aria-label', `${index + 1}. ${nodeLabels[index]}`);
    const label = node.querySelector('.fly-node-label');
    if (label) label.textContent = nodeLabels[index];
  });

  storyHost.innerHTML = `
    <div class="fly-story-content">
      <div class="fly-story-eyebrow">Volano della Preferenza™</div>
      <span class="fly-story-count">01 / 06</span>
      <h2 class="fly-story-title">${steps[0].title}</h2>
      <p class="fly-story-copy">${steps[0].text}</p>
      <div class="fly-story-fuel" aria-label="Le recensioni sono la benzina del Volano">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h8v18H7V3Zm2 3v4h4V6H9Zm8 3h1.2c1 0 1.8.8 1.8 1.8V18a3 3 0 0 1-3 3h-1v-2h1a1 1 0 0 0 1-1v-7.2c0-.1-.1-.2-.2-.2H17V9Z"/></svg>
        Le recensioni sono la benzina del Volano.
      </div>
    </div>`;
  const content = storyHost.querySelector('.fly-story-content');
  const count = content.querySelector('.fly-story-count');
  const title = content.querySelector('.fly-story-title');
  const copy = content.querySelector('.fly-story-copy');
  let active = -1;
  let pending;

  const clamp = value => Math.max(0, Math.min(1, value));
  const setStep = index => {
    if (index === active) return;
    active = index;
    navigation.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-current',String(i===index)));
    previous.disabled = index === 0;
    next.disabled = index === 5;
    nodes.forEach((node, nodeIndex) => node.classList.toggle('active', nodeIndex === index));
    visual.style.setProperty('--wheel-rotation', `${-index * 60}deg`);
    clearTimeout(pending);
    content.classList.add('is-changing');
    pending = window.setTimeout(() => {
      count.textContent = `${String(index + 1).padStart(2, '0')} / 06`;
      title.innerHTML = steps[index].title;
      copy.textContent = steps[index].text;
      content.classList.remove('is-changing');
    }, 130);
  };
  const update = () => {
    if (window.matchMedia('(max-width: 860px), (prefers-reduced-motion: reduce)').matches) return;
    const rect = fly.getBoundingClientRect();
    const span = Math.max(1, fly.offsetHeight - window.innerHeight);
    const progress = clamp((-rect.top + window.innerHeight * .08) / span);
    setStep(Math.min(5, Math.floor(progress * 6)));
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  const navigation = document.createElement('div');
  navigation.className = 'story-navigation';
  steps.forEach((step, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(i + 1).padStart(2, '0');
    button.setAttribute('aria-label', nodeLabels[i]);
    button.addEventListener('click', () => setStep(i));
    navigation.append(button);
  });
  storyHost.append(navigation);
  const controls = document.createElement('div');
  controls.className = 'story-controls';
  const previous = document.createElement('button');
  const next = document.createElement('button');
  previous.type = next.type = 'button';
  previous.textContent = '← Precedente';
  next.textContent = 'Successivo →';
  previous.addEventListener('click',()=>setStep(Math.max(0,active-1)));
  next.addEventListener('click',()=>setStep(Math.min(5,active+1)));
  controls.append(previous,next);
  storyHost.append(controls);
  content.setAttribute('aria-live','polite');
  let touch;
  fly.addEventListener('touchstart',e=>{touch=e.touches[0];},{passive:true});
  fly.addEventListener('touchend',e=>{
    if(!touch)return;
    const dx=e.changedTouches[0].clientX-touch.clientX;
    const dy=e.changedTouches[0].clientY-touch.clientY;
    if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5)setStep(Math.max(0,Math.min(5,active+(dx<0?1:-1))));
    touch=null;
  },{passive:true});
  setStep(0);
  update();
})();

