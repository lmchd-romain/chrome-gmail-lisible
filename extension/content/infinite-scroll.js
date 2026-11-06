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

  const OLDER = ['plus anciens', 'plus anciennes', 'older', 'altere', 'mas antiguos', 'meno recenti', 'mais antigos', 'ouder'];
  const NEWER = ['plus recents', 'plus recentes', 'newer', 'neuere', 'mas recientes', 'piu recenti', 'mais recentes', 'nieuwer'];
  const THRESHOLD = 360; // « force » de défilement à accumuler (≈ 3 crans de molette)
  const SETTLE_MS = 300; // il faut être arrivé au bord depuis ce délai
  const COOLDOWN_MS = 1500;

  let push = 0;
  let pushDir = 0;
  let lastWheel = 0;
  let edgeSince = 0;
  let edgeDir = 0;
  let cooldownUntil = 0;
  let hint = null;
  let hintTimer = 0;

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

  function pagerButton(words) {
    const toolbars = [...document.querySelectorAll('[gh="tm"]')].filter((t) => GL.isVisible(t));
    const scopes = toolbars.length ? toolbars : [document];
    for (const scope of scopes) {
      for (const b of scope.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip]')) {
        const label = GL.norm(b.getAttribute('aria-label') || b.getAttribute('data-tooltip'));
        if (!words.includes(label) || !GL.isVisible(b)) continue;
        const disabled = b.getAttribute('aria-disabled') === 'true' || b.classList.contains('T-I-JE');
        return disabled ? null : b;
      }
    }
    return null;
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

  async function turnPage(dir, button, scroller) {
    cooldownUntil = Date.now() + 8000;
    showHint(dir > 0 ? 'Chargement des e-mails plus anciens…' : 'Chargement des e-mails plus récents…', 1, scroller, dir < 0);
    const before = visibleRows();
    GL.click(button);
    // Gmail remplace la liste : on attend la nouvelle page.
    const changed = await GL.waitFor(() => visibleRows() !== before, 6000);
    hideHint();
    if (changed) {
      const tbody = visibleList();
      const sc = tbody ? GL.findScroller(tbody) : scroller;
      // En remontant, on arrive en bas de la page précédente (continuité).
      requestAnimationFrame(() => {
        sc.scrollTop = dir > 0 ? 0 : sc.scrollHeight;
      });
    }
    push = 0;
    edgeSince = 0;
    cooldownUntil = Date.now() + COOLDOWN_MS;
  }

  function onWheel(e) {
    if (!GL.settings.infiniteScroll || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const now = Date.now();
    if (now < cooldownUntil) return;
    const tbody = visibleList();
    if (!tbody) return;
    const scroller = GL.findScroller(tbody);
    const target = e.target;
    if (scroller !== document.scrollingElement && target && target.nodeType === 1 && !scroller.contains(target)) return;

    const dir = e.deltaY > 0 ? 1 : -1;
    const atEdge = dir > 0 ? GL.atBottom(scroller) : scroller.scrollTop <= 0;
    if (!atEdge) {
      push = 0;
      edgeSince = 0;
      return;
    }
    if (edgeDir !== dir || !edgeSince) {
      edgeDir = dir;
      edgeSince = now;
    }
    if (now - edgeSince < SETTLE_MS) return; // élan du défilement : on ne compte pas encore

    const button = pagerButton(dir > 0 ? OLDER : NEWER);
    if (!button) return; // première / dernière page

    if (pushDir !== dir || now - lastWheel > 1000) push = 0;
    pushDir = dir;
    lastWheel = now;
    push += Math.min(Math.abs(e.deltaY), 120);

    if (push >= THRESHOLD) {
      turnPage(dir, button, scroller);
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
