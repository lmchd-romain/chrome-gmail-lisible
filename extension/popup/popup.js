/* Fenêtre de réglages : lit et enregistre les choix dans chrome.storage.sync. */
(function () {
  'use strict';

  const DEFAULTS = globalThis.GL_DEFAULTS;
  const switches = document.querySelectorAll('input[data-key]');
  const radios = document.querySelectorAll('input[name="daySeparatorMode"]');
  const modes = document.querySelector('.modes');

  function refreshModes(enabled) {
    modes.classList.toggle('off', !enabled);
    radios.forEach((r) => (r.disabled = !enabled));
  }

  function render(settings) {
    switches.forEach((input) => {
      input.checked = !!settings[input.dataset.key];
    });
    radios.forEach((r) => {
      r.checked = r.value === settings.daySeparatorMode;
    });
    refreshModes(!!settings.daySeparators);
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  }

  function save(change) {
    chrome.storage.sync.set(change);
  }

  chrome.storage.sync.get(DEFAULTS, render);

  switches.forEach((input) => {
    input.addEventListener('change', () => {
      save({ [input.dataset.key]: input.checked });
      if (input.dataset.key === 'daySeparators') refreshModes(input.checked);
    });
  });

  radios.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) save({ daySeparatorMode: r.value });
    });
  });

  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
})();
