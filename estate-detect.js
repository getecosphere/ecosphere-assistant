// Estate detection: reads the ecosphere-estate meta tag that Eco estates emit
// (from the gateway/frontend) and records it so the side panel can show the
// remote estate + offer an eco up --remote deploy.
(function () {
  const meta = document.querySelector('meta[name="ecosphere-estate"]');
  if (!meta || !meta.content) return;
  chrome.storage.local.set({
    eco_estate: {
      name: String(meta.content),
      hostname: location.hostname,
      url: location.href,
      at: Date.now(),
    },
  });
})();
