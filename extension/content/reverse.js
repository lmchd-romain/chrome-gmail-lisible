/*
 * Conversation inversée : le message le plus récent en haut, le premier en bas,
 * et la réponse (avec les boutons « Répondre / Transférer ») tout en haut.
 *
 * Aucun nœud de Gmail n'est déplacé : on ajoute seulement des classes, et le CSS
 * (flex + order) change l'ordre d'affichage. Le reste de l'extension (historique
 * déjà lu, pièces jointes…) continue de raisonner dans l'ordre réel de Gmail.
 * À l'ouverture d'une conversation, on part du haut (le message le plus récent).
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const NAME = 'conversation inversée';
  const CLASSES = ['glx-rv-msgs', 'glx-rv-col', 'glx-rv-first', 'glx-rv-flex', 'glx-rv-main', 'glx-rv-top'];
  const SELECTOR = CLASSES.map((c) => '.' + c).join(', ');
  const LIVE_IP = document.getElementsByClassName('ip');
  const LIVE_EDITORS = document.getElementsByClassName('adB');

  let currentKey = null;
  let openedAt = 0;
  let userMovedAt = 0;
  let lastHost = null;
  let lastProblem = '';
  let quickSig = '';

  function problem(msg) {
    if (msg !== lastProblem) GL.trace(NAME, msg);
    lastProblem = msg;
  }

  /** On ne passe en flex que des blocs ordinaires (jamais un tableau ou une cellule). */
  function canFlex(el) {
    if (el.classList.contains('glx-rv-msgs') || el.classList.contains('glx-rv-col') || el.classList.contains('glx-rv-flex')) return true;
    return getComputedStyle(el).display === 'block';
  }

  /** Le bloc qui contient directement les messages. */
  function messagesParent(list) {
    const first = list.querySelector(GL.MESSAGE);
    const parent = first && first.parentElement;
    return parent && list.contains(parent) ? parent : null;
  }

  /** Enfant de `ancestor` qui contient `el`. */
  function branchOf(ancestor, el) {
    let b = el;
    while (b && b.parentElement !== ancestor) b = b.parentElement;
    return b;
  }

  /** Remonte de `el` jusqu'à `stop` : chaque niveau met sa branche en premier. */
  function chainToTop(el, stop, want) {
    const marks = [];
    for (let n = el; n && n !== stop; n = n.parentElement) {
      const p = n.parentElement;
      if (!p || !stop.contains(p) || !canFlex(p)) return false;
      marks.push([p, 'glx-rv-col'], [n, 'glx-rv-first']);
    }
    for (const m of marks) want.push(m);
    return true;
  }

  /** Classes voulues pour la conversation affichée : [[élément, classe]…]. */
  function wanted(list) {
    const want = [];
    const msgs = messagesParent(list);
    if (!msgs || !canFlex(msgs)) {
      problem('liste des messages non inversable');
      return want;
    }
    want.push([msgs, 'glx-rv-msgs']);

    // Réponse : la zone .ip du dernier message, en haut de ce message.
    const items = [...msgs.children];
    const ips = [...list.querySelectorAll('.ip')];
    const ip = ips[ips.length - 1];
    if (ip) {
      const msg = branchOf(msgs, ip);
      if (msg && msg === items[items.length - 1] && !chainToTop(ip, msg, want)) problem('réponse non déplaçable en haut');
    }

    // Boutons « Répondre / Transférer » (s'ils sont hors de la liste) : juste au-dessus des messages.
    const scope = GL.threadScope(list) || document;
    const amn = [...scope.querySelectorAll('.amn')].find((a) => !list.contains(a) && !a.closest('.glx-own'));
    if (amn) {
      let lca = amn.parentElement;
      while (lca && !lca.contains(list)) lca = lca.parentElement;
      if (lca && scope.contains(lca) && canFlex(lca)) {
        want.push([lca, 'glx-rv-flex'], [branchOf(lca, list), 'glx-rv-main'], [branchOf(lca, amn), 'glx-rv-top']);
      } else {
        problem('boutons « Répondre » non déplaçables en haut');
      }
    }
    return want;
  }

  function apply(want) {
    const keep = new Map(); // élément -> classes voulues
    for (const [el, cls] of want) {
      if (!keep.has(el)) keep.set(el, new Set());
      keep.get(el).add(cls);
    }
    for (const el of document.querySelectorAll(SELECTOR)) {
      const k = keep.get(el);
      for (const c of CLASSES) if (el.classList.contains(c) && !(k && k.has(c))) el.classList.remove(c);
    }
    for (const [el, set] of keep) for (const c of set) if (!el.classList.contains(c)) el.classList.add(c);
  }

  function clearAll() {
    for (const el of document.querySelectorAll(SELECTOR)) el.classList.remove(...CLASSES);
  }

  /** Éditeur de réponse ouvert dans la conversation (hors fenêtres pop-up). */
  function inlineHost(list) {
    for (const ed of list.querySelectorAll(GL.EDITOR)) {
      if (ed.closest('.AD, [role="dialog"], .glx-own') || !GL.isVisible(ed)) continue;
      return ed.closest('.ip') || ed.closest('.M9') || ed;
    }
    return null;
  }

  function toTop(list) {
    const sc = GL.findScroller(list);
    if (userMovedAt > openedAt || !sc) return;
    if (sc.scrollTop) sc.scrollTop = 0;
  }

  function update(settings) {
    if (!settings.reverseThread) {
      if (currentKey !== null || document.querySelector(SELECTOR)) clearAll();
      currentKey = null;
      lastHost = null;
      return;
    }
    const list = GL.visibleThreadList();
    if (!list) {
      currentKey = null;
      lastHost = null;
      if (document.querySelector(SELECTOR)) clearAll();
      return;
    }
    apply(wanted(list));

    // Nouvelle conversation : on part du haut (message le plus récent), sauf si vous avez déjà bougé.
    const key = GL.threadKey(list);
    if (key !== currentKey) {
      currentKey = key;
      openedAt = Date.now();
      lastHost = inlineHost(list);
      for (const ms of [0, 400, 1200, 2500]) setTimeout(() => GL.visibleThreadList() === list && toTop(list), ms);
    }

    // Réponse qui vient de s'ouvrir : Gmail descend vers l'ancien emplacement, on la ramène à l'écran.
    const host = inlineHost(list);
    if (host && host !== lastHost) {
      for (const ms of [0, 300]) setTimeout(() => host.isConnected && host.scrollIntoView({ block: 'nearest' }), ms);
    }
    lastHost = host;
  }

  /** Juste après chaque changement : remet la réponse en haut avant l'affichage. */
  function quick(settings) {
    if (!settings.reverseThread) return;
    const sig = LIVE_IP.length + '|' + LIVE_EDITORS.length + '|' + location.hash;
    if (sig === quickSig) return;
    quickSig = sig;
    const list = GL.visibleThreadList();
    if (list) apply(wanted(list));
  }

  for (const type of ['wheel', 'keydown', 'mousedown', 'touchstart']) {
    window.addEventListener(type, () => (userMovedAt = Date.now()), { capture: true, passive: true });
  }

  /** Vrai si la conversation affichée est réellement inversée. */
  GL.isReversed = (list) => {
    const msgs = list && messagesParent(list);
    return !!(msgs && msgs.classList.contains('glx-rv-msgs'));
  };

  GL.register({ name: NAME, update, quick });
})();
