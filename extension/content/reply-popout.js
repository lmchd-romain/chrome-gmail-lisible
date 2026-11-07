/*
 * Réponse en fenêtre pop-up (celle de Gmail).
 *
 * Après un clic sur « Répondre », la réponse s'ouvre en bas de la conversation.
 * Quand vous remontez pour relire, on clique pour vous sur le bouton de Gmail
 * « Afficher dans une fenêtre pop-up » : la réponse passe dans la vraie fenêtre
 * de rédaction de Gmail, en bas à droite.
 *
 * Quand vous redescendez tout en bas (réglage « la remettre en place ») :
 * on ferme la fenêtre avec la croix de Gmail (qui enregistre le brouillon),
 * puis on rouvre ce brouillon dans la conversation. Si la réponse était vide,
 * Gmail la supprime : on rouvre alors simplement une réponse vide.
 * Le cycle peut se répéter autant de fois que vous voulez.
 * On n'agit que sur une fenêtre ouverte par l'extension.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const NAME = 'réponse pop-up';
  const POP_BELOW = 0.35; // part visible de la réponse sous laquelle elle passe en pop-up
  const DOCK_MARGIN = 40; // la réponse revient dès que sa place est visible (à 40 px du bas de l'écran)
  const CLIMB = 150; // il faut remonter d'au moins 150 px pour la renvoyer en pop-up (pas de va-et-vient)
  const POPUP = '.AD, [role="dialog"]';
  const POPOUT_RE = /\bpop ?up\b|\bpop ?out\b|\bpopup\b/;
  const CLOSE_LABELS = ['enregistrer et fermer', 'fermer', 'save & close', 'save and close', 'close', 'speichern und schliessen', 'guardar y cerrar', 'salva e chiudi'];

  let inline = null; // réponse ouverte dans la conversation : { host, card, threadKey }
  let popped = null; // fenêtre pop-up ouverte par l'extension : { root, threadKey, at, replyButton }
  let userScrolled = false;
  let direction = 0; // 1 = vers le bas, -1 = vers le haut
  const lastTop = new WeakMap();
  let busy = false;
  let cooldownUntil = 0;
  let lastReplyButton = null; // dernier bouton « Répondre / Répondre à tous / Transférer » cliqué
  let lastProblem = '';
  let lowest = 0; // position la plus basse atteinte depuis que la réponse est dans la conversation

  function problem(msg) {
    if (msg !== lastProblem) GL.trace(NAME, msg); // une seule fois de suite par problème
    lastProblem = msg;
  }

  // ---------- Repérage ----------

  /** Zone de défilement de la conversation affichée (recalculée à chaque fois). */
  function threadScroller(fallbackEl) {
    const list = GL.visibleThreadList();
    return GL.findScroller(list || fallbackEl);
  }

  function isScrollable(sc) {
    return sc.scrollHeight > sc.clientHeight + 1;
  }

  /** Éditeur de réponse ouvert dans la conversation (pas dans une fenêtre pop-up). */
  function findInlineReply() {
    const list = GL.visibleThreadList();
    const scope = list ? GL.threadScope(list) || list : null;
    if (!scope) return null;
    for (const editor of scope.querySelectorAll(GL.EDITOR)) {
      if (editor.closest(POPUP + ', .glx-own') || !GL.isVisible(editor)) continue;
      const card = editor.closest('.M9') || editor.closest('.ip') || editor.parentElement;
      const host = card.closest('.ip') || card;
      if (GL.isVisible(host)) return { host, card };
    }
    return null;
  }

  function labelOf(el) {
    return GL.norm(el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '');
  }

  function findPopoutButton(c) {
    // La réponse elle-même, puis le message qui la contient (brouillon rouvert…).
    const scopes = [c.host, c.card.closest('.adn'), c.card.closest('[role="listitem"]')].filter(Boolean);
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('[role="button"], button, [data-tooltip]')) {
        if (!el.closest(POPUP) && POPOUT_RE.test(labelOf(el))) return el;
      }
    }
    // Menu « type de réponse » : son dernier choix est « Ouvrir dans une fenêtre pop-up ».
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('[role="menuitem"]')) {
        if (POPOUT_RE.test(GL.norm(el.textContent) + ' ' + labelOf(el))) return el;
      }
    }
    return c.host.querySelector('.M9 > [role=menu]:first-child > .SK > [role=menuitem]:last-child');
  }

  function popupRoot(el) {
    let root = el;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.matches && p.matches(POPUP)) root = p;
    }
    return root;
  }

  /** Fenêtres de rédaction affichées (Gmail peut réutiliser une fenêtre fermée). */
  function visiblePopups() {
    const roots = new Set();
    for (const p of document.querySelectorAll(POPUP)) {
      if (p.querySelector(GL.EDITOR) && GL.isVisible(p)) roots.add(popupRoot(p));
    }
    return [...roots];
  }

  /** Croix de la barre de titre (« Enregistrer et fermer »), jamais la corbeille. */
  function findCloseButton(root) {
    const img = root.querySelector('.Hm .Ha');
    if (img) return img.closest('[role="button"]') || img;
    for (const el of root.querySelectorAll('.Hm [role="button"], .Hm button, .Hm img, [role="button"], button')) {
      if (CLOSE_LABELS.includes(labelOf(el))) return el;
    }
    return null;
  }

  /** Vrai si vous avez écrit quelque chose (en dehors de la signature) ou joint un fichier. */
  function hasUserContent(root) {
    const editor = root.querySelector(GL.EDITOR);
    if (!editor) return true; // dans le doute, on considère qu'il y a du contenu
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.gmail_signature, [data-smartmail="gmail_signature"], .gmail_quote, .gmail_extra').forEach((n) => n.remove());
    if (clone.textContent.replace(/[\s​﻿]/g, '')) return true;
    if (clone.querySelector('img, table')) return true;
    return !!root.querySelector('.dL, .vI, [download_url], a[href*="attid"]'); // pièces jointes
  }

  function draftItems(list) {
    return [...list.querySelectorAll('.kv, .ky, [role="listitem"]')].filter(
      (m) => GL.isVisible(m) && !m.querySelector(GL.EDITOR) && GL.isDraftMessage(m),
    );
  }

  function viewBottom(sc) {
    const docScroller = sc === document.scrollingElement || sc === document.documentElement;
    return docScroller ? innerHeight : Math.min(innerHeight, sc.getBoundingClientRect().bottom);
  }

  function viewTop(sc) {
    const docScroller = sc === document.scrollingElement || sc === document.documentElement;
    return docScroller ? 0 : Math.max(0, sc.getBoundingClientRect().top);
  }

  /** Conversation inversée : la réponse est en haut, tout se fait dans l'autre sens. */
  function reversed(list) {
    return !!(GL.settings.reverseThread && GL.isReversed && GL.isReversed(list || GL.visibleThreadList()));
  }

  /** Vrai quand on est au bout de la conversation, du côté de la réponse. */
  function atReplyEnd(sc, rev) {
    return rev ? sc.scrollTop <= 4 : GL.atBottom(sc);
  }

  /**
   * Vrai quand l'endroit où la réponse va revenir est visible à l'écran :
   * son ancien emplacement dans la conversation (ou, à défaut, la fin du dernier message).
   */
  function spotVisible(p, list, sc) {
    const rev = reversed(list);
    const limit = rev ? viewTop(sc) + DOCK_MARGIN : viewBottom(sc) - DOCK_MARGIN;
    const seen = (r, edge) => (rev ? r[edge] >= limit : r[edge] <= limit);
    let el = p.anchor;
    for (let i = 0; el && el.isConnected && i < 4; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) return seen(r, rev ? 'bottom' : 'top');
    }
    const items = list.querySelectorAll('[role="listitem"]');
    const last = items[items.length - 1];
    return !!last && seen(last.getBoundingClientRect(), rev ? 'top' : 'bottom');
  }

  function visibleRatio(host, sc) {
    const h = host.getBoundingClientRect();
    const docScroller = sc === document.scrollingElement || sc === document.documentElement;
    const r = docScroller ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const top = Math.max(0, r.top);
    const bottom = Math.min(innerHeight, r.bottom);
    const visible = Math.max(0, Math.min(h.bottom, bottom) - Math.max(h.top, top));
    return visible / Math.max(1, Math.min(h.height, bottom - top));
  }

  // ---------- Actions ----------

  async function popOut(c) {
    busy = true;
    try {
      const btn = findPopoutButton(c);
      if (!btn) {
        problem('bouton « fenêtre pop-up » introuvable');
        cooldownUntil = Date.now() + 4000;
        return;
      }
      const before = new Set(visiblePopups());
      GL.click(btn);
      const popup = await GL.waitFor(() => visiblePopups().find((p) => !before.has(p)), 3000);
      if (popup) {
        popped = { root: popup, threadKey: c.threadKey, at: Date.now(), replyButton: lastReplyButton, anchor: c.host };
        lastProblem = '';
        GL.trace(NAME, 'réponse passée en fenêtre pop-up');
      } else {
        problem("clic sur « fenêtre pop-up » sans effet");
      }
    } finally {
      inline = null;
      busy = false;
      cooldownUntil = Math.max(cooldownUntil, Date.now() + 1200);
    }
  }

  async function dockBack(p) {
    busy = true;
    popped = null;
    try {
      const close = findCloseButton(p.root);
      if (!close) {
        problem('bouton « fermer » de la fenêtre introuvable');
        return;
      }
      const content = hasUserContent(p.root);
      GL.click(close); // croix de Gmail : enregistre le brouillon et ferme la fenêtre
      await GL.waitFor(() => !p.root.isConnected || !GL.isVisible(p.root), 3000);

      // Souvent Gmail remet lui-même la réponse dans la conversation ; sinon le
      // brouillon apparaît replié (« Brouillon ») et on le rouvre à sa place.
      const result = await GL.waitFor(() => {
        if (findInlineReply()) return { back: true };
        const list = GL.visibleThreadList();
        const items = list ? draftItems(list) : [];
        return items.length ? { draft: items[items.length - 1] } : null;
      }, content ? 8000 : 1500, 100);
      const draft = result && result.draft;

      if (result && result.back) {
        // rien à faire : Gmail l'a déjà remise en place
      } else if (draft) {
        GL.click(draft.querySelector('.adf.ads, .adf') || draft);
      } else if (!content) {
        // Réponse vide (Gmail l'a supprimée) : on rouvre une réponse vide.
        const btn = findReplyButton(p.replyButton);
        if (btn) GL.click(btn);
      } else {
        problem('brouillon enregistré, mais introuvable dans la conversation');
        return;
      }

      const back = await GL.waitFor(() => findInlineReply(), 4000);
      if (!back) {
        problem('réponse rouverte introuvable dans la conversation');
      } else {
        GL.trace(NAME, 'réponse remise dans la conversation');
        back.host.scrollIntoView({ block: 'nearest' }); // juste ce qu'il faut pour la voir
      }
    } finally {
      busy = false;
      cooldownUntil = Date.now() + 800;
    }
  }

  // ---------- Boutons « Répondre » du bas de la conversation ----------

  function replyButtonKey(btn) {
    for (const c of ['bkH', 'bkG', 'bkI']) if (btn.classList.contains(c)) return { cls: c };
    return { label: GL.norm(btn.getAttribute('aria-label') || btn.textContent) };
  }

  function findReplyButton(key) {
    const buttons = [...document.querySelectorAll('.amn [role="button"], .amn button')].filter((b) => GL.isVisible(b));
    if (key && key.cls) {
      const b = buttons.find((x) => x.classList.contains(key.cls));
      if (b) return b;
    }
    if (key && key.label) {
      const b = buttons.find((x) => GL.norm(x.getAttribute('aria-label') || x.textContent) === key.label);
      if (b) return b;
    }
    return buttons[0] || null;
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !e.target || !e.target.closest) return;
      const btn = e.target.closest('.amn [role="button"], .amn button');
      if (btn) lastReplyButton = replyButtonKey(btn);
    },
    true,
  );

  // ---------- Boucle principale ----------

  function evaluate() {
    const s = GL.settings;
    if (!s.floatingReply || busy) {
      if (!s.floatingReply) popped = null;
      return;
    }
    const now = Date.now();

    // 1. Fenêtre pop-up ouverte par l'extension : faut-il la remettre en place ?
    if (popped) {
      if (!popped.root.isConnected || !GL.isVisible(popped.root)) {
        popped = null; // envoyée, fermée ou supprimée par vous
      } else {
        const list = GL.visibleThreadList();
        const rev = reversed(list);
        if (s.dockReplyAtBottom && now > cooldownUntil && now - popped.at > 1200 && direction === (rev ? -1 : 1)) {
          const sc = list && GL.findScroller(list);
          if (list && sc && GL.threadKey(list) === popped.threadKey && (spotVisible(popped, list, sc) || atReplyEnd(sc, rev))) {
            dockBack(popped);
          }
        }
        return;
      }
    }

    // 2. Réponse ouverte dans la conversation : faut-il la passer en pop-up ?
    const found = findInlineReply();
    if (!found) {
      inline = null;
      return;
    }
    const sc = threadScroller(found.host);
    const rev = reversed();
    // « Avancée » vers la réponse : vers le bas normalement, vers le haut si la conversation est inversée.
    const pos = rev ? -sc.scrollTop : sc.scrollTop;
    if (!inline || inline.card !== found.card || inline.host !== found.host) {
      const list = GL.visibleThreadList();
      inline = { host: found.host, card: found.card, threadKey: list ? GL.threadKey(list) : location.hash };
      userScrolled = false; // on attend que vous fassiez défiler la conversation
      lowest = pos;
    }
    lowest = Math.max(lowest, pos);
    if (!userScrolled || (rev ? direction <= 0 : direction >= 0) || now < cooldownUntil) return;
    if (pos > lowest - CLIMB) return; // petit coup de molette en s'éloignant : on ne bouge pas
    if (visibleRatio(found.host, sc) < POP_BELOW && !(isScrollable(sc) && atReplyEnd(sc, rev))) popOut(inline);
  }

  function onScroll(e) {
    const t = e.target;
    const sc = t && t.nodeType === 9 ? document.scrollingElement : t;
    if (!sc || sc.nodeType !== 1) return;
    if (sc.closest && sc.closest(POPUP + ', .glx-own')) return;
    const top = sc.scrollTop;
    const prev = lastTop.get(sc);
    lastTop.set(sc, top);
    if (prev === undefined || prev === top) return;
    direction = top > prev ? 1 : -1;
    userScrolled = true;
    try {
      evaluate();
    } catch (err) {
      console.warn('[Gmail Lisible] réponse pop-up :', err);
    }
  }

  window.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // État courant, repris dans le diagnostic.
  GL.replyState = () => {
    const found = findInlineReply();
    const sc = found ? threadScroller(found.host) : null;
    return {
      found,
      popoutButton: found ? findPopoutButton(found) : null,
      popped: popped && popped.root,
      scroller: sc,
      ratio: found && sc ? Math.round(visibleRatio(found.host, sc) * 100) / 100 : null,
      atBottom: sc ? GL.atBottom(sc) : null,
      busy,
      cooldown: Math.max(0, cooldownUntil - Date.now()),
    };
  };

  GL.register({ name: NAME, update: evaluate });
})();
