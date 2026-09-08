/* Browser Google Maps key: restrict to the production HTTP referrer and Maps/Places APIs.
   leadEndpoint must be a public HTTPS relay to GHL, never a private GHL access token. */
window.SR_ANALYSIS_CONFIG = Object.freeze({
  googleMapsApiKey: 'AIzaSyDosmyCaPPudYaGr5k0avg1t8gyrY-w5pU',
  leadEndpoint: ''
});

/* Force-load the embedded hero image after editorial.js so it wins the cascade. */
(() => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'assets/hero-inline.css?v=3';
  document.head.appendChild(link);
})();
