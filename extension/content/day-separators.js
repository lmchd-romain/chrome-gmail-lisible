/*
 * Séparateurs de dates dans les listes d'e-mails (boîte de réception, libellés,
 * recherches…) : « Aujourd'hui », « Hier », « 04/11 »… ou, en mode regroupé,
 * « Cette semaine », « Semaine dernière », « Octobre »…
 *
 * La date de chaque ligne vient de l'info-bulle de la colonne date de Gmail.
 * Les séparateurs sont des éléments à part, insérés entre les lignes ; les
 * lignes de Gmail ne sont jamais modifiées.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  const D = globalThis.GLDates;
  if (!GL || GL.disabled || !D) return;

  const SEP = 'glx-day-sep';
  const DATE_SELECTORS = [
    'td.xW > span[title]',
    'td.yf.apt > div.apm > span[title]',
    'td.xW [title]',
    '.apm [title]',
  ];

  const cache = new Map(); // texte de date -> Date (évite de relire les mêmes dates)

  function cachedParse(text, lang, now, short) {
    if (!text) return null;
    const key = (short ? 's|' : 'l|') + lang + '|' + now.toDateString() + '|' + text;
    if (cache.has(key)) return cache.get(key);
    const d = short ? D.parseShort(text, lang, now) : D.parse(text, lang, now);
    if (cache.size > 1000) cache.clear();
    cache.set(key, d);
    return d;
  }

  function rowDate(row, lang, now) {
    for (const sel of DATE_SELECTORS) {
      const el = row.querySelector(sel);
      if (!el) continue;
      const d = cachedParse(el.getAttribute('title') || el.getAttribute('aria-label'), lang, now, false);
      if (d) return d;
    }
    const cell = row.querySelector('td.xW, .apm');
    return cell ? cachedParse(cell.textContent.trim(), lang, now, true) : null;
  }

  function columnCount(row) {
    let cells = 0;
    for (const c of row.cells || []) cells += c.colSpan || 1;
    const table = row.closest('table');
    const cols = table ? table.querySelectorAll(':scope > colgroup > col').length : 0;
    return Math.max(cells, cols, 1);
  }

  function stop(e) {
    e.stopPropagation();
  }

  function makeSeparator(group, columns) {
    const sep = document.createElement('div');
    sep.className = SEP + ' glx-own inboxsdk__ignore_row';
    sep.setAttribute('aria-hidden', 'true');
    sep.dataset.key = group.key;
    const cell = document.createElement('td');
    cell.className = 'glx-day-sep-cell';
    cell.colSpan = columns;
    const label = document.createElement('span');
    label.className = 'glx-day-sep-label';
    label.textContent = group.label;
    cell.appendChild(label);
    sep.appendChild(cell);
    for (const type of ['click', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) {
      sep.addEventListener(type, stop);
    }
    return sep;
  }

  function isSep(el) {
    return !!el && el.nodeType === 1 && el.classList.contains(SEP);
  }

  function syncBody(tbody, mode, lang, now) {
    // Lignes de Gmail qui portent une date (les autres sont ignorées).
    const rows = [];
    const dates = [];
    for (const el of tbody.children) {
      if (el.tagName !== 'TR' || !el.classList.contains('zA')) continue;
      const d = rowDate(el, lang, now);
      if (!d) continue;
      rows.push(el);
      dates.push(d);
    }

    // Date « effective » : jamais plus ancienne qu'une ligne située en dessous
    // (un e-mail remis en avant, ex. « en attente », reste dans le groupe du dessous).
    const groups = new Array(rows.length);
    let floor = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!floor || dates[i] > floor) floor = dates[i];
      groups[i] = D.group(floor, now, mode);
    }

    const wanted = new Map();
    rows.forEach((row, i) => {
      if (i === 0 || groups[i - 1].key !== groups[i].key) wanted.set(row, groups[i]);
    });

    // Retire les séparateurs devenus faux (ligne supprimée, déplacée, doublon…).
    for (const sep of tbody.querySelectorAll(':scope > .' + SEP)) {
      const g = wanted.get(sep.nextElementSibling);
      if (!g || g.key !== sep.dataset.key) sep.remove();
    }

    for (const [row, g] of wanted) {
      const prev = row.previousElementSibling;
      if (isSep(prev) && prev.dataset.key === g.key) {
        const label = prev.querySelector('.glx-day-sep-label');
        if (label && label.textContent !== g.label) label.textContent = g.label;
        continue;
      }
      tbody.insertBefore(makeSeparator(g, columnCount(row)), row);
    }
  }

  function removeAll() {
    for (const sep of document.querySelectorAll('.' + SEP)) sep.remove();
  }

  function update(settings) {
    if (!settings.daySeparators) {
      removeAll();
      return;
    }
    const lang = GL.lang();
    const now = new Date();
    const bodies = new Set();
    for (const row of document.querySelectorAll('tr.zA')) {
      if (row.parentElement) bodies.add(row.parentElement);
    }
    for (const sep of document.querySelectorAll('.' + SEP)) {
      if (sep.parentElement) bodies.add(sep.parentElement);
    }
    for (const tbody of bodies) syncBody(tbody, settings.daySeparatorMode, lang, now);
  }

  GL.register({ name: 'séparateurs de dates', update });
})();
