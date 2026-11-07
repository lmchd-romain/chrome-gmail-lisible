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

  const MESSAGE = '.h7, .kv, .ky, .kQ, .kx';
  const DRAFT_WORDS = ['brouillon', 'draft', 'borrador', 'entwurf', 'bozza', 'rascunho', 'concept'];

  const GL = {
    disabled: false,
    settings: Object.assign({}, DEFAULTS),
    MESSAGE,
    EDITOR: '[g_editable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"].editable',

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

    /** Minuscules, sans accents ni tirets : « Fenêtre pop-up » -> « fenetre pop up ». */
    norm(s) {
      return String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[-_‐-―]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    /** Attend qu'une condition renvoie une valeur (ou null après le délai). */
    waitFor(test, timeoutMs, stepMs) {
      const end = Date.now() + timeoutMs;
      return new Promise((resolve) => {
        (function tick() {
          let value = null;
          try {
            value = test();
          } catch (err) {
            value = null;
          }
          if (value) return resolve(value);
          if (Date.now() > end) return resolve(null);
          setTimeout(tick, stepMs || 100);
        })();
      });
    },

    lang() {
      return html.getAttribute('lang') || navigator.language || 'fr';
    },

    log(...args) {
      console.debug('[Gmail Lisible]', ...args);
    },

    /** Petit journal des dernières actions (repris dans le diagnostic). */
    traces: [],
    trace(feature, message) {
      GL.traces.push(new Date().toISOString().slice(11, 19) + ' ' + feature + ' : ' + message);
      if (GL.traces.length > 40) GL.traces.shift();
      GL.log(feature + ' : ' + message);
    },

    // ---------- Conversation affichée ----------

    threadScope(list) {
      return list.closest('.a98.iY, .if, .PeIF1d, .Bu, [role="main"]');
    },

    /** La liste des messages de la conversation affichée (avec un sujet h2.hP à côté). */
    visibleThreadList() {
      for (const list of document.querySelectorAll('[role="list"]')) {
        if (!list.querySelector(MESSAGE) || !GL.isVisible(list)) continue;
        const scope = GL.threadScope(list);
        if (scope && scope.querySelector('h2.hP')) return list;
      }
      return null;
    },

    /** Identifiant de la conversation affichée (change quand on en ouvre une autre). */
    threadKey(list) {
      const scope = list && GL.threadScope(list);
      const subject = scope && scope.querySelector('h2.hP');
      const id = subject
        ? subject.getAttribute('data-thread-perm-id') ||
          subject.getAttribute('data-legacy-thread-id') ||
          subject.textContent
        : '';
      return location.hash.split('?')[0] + '|' + id;
    },

    /** Un brouillon dans la conversation (« Brouillon » en rouge à la place de l'expéditeur). */
    isDraftMessage(msg) {
      if (msg.querySelector('.boq')) return true;
      const start = GL.norm(msg.textContent.slice(0, 80));
      if (DRAFT_WORDS.some((w) => start.startsWith(w))) return true;
      for (const el of msg.querySelectorAll('font, span, div')) {
        if (el.childElementCount) continue;
        const t = GL.norm(el.textContent);
        if (t && t.length < 20 && DRAFT_WORDS.includes(t.replace(/s$/, ''))) return true;
      }
      return false;
    },

    // ---------- Défilement ----------

    findScroller(el) {
      for (let p = el && el.parentElement; p && p !== document.body && p !== html; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight + 1) return p;
      }
      return document.scrollingElement || html;
    },

    atBottom(sc) {
      return sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 4;
    },
  };
  globalThis.GL = GL;

  // Attributs sur <html> pour activer/désactiver les règles CSS.
  function applyRootFlags() {
    const s = GL.settings;
    toggleAttr('data-glx-hide-trimmed', s.hideTrimmedButton);
    toggleAttr('data-glx-hide-ph', s.hideAttachmentPlaceholders);
    toggleAttr('data-glx-hide-history', s.hideQuotedHistory);
    toggleAttr('data-glx-hide-sig', s.hideRepeatedSignatures);
    // Ce que Gmail cache derrière « ••• » sans que vous l'ayez jamais reçu est réaffiché.
    toggleAttr('data-glx-reveal', s.hideTrimmedButton || s.hideQuotedHistory);
    toggleAttr('data-glx-dark', isDarkTheme());
  }

  // Thème de Gmail : sombre si le fond derrière le contenu est foncé ; avec un thème
  // à image (pas de couleur de fond), si le texte de Gmail est clair.
  function lum(color) {
    const m = String(color).match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const a = m.length > 3 ? Number(m[3]) : 1;
    return { l: 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2], a };
  }

  GL.themeInfo = () => {
    const start =
      [...document.querySelectorAll('tr.zA, .h7, [role="main"]')].find((e) => GL.isVisible(e)) ||
      document.body;
    if (!start) return { dark: false, how: 'page vide' };
    const text = lum(getComputedStyle(start.parentElement || start).color);
    for (let el = start; el && el.nodeType === 1; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const bg = lum(cs.backgroundColor);
      if (bg && bg.a >= 0.5) return { dark: bg.l < 128, how: 'fond ' + cs.backgroundColor + ' (' + el.tagName.toLowerCase() + ')' };
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) break;
    }
    const dark = !!text && text.l > 140;
    return { dark, how: 'texte ' + (text ? Math.round(text.l) : '?') };
  };

  function isDarkTheme() {
    try {
      return GL.themeInfo().dark;
    } catch (err) {
      return false;
    }
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

  // Vérifications express, juste après chaque changement de la page et avant
  // l'affichage (ex. déplier une conversation sans qu'on la voie repliée).
  function runQuick() {
    if (!ready) return;
    for (const f of features) {
      if (!f.quick) continue;
      try {
        f.quick(GL.settings);
      } catch (err) {
        console.warn('[Gmail Lisible] ' + f.name + ' :', err);
      }
    }
  }

  function startObserver() {
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const nodes = [...r.addedNodes, ...r.removedNodes];
        if (nodes.length && nodes.every(isOwnNode)) continue;
        if (r.target.nodeType === 1 && r.target.closest && r.target.closest('.glx-own')) continue;
        runQuick();
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
