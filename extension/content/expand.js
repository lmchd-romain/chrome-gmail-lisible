/*
 * Dépliage automatique de tous les messages d'une conversation.
 *
 * Gmail replie les anciens messages (classe .kv) et cache le milieu des longues
 * conversations derrière « N messages plus anciens » (classes .kQ / .kx, bloc .adv).
 * À l'ouverture d'une conversation, on clique « Tout développer » ; si ce bouton
 * est introuvable, on ouvre le bloc caché puis chaque message replié.
 * On agit seulement pendant quelques secondes après l'ouverture : si vous repliez
 * un message ensuite, il reste replié. Les brouillons ne sont jamais ouverts.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const WINDOW_MS = 12000; // durée pendant laquelle on déplie après l'ouverture
  const COLLAPSED = '.kv, .ky';
  const HIDDEN = '.kQ, .kx';
  const EXPAND_ALL_LABELS = [
    'tout developper',
    'expand all',
    'alle maximieren',
    'alle erweitern',
    'expandir todo',
    'espandi tutto',
    'expandir tudo',
    'alles uitvouwen',
  ];

  const VEIL_MS = 1500; // au plus 1,5 s de conversation masquée pendant le dépliage

  let currentKey = null;
  let windowEnd = 0;
  let expandAllClickedAt = 0;
  let clicked = new WeakMap(); // élément -> heure du dernier clic
  let seenOpen = new WeakSet(); // messages déjà vus ouverts : si vous les repliez, on n'y touche plus

  // Compteurs « vivants » des messages repliés/cachés (très rapides à lire).
  const LIVE = ['kv', 'ky', 'kQ', 'kx'].map((c) => document.getElementsByClassName(c));
  let quickCount = -1;
  let quickHash = null;

  // ---------- Voile : la conversation reste invisible le temps du dépliage ----------

  let veiled = null;
  let veilTimer = 0;

  function veil(list) {
    if (veiled === list) return;
    unveil();
    veiled = list;
    list.classList.add('glx-expanding', 'glx-fade');
    veilTimer = setTimeout(unveil, VEIL_MS);
  }

  function unveil() {
    clearTimeout(veilTimer);
    if (veiled) veiled.classList.remove('glx-expanding');
    veiled = null;
  }

  function findExpandAllButton(list) {
    const scopes = [GL.threadScope(list), document].filter(Boolean);
    for (const scope of scopes) {
      for (const img of scope.querySelectorAll('img.gx')) {
        const btn = img.closest('[role="button"]') || img;
        if (GL.isVisible(btn)) return btn;
      }
      for (const btn of scope.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip]')) {
        const label = GL.norm(btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip'));
        if (EXPAND_ALL_LABELS.includes(label) && GL.isVisible(btn)) return btn;
      }
    }
    return null;
  }

  function clickOnce(el, now) {
    const t = clicked.get(el);
    if (!el || (t !== undefined && now - t < 2500)) return false;
    clicked.set(el, now);
    GL.click(el);
    return true;
  }

  function collapsedToOpen(list) {
    return [...list.querySelectorAll(COLLAPSED)].filter(
      (m) => !seenOpen.has(m) && GL.isVisible(m) && !GL.isDraftMessage(m),
    );
  }

  function fallbackExpand(list, collapsed, now) {
    // 1. Bloc « N messages plus anciens »
    for (const notice of list.querySelectorAll('.adv')) {
      if (GL.isVisible(notice)) clickOnce(notice.querySelector('.adx') || notice, now);
    }
    // 2. Chaque message replié visible
    let count = 0;
    for (const msg of collapsed) {
      if (count >= 40) break;
      if (clickOnce(msg.querySelector('.adf.ads, .adf') || msg, now)) count++;
    }
  }

  function update(settings) {
    if (!settings.autoExpand) {
      unveil();
      return;
    }

    const list = GL.visibleThreadList();
    if (!list) {
      currentKey = null; // rouvrir la même conversation la dépliera de nouveau
      unveil();
      return;
    }

    const now = Date.now();
    const key = GL.threadKey(list);
    let fresh = false;
    if (key !== currentKey) {
      currentKey = key;
      windowEnd = now + WINDOW_MS;
      expandAllClickedAt = 0;
      clicked = new WeakMap();
      seenOpen = new WeakSet();
      fresh = true;
    }
    if (now > windowEnd) {
      unveil();
      return;
    }

    for (const m of list.querySelectorAll('.h7')) seenOpen.add(m);
    const collapsed = collapsedToOpen(list);
    const hasHidden = !!list.querySelector(HIDDEN);
    if (!collapsed.length && !hasHidden) {
      // Tout est ouvert : on surveille encore un court instant (affichage progressif de Gmail).
      unveil();
      windowEnd = Math.min(windowEnd, now + 2500);
      GL.later(1000);
      return;
    }
    if (fresh) veil(list); // conversation qui s'ouvre : on ne la montre qu'une fois dépliée

    if (!expandAllClickedAt) {
      const btn = findExpandAllButton(list);
      if (btn) {
        expandAllClickedAt = now;
        GL.click(btn);
        GL.later(1200);
        return;
      }
    } else if (now - expandAllClickedAt < 1200) {
      GL.later(400);
      return;
    }

    fallbackExpand(list, collapsed, now);
    GL.later(800);
  }

  /** Appelée juste après chaque changement de la page : déplie avant l'affichage. */
  function quick(settings) {
    if (!settings.autoExpand) return;
    let count = 0;
    for (const l of LIVE) count += l.length;
    if (count === quickCount && location.hash === quickHash) return;
    quickCount = count;
    quickHash = location.hash;
    if (count > 0) update(settings);
  }

  window.addEventListener('hashchange', unveil);

  GL.register({ name: 'dépliage automatique', update, quick });
})();
