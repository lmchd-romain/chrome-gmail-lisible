/*
 * Réponse flottante.
 *
 * Après un clic sur « Répondre », la zone de réponse s'ouvre en bas de la
 * conversation. Quand vous remontez pour relire, elle se détache et reste
 * visible en bas à droite, comme une fenêtre pop-up. Quand vous redescendez
 * tout en bas, elle reprend sa place normale.
 *
 * On ne déplace jamais l'éditeur de Gmail dans la page : on change seulement
 * son affichage (CSS). Le brouillon, le curseur et l'envoi restent intacts.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const FLOAT_BELOW = 0.35; // part visible de la réponse sous laquelle elle devient flottante
  const DOCK_ABOVE = 0.75; // part visible au-dessus de laquelle elle reprend sa place
  const MARGIN = 24;
  const MAX_WIDTH = 680;
  const VARS = ['--glx-right', '--glx-bottom', '--glx-width', '--glx-maxh', '--glx-bg'];
  const EDITOR = '[g_editable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"].editable';

  let cur = null; // { host, card, scroller, floating, minimized, header, ro, savedMinHeight, pos }
  let userScrolled = false;
  let brokenLayout = false;
  let rafPending = false;

  // ---------- Recherche de la réponse ouverte ----------

  function findReply() {
    for (const host of document.querySelectorAll('.ip.adB')) {
      const card = host.querySelector('.M9') || host.firstElementChild;
      if (!card || !card.querySelector(EDITOR)) continue;
      if (GL.isVisible(host)) return { host, card };
    }
    // Repli : éditeur intégré à la conversation (pas une fenêtre de rédaction).
    for (const editor of document.querySelectorAll(EDITOR)) {
      if (editor.closest('[role="dialog"], .AD, .glx-own')) continue;
      const card = editor.closest('.M9');
      if (!card || !card.closest('[role="main"], .AO')) continue;
      const host = card.closest('.ip') || card.parentElement;
      if (host && GL.isVisible(host)) return { host, card };
    }
    return null;
  }

  function findScroller(el) {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function isDocumentScroller(sc) {
    return sc === document.scrollingElement || sc === document.documentElement || sc === document.body;
  }

  function viewportOf(sc) {
    if (isDocumentScroller(sc)) {
      return { top: 0, bottom: innerHeight, left: 0, right: innerWidth, width: innerWidth, height: innerHeight };
    }
    const r = sc.getBoundingClientRect();
    const top = Math.max(0, r.top);
    const bottom = Math.min(innerHeight, r.bottom);
    const left = Math.max(0, r.left);
    const right = Math.min(innerWidth, r.right - (sc.offsetWidth - sc.clientWidth)); // sans la barre de défilement
    return { top, bottom, left, right, width: right - left, height: bottom - top };
  }

  function visibleRatio(c) {
    const h = c.host.getBoundingClientRect();
    const v = viewportOf(c.scroller);
    const visible = Math.max(0, Math.min(h.bottom, v.bottom) - Math.max(h.top, v.top));
    return visible / Math.max(1, Math.min(h.height, v.height));
  }

  function atBottom(sc) {
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 4;
  }

  function backgroundOf(el) {
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor;
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const parts = m[1].split(',').map((x) => parseFloat(x));
      if (parts.length === 4 && parts[3] < 0.5) continue;
      return { css: bg, dark: 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2] < 128 };
    }
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return { css: bodyBg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bodyBg) ? bodyBg : '#ffffff', dark: false };
  }

  // ---------- Mode flottant ----------

  function computePosition(c) {
    const v = viewportOf(c.scroller);
    const dockedWidth = c.dockedWidth || c.card.getBoundingClientRect().width || MAX_WIDTH;
    const width = Math.round(Math.max(320, Math.min(MAX_WIDTH, dockedWidth, v.width - 2 * MARGIN)));
    return {
      right: Math.round(Math.max(8, innerWidth - v.right + MARGIN)),
      bottom: Math.round(Math.max(0, innerHeight - v.bottom)),
      width,
      maxHeight: Math.round(Math.max(200, Math.min(innerHeight * 0.7, v.height - 90))),
    };
  }

  function applyPosition(c) {
    const p = computePosition(c);
    const same = c.pos && ['right', 'bottom', 'width', 'maxHeight'].every((k) => c.pos[k] === p[k]);
    c.pos = p;
    if (same) return;
    const st = c.card.style;
    st.setProperty('--glx-right', p.right + 'px');
    st.setProperty('--glx-bottom', p.bottom + 'px');
    st.setProperty('--glx-width', p.width + 'px');
    st.setProperty('--glx-maxh', p.maxHeight + 'px');
    positionHeader(c);
  }

  function float(c) {
    const hostRect = c.host.getBoundingClientRect();
    c.dockedWidth = c.card.getBoundingClientRect().width;
    c.savedMinHeight = c.host.style.minHeight;
    c.host.style.minHeight = Math.round(hostRect.height) + 'px'; // garde la place : pas de saut de page

    const bg = backgroundOf(c.card);
    c.card.style.setProperty('--glx-bg', bg.css);
    c.card.classList.add('glx-floating');
    c.floating = true;
    applyPosition(c);

    // Sécurité : si Gmail empêche le positionnement, on n'insiste pas.
    const r = c.card.getBoundingClientRect();
    const expectedRight = innerWidth - c.pos.right;
    const expectedBottom = innerHeight - c.pos.bottom;
    if (Math.abs(r.right - expectedRight) > 40 || Math.abs(r.bottom - expectedBottom) > 40 || r.width < 100) {
      GL.log('réponse flottante impossible sur cette page, fonction mise en pause');
      brokenLayout = true;
      dock(c);
      return;
    }
    ensureHeader(c, bg.dark);
  }

  function dock(c) {
    c.card.classList.remove('glx-floating', 'glx-floating-min');
    for (const v of VARS) c.card.style.removeProperty(v);
    c.host.style.minHeight = c.savedMinHeight || '';
    c.pos = null;
    c.floating = false;
    c.minimized = false;
    removeHeader(c);
  }

  function release(c) {
    if (c.floating) dock(c);
    removeHeader(c);
  }

  // ---------- Barre de titre de la fenêtre flottante ----------

  const ICONS = {
    minimize: 'M6 19h12v2H6z',
    restore: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
    back: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  };

  function icon(path) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }

  function button(label, path, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(icon(path));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  function subjectText() {
    for (const h of document.querySelectorAll('h2.hP')) {
      if (GL.isVisible(h)) return h.textContent.trim();
    }
    return '';
  }

  function ensureHeader(c, dark) {
    if (c.header && c.header.isConnected) return positionHeader(c);
    const header = document.createElement('div');
    header.className = 'glx-own glx-float-header' + (dark ? ' glx-dark' : '');
    header.setAttribute('role', 'toolbar');

    const title = document.createElement('div');
    title.className = 'glx-title';
    const subject = subjectText();
    title.textContent = subject ? 'Réponse · ' + subject : 'Réponse en cours';
    title.title = 'Cliquer pour réduire ou agrandir';

    const toggle = button('Réduire', ICONS.minimize, () => setMinimized(c, !c.minimized));
    const back = button('Revenir à la réponse (en bas de la conversation)', ICONS.back, () => goBack(c));

    header.append(title, toggle, back);
    header.addEventListener('click', () => setMinimized(c, !c.minimized));
    document.body.appendChild(header);

    c.header = header;
    c.toggleButton = toggle;
    c.ro = new ResizeObserver(() => positionHeader(c));
    c.ro.observe(c.card);
    positionHeader(c);
  }

  function positionHeader(c) {
    const h = c.header;
    if (!h || !c.pos) return;
    const cardHeight = c.minimized ? 0 : c.card.getBoundingClientRect().height;
    h.style.right = c.pos.right + 'px';
    h.style.width = c.pos.width + 'px';
    h.style.bottom = Math.round(c.pos.bottom + cardHeight) + 'px';
  }

  function removeHeader(c) {
    if (c.ro) c.ro.disconnect();
    c.ro = null;
    if (c.header) c.header.remove();
    c.header = null;
  }

  function setMinimized(c, on) {
    if (!c.floating) return;
    c.minimized = on;
    c.card.classList.toggle('glx-floating-min', on);
    if (c.toggleButton) {
      const label = on ? 'Agrandir' : 'Réduire';
      c.toggleButton.title = label;
      c.toggleButton.setAttribute('aria-label', label);
      c.toggleButton.replaceChildren(icon(on ? ICONS.restore : ICONS.minimize));
    }
    positionHeader(c);
  }

  function goBack(c) {
    c.host.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  // ---------- Boucle principale ----------

  function evaluate() {
    if (!GL.settings.floatingReply || brokenLayout) {
      if (cur) release(cur);
      cur = null;
      return;
    }

    const found = findReply();
    if (!found) {
      if (cur) release(cur);
      cur = null;
      return;
    }

    if (!cur || cur.card !== found.card || cur.host !== found.host) {
      if (cur) release(cur);
      cur = { host: found.host, card: found.card, scroller: findScroller(found.host), floating: false, minimized: false };
      userScrolled = false; // on attend que vous fassiez défiler la conversation
    }

    if (!cur.scroller.isConnected) cur.scroller = findScroller(cur.host);
    const ratio = visibleRatio(cur);

    if (!cur.floating) {
      if (userScrolled && ratio < FLOAT_BELOW && !atBottom(cur.scroller)) float(cur);
    } else if (ratio > DOCK_ABOVE || atBottom(cur.scroller)) {
      dock(cur);
    } else {
      applyPosition(cur);
    }
  }

  function onScroll(e) {
    const t = e.target;
    if (cur && t && t.nodeType === 1 && (cur.card.contains(t) || t.closest('.glx-own'))) return;
    userScrolled = true;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      try {
        evaluate();
      } catch (err) {
        console.warn('[Gmail Lisible] réponse flottante :', err);
      }
    });
  }

  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', () => cur && cur.floating && applyPosition(cur));
  window.addEventListener('hashchange', () => {
    if (cur) release(cur);
    cur = null;
  });

  GL.register({ name: 'réponse flottante', update: evaluate });
})();
