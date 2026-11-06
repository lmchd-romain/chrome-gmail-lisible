/* Fenêtre de réglages : lit et enregistre les choix dans chrome.storage.sync. */
(function () {
  'use strict';

  const DEFAULTS = globalThis.GL_DEFAULTS;
  const switches = document.querySelectorAll('input[data-key]');
  const radios = document.querySelectorAll('input[name="daySeparatorMode"]');

  // Options qui dépendent d'une autre (grisées si celle-ci est coupée).
  function refreshDependencies() {
    document.querySelectorAll('[data-depends]').forEach((block) => {
      const parent = document.querySelector(`input[data-key="${block.dataset.depends}"]`);
      const on = !!(parent && parent.checked);
      block.classList.toggle('off', !on);
      block.querySelectorAll('input').forEach((i) => (i.disabled = !on));
    });
  }

  function render(settings) {
    switches.forEach((input) => {
      input.checked = !!settings[input.dataset.key];
    });
    radios.forEach((r) => {
      r.checked = r.value === settings.daySeparatorMode;
    });
    refreshDependencies();
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  }

  function save(change) {
    chrome.storage.sync.set(change);
  }

  chrome.storage.sync.get(DEFAULTS, render);

  switches.forEach((input) => {
    input.addEventListener('change', () => {
      save({ [input.dataset.key]: input.checked });
      refreshDependencies();
    });
  });

  radios.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) save({ daySeparatorMode: r.value });
    });
  });

  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  // ---------- Diagnostic ----------

  const diagButton = document.getElementById('diag');
  const diagStatus = document.getElementById('diag-status');
  const diagText = document.getElementById('diag-text');

  diagButton.addEventListener('click', async () => {
    diagStatus.textContent = '…';
    let text = '';
    // Onglet actif d'abord (cas normal), sinon le premier onglet Gmail qui répond.
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    const others = await chrome.tabs.query({});
    for (const tab of [...active, ...others]) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'glx-diagnostic' });
        text = res && res.text;
      } catch (err) {
        text = '';
      }
      if (text) break;
    }
    if (!text) {
      diagStatus.textContent = "Ouvrez Gmail dans l'onglet actif, rechargez-le, puis réessayez.";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      diagStatus.textContent = 'Copié ! Collez-le dans la discussion.';
      diagText.hidden = true;
    } catch (err) {
      diagStatus.textContent = 'Copie impossible : sélectionnez le texte ci-dessous.';
      diagText.hidden = false;
      diagText.value = text;
      diagText.select();
    }
  });
})();
