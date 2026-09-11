(() => {
  const fly = document.querySelector('.fly');
  const visual = document.querySelector('.fly-visual');
  const storyHost = document.querySelector('.fly-grid > div:first-child');
  if (!fly || !visual || !storyHost) return;

  const steps = [
    { title: 'Crea una buona <em>esperienza</em>', text: 'Tutto parte da un paziente soddisfatto. Una buona esperienza crea il presupposto per essere ricordati, consigliati e preferiti.' },
    { title: 'Attiva il tuo <em>team</em>', text: 'Coinvolgi il personale e rendi semplice chiedere una recensione nel momento giusto, con NFC, QR Code e automazioni.' },
    { title: 'Genera nuove <em>recensioni</em>', text: 'La soddisfazione del paziente diventa una recensione autentica e pubblica: una prova concreta per chi ancora non conosce lo studio.' },
    { title: 'Amplifica la tua <em>reputazione</em>', text: 'Le recensioni non rimangono ferme su Google: diventano contenuti, prove e segnali di fiducia che rafforzano la presenza locale.' },
    { title: 'Aumenta visibilità, fiducia e <em>preferenza</em>', text: 'Più recensioni, più contenuti e più autorevolezza aumentano le possibilità di essere trovati, riconosciuti e consigliati.' },
    { title: 'Conquista nuovi <em>clienti</em>', text: 'La preferenza si trasforma in azione: più telefonate, più richieste e più prenotazioni. Ogni nuovo paziente alimenta di nuovo il Volano.' }
  ];
  const nodeLabels = ['Esperienza', 'Team', 'Recensioni', 'Reputazione', 'Preferenza', 'Nuovi clienti'];
  const nodes = [...document.querySelectorAll('.fly-node')].slice(0, 6);
  nodes.forEach((node, index) => {
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

  const clamp = value => Math.max(0, Math.min(1, value));
  const setStep = index => {
    if (index === active) return;
    active = index;
    nodes.forEach((node, nodeIndex) => node.classList.toggle('active', nodeIndex === index));
    visual.style.setProperty('--wheel-rotation', `${-index * 60}deg`);
    content.classList.add('is-changing');
    window.setTimeout(() => {
      count.textContent = `${String(index + 1).padStart(2, '0')} / 06`;
      title.innerHTML = steps[index].title;
      copy.textContent = steps[index].text;
      content.classList.remove('is-changing');
    }, 130);
  };
  const update = () => {
    if (window.matchMedia('(max-width: 860px)').matches) return setStep(0);
    const rect = fly.getBoundingClientRect();
    const span = Math.max(1, fly.offsetHeight - window.innerHeight);
    const progress = clamp((-rect.top + window.innerHeight * .08) / span);
    setStep(Math.min(5, Math.floor(progress * 6)));
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  setStep(0);
  update();
})();
