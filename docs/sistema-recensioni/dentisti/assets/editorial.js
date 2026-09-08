(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 861px)');
  const root = document.documentElement;
  const header = document.querySelector('.header');
  const heroCanvas = document.querySelector('.hero-canvas');
  const heroArt = document.querySelector('.hero-art');
  const pinLabel = document.querySelector('.pin-label');
  const compare = document.querySelector('.compare');
  const googleCard = document.querySelector('.google-card');
  const winner = document.querySelector('.result.hot');
  const fly = document.querySelector('.fly');
  const flyVisual = document.querySelector('.fly-visual');
  const track = document.querySelector('.orbit-progress');
  const traveler = document.querySelector('.orbit-traveler');
  const nodes = [...document.querySelectorAll('.fly-node')];
  const nfcScene = document.querySelector('.nfc-scene');
  const nfcArt = document.querySelector('.nfc-art');
  const review = document.querySelector('.review-card');
  const valueTitle = document.querySelector('.value h2');
  const valueField = document.querySelector('.value-field');
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.append(progress);
  const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
  const viewProgress = (rect, start = .9, end = .2) => clamp((innerHeight * start - rect.top) / (innerHeight * (start - end)));
  const visible = rect => rect.top < innerHeight && rect.bottom > 0;
  let ticking = false;
  let revealObserver, sceneObserver;
  const words = [];
  // Wrap text nodes without changing text, order, or semantics.
  const walker = document.createTreeWalker(valueTitle, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    node.textContent.split(/(\s+)/).forEach(part => {
      if (/^\s+$/.test(part)) fragment.append(document.createTextNode(part));
      else if (part) { const span = document.createElement('span'); span.className = 'word'; span.textContent = part; fragment.append(span); words.push(span); }
    });
    node.replaceWith(fragment);
  });
  // The opening headline reveals word by word, retaining its original wrapping.
  const headingWalker = document.createTreeWalker(document.querySelector('.hero h1'), NodeFilter.SHOW_TEXT);
  const headingNodes = [];
  while (headingWalker.nextNode()) headingNodes.push(headingWalker.currentNode);
  let wordIndex = 0;
  headingNodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    node.textContent.split(/(\s+)/).forEach(part => {
      if (/^\s+$/.test(part)) fragment.append(document.createTextNode(part));
      else if (part) {
        const mask = document.createElement('span'); mask.className = 'hero-word';
        const word = document.createElement('span'); word.textContent = part;
        mask.style.setProperty('--word-index', wordIndex++); mask.append(word); fragment.append(mask);
      }
    });
    node.replaceWith(fragment);
  });
  const targets = new Set();
  const reveal = (el, delay = 0) => { if (!el) return; el.dataset.reveal = ''; el.style.setProperty('--delay', `${delay}ms`); targets.add(el); };
  reveal(document.querySelector('.hero .k'));

  reveal(document.querySelector('.hero-intro'), 220);
  reveal(heroCanvas, 150);
  reveal(pinLabel, 550);
  document.querySelectorAll('.section .k,.section h2,.section .lead,.bridge,.google-card,.nfc-scene,.form-box').forEach(el => reveal(el));
  document.querySelectorAll('.points,.proof-grid').forEach(group => [...group.children].forEach((el, i) => reveal(el, i * 110)));
  document.querySelectorAll('.reason-item').forEach(el => reveal(el));
  function revealAll() {
    root.classList.remove('motion-enabled');
    targets.forEach(el => el.classList.add('is-visible'));
    revealObserver?.disconnect(); sceneObserver?.disconnect();
    document.querySelectorAll('.motion-paused').forEach(el => el.classList.remove('motion-paused'));
    heroArt.style.transform = nfcArt.style.transform = googleCard.style.transform = winner.style.transform = review.style.transform = '';
    words.forEach(el => el.style.opacity = '1');
    track.style.strokeDashoffset = '0';
    traveler.style.transform = '';
    nodes.forEach(node => node.classList.remove('active'));
  }
  function setupMotion() {
    if (reduce.matches || !('IntersectionObserver' in window)) { revealAll(); return; }
    revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); revealObserver.unobserve(entry.target); }
    }), {threshold:.08,rootMargin:'0px 0px -25px 0px'});
    sceneObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      entry.target.classList.toggle('motion-active', entry.isIntersecting);
      entry.target.classList.toggle('motion-paused', !entry.isIntersecting);
    }), {threshold:.05});
    targets.forEach(el => revealObserver.observe(el));
    document.querySelectorAll('section').forEach(el => sceneObserver.observe(el));
    root.classList.add('motion-enabled');
  }
  function update() {
    ticking = false;
    header.classList.toggle('scrolled', scrollY > 20);
    progress.style.transform = `scaleX(${clamp(scrollY / Math.max(1, root.scrollHeight - innerHeight))})`;
    if (reduce.matches) return;
    const heroRect = heroCanvas.getBoundingClientRect();
    if (visible(heroRect)) {
      const p = viewProgress(heroRect, 1, -.4);
      heroArt.style.transform = `scale(${1.02 + p * .045}) translateY(${(p - .35) * -15}px)`;
    }
    const compareRect = compare.getBoundingClientRect();
    if (visible(compareRect)) {
      const p = viewProgress(compareRect, .9, -.1);
      if (desktop.matches) googleCard.style.transform = `perspective(1100px) rotateY(${-10 + p * 10}deg) rotateX(${5 - p * 5}deg)`;
      else googleCard.style.transform = 'none';
      winner.style.transform = `translateX(${-8 - p * (desktop.matches ? 26 : 5)}px) scale(${1 + p * .05})`;
    }
    const flyRect = fly.getBoundingClientRect();
    if (visible(flyRect)) {
      // Desktop has a finite pinned chapter; compact screens keep native continuous scroll.
      const p = desktop.matches
        ? clamp((80 - flyRect.top) / Math.max(1, fly.offsetHeight - (innerHeight - 80)))
        : clamp((innerHeight * .7 - flyVisual.getBoundingClientRect().top) / Math.max(1, flyVisual.offsetHeight * .85));
      const travel = .04 + p * .96;
      track.style.strokeDashoffset = `${1326 * (1 - travel)}`;
      traveler.style.transform = `rotate(${travel * 360}deg)`;
      nodes.forEach((node, i) => node.classList.toggle('active', i === Math.min(6, Math.floor(p * 7))));
    }
    const nfcRect = nfcScene.getBoundingClientRect();
    if (visible(nfcRect)) {
      const p = viewProgress(nfcRect, 1, -.3);
      nfcArt.style.transform = `scale(${1.07 - p * .055}) translateY(${(p - .5) * -16}px)`;
      review.style.transform = `translateY(${(1 - p) * 25}px)`;
    }
    const valueRect = valueTitle.getBoundingClientRect();
    if (visible(valueRect)) {
      const p = viewProgress(valueRect, .9, .38);
      words.forEach((word, i) => { word.style.opacity = `${.18 + .82 * clamp((p * (words.length + 3) - i) / 3)}`; });
    }
    const fieldRect = valueField.getBoundingClientRect();
    if (visible(fieldRect)) {
      const p = viewProgress(fieldRect, .9, .3);
      valueField.querySelectorAll('.vp:not(.hot)').forEach((el, i) => {
        el.style.translate = `${(i < 3 ? -1 : 1) * p * 10}px 0`;
      });
    }
  }
  function requestUpdate() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  setupMotion();
  update();
  addEventListener('scroll', requestUpdate, {passive:true});
  addEventListener('resize', requestUpdate, {passive:true});
  addEventListener('pageshow', requestUpdate);
  document.fonts?.ready.then(requestUpdate);
  reduce.addEventListener('change', () => { reduce.matches ? revealAll() : setupMotion(); requestUpdate(); });
  desktop.addEventListener('change', requestUpdate);
})();
