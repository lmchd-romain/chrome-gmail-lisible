/*
 * Noyau de Gmail Lisible : réglages, surveillance de la page, outils communs.
 * Chaque fonction (dépliage, séparateurs…) s'enregistre avec GL.register().
 */
(function () {
  'use strict';

  const html = document.documentElement;

  // Une seule instance par page (évite les doublons si l'extension est chargée deux fois).
  if (html.hasAttribute('data-glx-loaded')) {
    globalThis.GL = { disabled: true };
    return;
  }
  html.setAttribute('data-glx-loaded', '');

  const DEFAULTS = globalThis.GL_DEFAULTS;
  const features = [];
  let ready = false;
  let timer = 0;

  const GL = {
    disabled: false,
    settings: Object.assign({}, DEFAULTS),

    register(feature) {
      features.push(feature);
    },

    /** Demande une mise à jour (regroupée, au plus toutes les ~120 ms). */
    schedule(delay) {
      if (timer) return;
      timer = setTimeout(run, typeof delay === 'number' ? delay : 120);
    },

    /** Re-vérifie plus tard (utile pendant que Gmail affiche la page). */
    later(ms) {
      setTimeout(() => GL.schedule(0), ms);
    },

    isVisible(el) {
      return !!(el && el.isConnected && el.getClientRects().length);
    },

    /** Clic « humain » : mousedown + mouseup + click, comme Gmail l'attend. */
    click(el) {
      if (!el) return;
      const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    },

    lang() {
      return html.getAttribute('lang') || navigator.language || 'fr';
    },

    log(...args) {
      console.debug('[Gmail Lisible]', ...args);
    },
  };
  globalThis.GL = GL;

  // Attributs sur <html> pour activer/désactiver les règles CSS.
  function applyRootFlags() {
    const s = GL.settings;
    toggleAttr('data-glx-hide-trimmed', s.hideTrimmedButton);
    toggleAttr('data-glx-hide-ph', s.hideAttachmentPlaceholders);
  }

  function toggleAttr(name, on) {
    if (on && !html.hasAttribute(name)) html.setAttribute(name, '');
    else if (!on && html.hasAttribute(name)) html.removeAttribute(name);
  }

  function run() {
    timer = 0;
    if (!ready) return;
    applyRootFlags();
    for (const f of features) {
      try {
        f.update(GL.settings);
      } catch (err) {
        console.warn('[Gmail Lisible] ' + f.name + ' :', err);
      }
    }
  }

  function readSettings(items) {
    for (const key of Object.keys(DEFAULTS)) {
      if (items && items[key] !== undefined) GL.settings[key] = items[key];
    }
  }

  // Lecture des réglages, puis démarrage.
  try {
    chrome.storage.sync.get(DEFAULTS, (items) => {
      readSettings(items);
      ready = true;
      applyRootFlags();
      GL.schedule(0);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const next = {};
      for (const key of Object.keys(changes)) next[key] = changes[key].newValue;
      readSettings(next);
      for (const key of Object.keys(changes)) {
        if (changes[key].newValue === undefined && key in DEFAULTS) GL.settings[key] = DEFAULTS[key];
      }
      GL.schedule(0);
    });
  } catch (err) {
    // Contexte d'extension invalide (extension rechargée) : on garde les valeurs par défaut.
    ready = true;
    GL.schedule(0);
  }

  // Nos propres insertions ne doivent pas relancer une mise à jour.
  function isOwnNode(n) {
    return n.nodeType === 1 && n.classList.contains('glx-own');
  }

  function startObserver() {
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const nodes = [...r.addedNodes, ...r.removedNodes];
        if (nodes.length && nodes.every(isOwnNode)) continue;
        if (r.target.nodeType === 1 && r.target.closest && r.target.closest('.glx-own')) continue;
        GL.schedule();
        return;
      }
    });
    observer.observe(html, { childList: true, subtree: true });
  }

  startObserver();
  window.addEventListener('hashchange', () => GL.schedule(0));
  window.addEventListener('popstate', () => GL.schedule(0));
  window.addEventListener('resize', () => GL.schedule());
  // Filet de sécurité (changement de jour pour « Aujourd'hui », vues réaffichées…).
  setInterval(() => GL.schedule(0), 30000);
})();
