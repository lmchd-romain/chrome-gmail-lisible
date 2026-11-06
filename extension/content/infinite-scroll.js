/*
 * Défilement continu dans les listes d'e-mails.
 *
 * Gmail affiche les e-mails par pages (50 par défaut, 100 au maximum) et ne sait
 * pas en ajouter à une liste déjà affichée. Ici : arrivé en bas de la liste,
 * continuez à faire défiler et la page suivante s'affiche toute seule (clic sur
 * « Plus anciens » de Gmail). Tout en haut, continuez vers le haut pour revenir
 * à la page précédente. Une petite bulle indique ce qui va se passer.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const OLDER = ['plus anciens', 'plus anciennes', 'page suivante', 'older', 'next page', 'altere', 'mas antiguos', 'meno recenti', 'mais antigos', 'ouder'];
  const NEWER = ['plus recents', 'plus recentes', 'page precedente', 'newer', 'previous page', 'neuere', 'mas recientes', 'piu recenti', 'mais recentes', 'nieuwer'];
  const THRESHOLD = 240; // « force » de défilement à accumuler (≈ 2 crans de molette)
  const SETTLE_MS = 250; // il faut être arrivé au bord depuis ce délai
  const COOLDOWN_MS = 1500;
  const COUNTER_RE = /(\d[\d\s\u00a0\u202f.,]*)\s*[–—-]\s*(\d[\d\s\u00a0\u202f.,]*)\s+(?:sur|of|de|von|di|van)\s+(?:environ\s+|about\s+|ca\.?\s+|circa\s+)?(\d[\d\s\u00a0\u202f.,]*|plusieurs|many|viele|muchos|molti|varios|v[aá]rios|veel)/i;

  let push = 0;
  let pushDir = 0;
  let lastWheel = 0;
  let edgeSince = 0;
  let edgeDir = 0;
  let cooldownUntil = 0;
  let hint = null;
  let hintTimer = 0;
  let lastScrolled = null; // dernier élément que la page a réellement fait défiler

  // Compte rendu du dernier essai (lu par « Copier un diagnostic »).
  const trace = { reason: 'aucun défilement à la molette pour l’instant', at: 0, count: 0 };
  GL.scrollTrace = trace;
  function note(reason, sc) {
    trace.reason = reason;
    trace.at = Date.now();
    trace.count++;
    if (sc) trace.metrics = { top: Math.round(sc.scrollTop), height: sc.scrollHeight, view: sc.clientHeight, html: sc === document.scrollingElement };
  }

  document.addEventListener(
    'scroll',
    (e) => {
      const t = e.target;
      lastScrolled = t && t.nodeType === 1 ? t : document.scrollingElement;
    },
    { capture: true, passive: true }
  );

  /** Élément qui fait défiler la liste : celui que l'on a vu défiler, sinon déduit des styles. */
  function listScroller(tbody) {
    const s = lastScrolled;
    if (s && s.isConnected && s.scrollHeight > s.clientHeight + 1 && (s === document.scrollingElement || s.contains(tbody))) return s;
    const found = GL.findScroller(tbody);
    if (found !== document.scrollingElement || found.scrollHeight > found.clientHeight + 1) return found;
    // Aucun style « overflow » reconnu : premier parent qui dépasse vraiment.
    for (let p = tbody.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight + 1 && getComputedStyle(p).overflowY !== 'visible') return p;
    }
    return found;
  }
  GL.listScroller = () => {
    const tbody = visibleList();
    return tbody ? listScroller(tbody) : null;
  };
  GL.listPager = (dir) => pager(dir);
  GL.listCounter = () => readCounter();

  // ---------- Liste affichée ----------

  function visibleList() {
    const seen = new Set();
    for (const row of document.querySelectorAll('tr.zA')) {
      const tbody = row.parentElement;
      if (!tbody || seen.has(tbody)) continue;
      seen.add(tbody);
      if (GL.isVisible(tbody)) return tbody;
    }
    return null;
  }

  /** Compteur de Gmail « 1–50 sur 1 234 » : { from, to, total }. */
  function readCounter() {
    const num = (v) => (/^\D+$/.test(v) ? Infinity : parseInt(v.replace(/\D/g, ''), 10));
    for (const el of document.querySelectorAll('[gh="tm"] span, [gh="tm"] [role="button"], .Dj, .amH')) {
      if (el.childElementCount > 4 || !GL.isVisible(el)) continue;
      const m = el.textContent.match(COUNTER_RE);
      if (m) return { from: num(m[1]), to: num(m[2]), total: num(m[3]) };
    }
    return null;
  }

  /** Adresse de la page voisine : #inbox -> #inbox/p2, #label/X/p3 -> #label/X/p2… */
  function pageHash(dir) {
    const m = (location.hash || '#inbox').match(/^(#[^?]*?)(?:\/p(\d+))?(\?.*)?$/);
    if (!m || m[1] === '#') return null;
    const page = (m[2] ? parseInt(m[2], 10) : 1) + dir;
    if (page < 1) return null;
    return (page === 1 ? m[1] : m[1] + '/p' + page) + (m[3] || '');
  }

  /** Comment aller à la page suivante / précédente (bouton de Gmail, sinon adresse). */
  function pager(dir) {
    const words = dir > 0 ? OLDER : NEWER;
    const all = [...document.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip], button[aria-label]')];
    // Les boutons de la barre de la liste d'abord ; jamais ceux d'une conversation ouverte.
    all.sort((a, b) => (b.closest('[gh="tm"]') ? 1 : 0) - (a.closest('[gh="tm"]') ? 1 : 0));
    for (const b of all) {
      const label = GL.norm(b.getAttribute('aria-label') || b.getAttribute('data-tooltip'));
      if (!words.includes(label) || !GL.isVisible(b) || b.closest('.a98.iY, .if, .PeIF1d, .glx-own')) continue;
      if (b.getAttribute('aria-disabled') === 'true' || b.classList.contains('T-I-JE')) return null; // première / dernière page
      return { button: b, hash: pageHash(dir) };
    }
    const c = readCounter();
    if (!c) return null;
    if (dir > 0 && !(c.to < c.total)) return null;
    if (dir < 0 && !(c.from > 1)) return null;
    const hash = pageHash(dir);
    return hash ? { hash } : null;
  }

  // ---------- Bulle d'information ----------

  function showHint(text, progress, scroller, atTop) {
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'glx-own glx-page-hint';
      hint.setAttribute('role', 'status');
      hint.appendChild(document.createElement('span'));
      const bar = document.createElement('i');
      hint.appendChild(bar);
      document.body.appendChild(hint);
    }
    const r = scroller === document.scrollingElement ? { left: 0, width: innerWidth, top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
    hint.firstChild.textContent = text;
    hint.lastChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, progress)) + ')';
    hint.style.left = Math.round(r.left + r.width / 2) + 'px';
    hint.style.top = atTop ? Math.round(Math.max(r.top, 0) + 12) + 'px' : '';
    hint.style.bottom = atTop ? '' : Math.round(Math.max(0, innerHeight - r.bottom) + 16) + 'px';
    hint.classList.add('is-visible');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 900);
  }

  function hideHint() {
    if (hint) hint.classList.remove('is-visible');
  }

  // ---------- Changement de page ----------

  /** Empreinte des lignes affichées (change quand Gmail affiche une autre page). */
  function visibleRows() {
    const ids = [];
    for (const row of document.querySelectorAll('tr.zA')) {
      if (row.parentElement && GL.isVisible(row.parentElement)) ids.push(row.id || row.textContent.length);
    }
    return ids.join(',');
  }

  async function turnPage(dir, how, scroller) {
    cooldownUntil = Date.now() + 9000;
    showHint(dir > 0 ? 'Chargement des e-mails plus anciens…' : 'Chargement des e-mails plus récents…', 1, scroller, dir < 0);
    const before = visibleRows();
    let changed = null;
    if (how.button) {
      GL.click(how.button);
      changed = await GL.waitFor(() => visibleRows() !== before, how.hash ? 2500 : 6000);
    }
    if (!changed && how.hash) {
      // Le bouton n'a rien fait (ou est introuvable) : on passe par l'adresse de la page.
      location.hash = how.hash;
      changed = await GL.waitFor(() => visibleRows() !== before, 6000);
    }
    hideHint();
    if (changed) {
      const tbody = visibleList();
      const sc = tbody ? listScroller(tbody) : scroller;
      // En remontant, on arrive en bas de la page précédente (continuité).
      requestAnimationFrame(() => {
        sc.scrollTop = dir > 0 ? 0 : sc.scrollHeight;
      });
      note('page changée (' + (dir > 0 ? 'plus anciens' : 'plus récents') + ')');
    } else {
      note('Gmail n’a pas changé de page (bouton : ' + (how.button ? 'oui' : 'non') + ', adresse : ' + (how.hash ? 'oui' : 'non') + ')');
    }
    push = 0;
    edgeSince = 0;
    cooldownUntil = Date.now() + COOLDOWN_MS;
  }

  function onWheel(e) {
    if (!GL.settings.infiniteScroll) return note('réglage désactivé');
    if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const now = Date.now();
    if (now < cooldownUntil) return;
    const tbody = visibleList();
    if (!tbody) return note('aucune liste d’e-mails affichée');
    const scroller = listScroller(tbody);
    const target = e.target;
    if (scroller !== document.scrollingElement && target && target.nodeType === 1 && !scroller.contains(target)) return note('souris hors de la liste', scroller);

    const dir = e.deltaY > 0 ? 1 : -1;
    const atEdge = dir > 0 ? GL.atBottom(scroller) : scroller.scrollTop <= 0;
    if (!atEdge) {
      push = 0;
      edgeSince = 0;
      return note('pas encore au ' + (dir > 0 ? 'bas' : 'haut') + ' de la liste', scroller);
    }
    if (edgeDir !== dir || !edgeSince) {
      edgeDir = dir;
      edgeSince = now;
    }
    if (now - edgeSince < SETTLE_MS) return note('au bord, élan ignoré', scroller); // élan du défilement : on ne compte pas encore

    const how = pager(dir);
    if (!how) return note('pas de page ' + (dir > 0 ? 'suivante' : 'précédente') + ' trouvée', scroller); // première / dernière page

    if (pushDir !== dir || now - lastWheel > 1000) push = 0;
    pushDir = dir;
    lastWheel = now;
    push += Math.min(Math.abs(e.deltaY), 120);

    note('au bord : ' + Math.round(push) + '/' + THRESHOLD, scroller);
    if (push >= THRESHOLD) {
      turnPage(dir, how, scroller);
    } else {
      showHint(dir > 0 ? 'Continuez pour les e-mails plus anciens' : 'Continuez pour les e-mails plus récents', push / THRESHOLD, scroller, dir < 0);
    }
  }

  window.addEventListener('wheel', onWheel, { capture: true, passive: true });

  GL.register({
    name: 'défilement continu',
    update(s) {
      if (!s.infiniteScroll) hideHint();
    },
  });
})();
