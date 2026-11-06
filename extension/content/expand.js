/*
 * Dépliage automatique de tous les messages d'une conversation.
 *
 * Gmail replie les anciens messages (classe .kv) et cache le milieu des longues
 * conversations derrière « N messages plus anciens » (classes .kQ / .kx, bloc .adv).
 * À l'ouverture d'une conversation, on clique « Tout développer » ; si ce bouton
 * est introuvable, on ouvre le bloc caché puis chaque message replié.
 * On agit seulement pendant quelques secondes après l'ouverture : si vous repliez
 * un message ensuite, il reste replié.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const WINDOW_MS = 12000; // durée pendant laquelle on déplie après l'ouverture
  const COLLAPSED = '.kv, .ky';
  const HIDDEN = '.kQ, .kx';
  const MESSAGE = '.h7, .kv, .ky, .kQ, .kx';
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
  const DRAFT_RE = /^(brouillon|draft|borrador|entwurf|bozza|rascunho|concept)\b/i;

  let currentKey = null;
  let windowEnd = 0;
  let expandAllClickedAt = 0;
  let clicked = new WeakMap(); // élément -> heure du dernier clic
  let seenOpen = new WeakSet(); // messages déjà vus ouverts : si vous les repliez, on n'y touche plus

  function norm(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  }

  function threadScope(list) {
    return list.closest('.a98.iY, .if, .PeIF1d, .Bu, [role="main"]');
  }

  /** La liste des messages de la conversation affichée (avec un sujet h2.hP à côté). */
  function visibleThreadList() {
    for (const list of document.querySelectorAll('[role="list"]')) {
      if (!list.querySelector(MESSAGE) || !GL.isVisible(list)) continue;
      const scope = threadScope(list);
      if (scope && scope.querySelector('h2.hP')) return list;
    }
    return null;
  }

  function threadKey(list) {
    const subject = threadScope(list).querySelector('h2.hP');
    const id = subject
      ? subject.getAttribute('data-thread-perm-id') ||
        subject.getAttribute('data-legacy-thread-id') ||
        subject.textContent
      : '';
    return location.hash.split('?')[0] + '|' + id;
  }

  function findExpandAllButton(list) {
    const scopes = [threadScope(list), document].filter(Boolean);
    for (const scope of scopes) {
      for (const img of scope.querySelectorAll('img.gx')) {
        const btn = img.closest('[role="button"]') || img;
        if (GL.isVisible(btn)) return btn;
      }
      for (const btn of scope.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip]')) {
        const label = norm(btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip'));
        if (EXPAND_ALL_LABELS.includes(label) && GL.isVisible(btn)) return btn;
      }
    }
    return null;
  }

  function isDraft(msg) {
    if (msg.querySelector('.boq')) return true;
    return DRAFT_RE.test(norm(msg.textContent).slice(0, 40));
  }

  function recentlyClicked(el, now) {
    const t = clicked.get(el);
    return t !== undefined && now - t < 2500;
  }

  function clickOnce(el, now) {
    if (!el || recentlyClicked(el, now)) return false;
    clicked.set(el, now);
    GL.click(el);
    return true;
  }

  function collapsedToOpen(list) {
    return [...list.querySelectorAll(COLLAPSED)].filter((m) => !seenOpen.has(m) && GL.isVisible(m) && !isDraft(m));
  }

  function fallbackExpand(list, collapsed, now) {
    // 1. Bloc « N messages plus anciens »
    for (const notice of list.querySelectorAll('.adv')) {
      if (!GL.isVisible(notice)) continue;
      clickOnce(notice.querySelector('.adx') || notice, now);
    }
    // 2. Chaque message replié visible
    let count = 0;
    for (const msg of collapsed) {
      if (count >= 40) break;
      const target = msg.querySelector('.adf.ads, .adf') || msg;
      if (clickOnce(target, now)) count++;
    }
  }

  function update(settings) {
    if (!settings.autoExpand) return;

    const list = visibleThreadList();
    if (!list) {
      currentKey = null; // rouvrir la même conversation la dépliera de nouveau
      return;
    }

    const now = Date.now();
    const key = threadKey(list);
    if (key !== currentKey) {
      currentKey = key;
      windowEnd = now + WINDOW_MS;
      expandAllClickedAt = 0;
      clicked = new WeakMap();
      seenOpen = new WeakSet();
    }
    if (now > windowEnd) return;

    for (const m of list.querySelectorAll('.h7')) seenOpen.add(m);
    const collapsed = collapsedToOpen(list);
    const hasHidden = !!list.querySelector(HIDDEN);
    if (!collapsed.length && !hasHidden) {
      // Tout est ouvert : on surveille encore un court instant (affichage progressif de Gmail).
      windowEnd = Math.min(windowEnd, now + 2500);
      GL.later(1000);
      return;
    }

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

  GL.register({ name: 'dépliage automatique', update });
})();
