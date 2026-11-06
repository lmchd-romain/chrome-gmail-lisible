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
 * On n'agit que sur une fenêtre ouverte par l'extension.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const POP_BELOW = 0.35; // part visible de la réponse sous laquelle elle passe en pop-up
  const POPUP = '.AD, [role="dialog"]';
  const POPOUT_RE = /\bpop ?up\b|\bpop ?out\b|\bpopup\b/;
  const CLOSE_LABELS = ['enregistrer et fermer', 'fermer', 'save & close', 'save and close', 'close', 'speichern und schliessen', 'guardar y cerrar', 'salva e chiudi'];

  let inline = null; // réponse ouverte dans la conversation : { host, card, scroller, threadKey }
  let popped = null; // fenêtre pop-up ouverte par l'extension : { root, threadKey, scroller, at, replyButton }
  let userScrolled = false;
  let direction = 0; // 1 = vers le bas, -1 = vers le haut
  const lastTop = new WeakMap();
  let busy = false;
  let cooldownUntil = 0;
  let lastReplyButton = null; // dernier bouton « Répondre / Répondre à tous / Transférer » cliqué

  // ---------- Repérage ----------

  function findInlineReply() {
    for (const host of document.querySelectorAll('.ip.adB')) {
      const card = host.querySelector('.M9') || host.firstElementChild;
      if (card && card.querySelector(GL.EDITOR) && GL.isVisible(host)) return { host, card };
    }
    for (const editor of document.querySelectorAll(GL.EDITOR)) {
      if (editor.closest(POPUP + ', .glx-own')) continue;
      const card = editor.closest('.M9');
      if (!card || !card.closest('[role="main"], .AO')) continue;
      const host = card.closest('.ip') || card.parentElement;
      if (host && GL.isVisible(host)) return { host, card };
    }
    return null;
  }

  function labelOf(el) {
    return GL.norm(el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '');
  }

  function findPopoutButton(c) {
    const scope = c.host;
    for (const el of scope.querySelectorAll('[role="button"], button, [data-tooltip]')) {
      if (POPOUT_RE.test(labelOf(el))) return el;
    }
    // Menu « type de réponse » : son dernier choix est « Ouvrir dans une fenêtre pop-up ».
    for (const el of scope.querySelectorAll('[role="menuitem"]')) {
      if (POPOUT_RE.test(GL.norm(el.textContent) + ' ' + labelOf(el))) return el;
    }
    return scope.querySelector('.M9 > [role=menu]:first-child > .SK > [role=menuitem]:last-child');
  }

  function popupRoot(el) {
    let root = el;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.matches && p.matches(POPUP)) root = p;
    }
    return root;
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

  function visibleRatio(c) {
    const h = c.host.getBoundingClientRect();
    const sc = c.scroller;
    const docScroller = sc === document.scrollingElement || sc === document.documentElement;
    const r = docScroller ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const top = Math.max(0, r.top);
    const bottom = Math.min(innerHeight, r.bottom);
    const visible = Math.max(0, Math.min(h.bottom, bottom) - Math.max(h.top, top));
    return visible / Math.max(1, Math.min(h.height, bottom - top));
  }

  // ---------- Actions ----------

  async function popOut(c) {
    const btn = findPopoutButton(c);
    if (!btn) {
      GL.log('bouton « fenêtre pop-up » introuvable');
      cooldownUntil = Date.now() + 5000;
      return;
    }
    busy = true;
    const before = new Set(document.querySelectorAll(POPUP));
    GL.click(btn);
    const popup = await GL.waitFor(
      () => [...document.querySelectorAll(POPUP)].find((p) => !before.has(p) && p.querySelector(GL.EDITOR)),
      3000,
    );
    if (popup) {
      popped = {
        root: popupRoot(popup),
        threadKey: c.threadKey,
        scroller: c.scroller,
        at: Date.now(),
        replyButton: lastReplyButton,
      };
    } else {
      GL.log("la fenêtre pop-up n'est pas apparue");
    }
    inline = null;
    busy = false;
    cooldownUntil = Date.now() + 1200;
  }

  async function dockBack(p) {
    const close = findCloseButton(p.root);
    if (!close) {
      GL.log('bouton « fermer » de la fenêtre introuvable');
      popped = null;
      return;
    }
    busy = true;
    popped = null;
    const content = hasUserContent(p.root);
    GL.click(close); // croix de Gmail : enregistre le brouillon et ferme la fenêtre
    await GL.waitFor(() => !p.root.isConnected || !GL.isVisible(p.root), 3000);

    // Le brouillon réapparaît dans la conversation : on le rouvre à sa place.
    const draft = await GL.waitFor(() => {
      const list = GL.visibleThreadList();
      const items = list ? draftItems(list) : [];
      return items[items.length - 1] || null;
    }, content ? 8000 : 1500, 150);

    if (draft) {
      GL.click(draft.querySelector('.adf.ads, .adf') || draft);
    } else if (!content) {
      // Réponse vide (Gmail l'a supprimée) : on rouvre une réponse vide.
      const btn = findReplyButton(p.replyButton);
      if (btn) GL.click(btn);
    } else {
      GL.log('brouillon enregistré, mais introuvable dans la conversation');
    }

    if (draft || !content) {
      await GL.waitFor(() => findInlineReply(), 3000);
      const sc = p.scroller && p.scroller.isConnected ? p.scroller : null;
      if (sc) sc.scrollTop = sc.scrollHeight;
    }
    busy = false;
    cooldownUntil = Date.now() + 1500;
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
      if (!popped.root.isConnected) {
        popped = null; // envoyée, fermée ou supprimée par vous
      } else if (s.dockReplyAtBottom && now > cooldownUntil && now - popped.at > 1200 && direction > 0) {
        const list = GL.visibleThreadList();
        const sc = popped.scroller;
        if (list && GL.threadKey(list) === popped.threadKey && sc && sc.isConnected && GL.atBottom(sc)) {
          dockBack(popped);
        }
      }
      return;
    }

    // 2. Réponse ouverte dans la conversation : faut-il la passer en pop-up ?
    const found = findInlineReply();
    if (!found) {
      inline = null;
      return;
    }
    if (!inline || inline.card !== found.card) {
      const list = GL.visibleThreadList();
      inline = {
        host: found.host,
        card: found.card,
        scroller: GL.findScroller(found.host),
        threadKey: list ? GL.threadKey(list) : location.hash,
      };
      userScrolled = false; // on attend que vous fassiez défiler la conversation
    }
    if (!userScrolled || direction >= 0 || now < cooldownUntil) return;
    if (visibleRatio(inline) < POP_BELOW && !GL.atBottom(inline.scroller)) popOut(inline);
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

  GL.register({ name: 'réponse pop-up', update: evaluate });
})();
