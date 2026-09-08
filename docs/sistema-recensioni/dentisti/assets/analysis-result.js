(() => {
  'use strict';

  const body = document.body;
  const pageRoute = body.dataset.route;
  const config = window.SR_ANALYSIS_RESULT_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const analysisId = params.get('analysis_id');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const allowedFields = new Set([
    'route', 'business_name', 'business_address', 'google_rating',
    'review_count', 'primary_strength', 'primary_gap', 'competitor_context',
    'secondary_gap', 'report_url', 'phone_masked'
  ]);

  const textTargets = {
    business_name: '[data-value="business_name"]',
    business_address: '[data-value="business_address"]',
    primary_strength: '[data-value="primary_strength"]',
    primary_gap: '[data-value="primary_gap"]',
    competitor_context: '[data-value="competitor_context"]',
    secondary_gap: '[data-value="secondary_gap"]',
    phone_masked: '[data-value="phone_masked"]'
  };

  function track(event, details = {}) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, analysis_id: analysisId || undefined, route: pageRoute, ...details });
  }

  track(pageRoute === 'SELF_SERVICE' ? 'ty_self_view' : 'ty_full_view');

  function cleanPayload(payload) {
    const clean = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (!allowedFields.has(key)) continue;
      if (typeof value === 'string') clean[key] = value.trim();
      else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    }
    return clean;
  }

  function setText(field, value) {
    document.querySelectorAll(textTargets[field] || '').forEach(node => {
      node.textContent = value;
    });
  }

  function fillData(raw) {
    const data = cleanPayload(raw);
    if (data.route && data.route !== pageRoute) {
      const destination = data.route === 'SELF_SERVICE' ? '../self-service/' : data.route === 'FULL_MANAGED' ? '../managed/' : '';
      if (destination) {
        const url = new URL(destination, location.href);
        if (analysisId) url.searchParams.set('analysis_id', analysisId);
        location.replace(url.href);
      }
      return false;
    }

    Object.entries(textTargets).forEach(([field]) => {
      if (data[field] !== undefined && data[field] !== '') setText(field, String(data[field]));
      document.querySelectorAll(`[data-requires~="${field}"]`).forEach(node => {
        node.hidden = data[field] === undefined || data[field] === '';
      });
    });

    const rating = data.google_rating;
    const count = data.review_count;
    document.querySelectorAll('[data-rating-line]').forEach(node => {
      if (rating === undefined && count === undefined) {
        node.hidden = true;
        return;
      }
      const parts = [];
      if (rating !== undefined && rating !== '') parts.push(`★ ${rating}`);
      if (count !== undefined && count !== '') parts.push(`${count} recensioni`);
      node.textContent = parts.join(' · ');
      node.hidden = !parts.length;
    });

    document.querySelectorAll('[data-report-link]').forEach(link => {
      if (!data.report_url) {
        link.hidden = true;
        return;
      }
      try {
        const url = new URL(data.report_url, location.origin);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol');
        link.href = url.href;
        link.hidden = false;
      } catch {
        link.hidden = true;
      }
    });

    if (data.business_name) {
      document.querySelectorAll('[data-business-card]').forEach(node => node.hidden = false);
      document.title = `${data.business_name} — La tua analisi | Sistema Recensioni`;
    }
    document.querySelectorAll('[data-requires-any]').forEach(node => {
      const fields = node.dataset.requiresAny.split(/\s+/).filter(Boolean);
      node.hidden = !fields.some(field => data[field] !== undefined && data[field] !== '');
    });
    return true;
  }

  async function loadAnalysis() {
    const injected = window.__SR_ANALYSIS_DATA__;
    if (injected && fillData(injected)) return;
    if (!analysisId || !config.analysisEndpoint) return;

    body.classList.add('is-loading-analysis');
    try {
      const base = String(config.analysisEndpoint).replace(/\/$/, '');
      const response = await fetch(`${base}/${encodeURIComponent(analysisId)}`, {
        credentials: 'omit',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Analysis unavailable');
      const data = await response.json();
      fillData(data);
    } catch {
      document.querySelectorAll('[data-load-error]').forEach(node => node.hidden = false);
    } finally {
      body.classList.remove('is-loading-analysis');
    }
  }

  function setupCheckout() {
    document.querySelectorAll('[data-checkout]').forEach(link => {
      if (config.checkoutUrl) {
        try {
          const url = new URL(config.checkoutUrl, location.origin);
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol');
          if (analysisId) url.searchParams.set('analysis_id', analysisId);
          link.href = url.href;
          link.removeAttribute('aria-disabled');
        } catch {}
      }
      link.addEventListener('click', event => {
        if (link.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
          document.querySelectorAll('[data-checkout-status]').forEach(node => {
            node.hidden = false;
            node.focus({ preventScroll: true });
          });
          return;
        }
        track('checkout_click');
      });
    });
  }

  function setupMotion() {
    const progress = document.querySelector('.result-progress');
    const updateProgress = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      progress.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / max))})`;
    };
    updateProgress();
    addEventListener('scroll', updateProgress, { passive: true });

    const items = document.querySelectorAll('[data-reveal]');
    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
      items.forEach(item => item.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .12, rootMargin: '0px 0px -35px' });
    items.forEach(item => observer.observe(item));
  }

  document.querySelectorAll('[data-report-link]').forEach(link => {
    link.addEventListener('click', () => track('report_open'));
  });
  document.querySelectorAll('[data-strategist-section]').forEach(section => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        track('strategist_section_view');
        observer.disconnect();
      }
    }, { threshold: .45 });
    observer.observe(section);
  });

  setupCheckout();
  setupMotion();
  loadAnalysis();
})();
