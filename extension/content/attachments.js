/*
 * Pièces jointes.
 *
 *  - « Au-dessus du message » : la liste des pièces jointes s'affiche avant le texte.
 *  - « Compactes » : une ligne par fichier (icône, nom, taille, Télécharger, Drive),
 *    sans les grandes vignettes d'aperçu.
 *  - « Regroupées » : en haut des longues conversations, toutes les pièces jointes
 *    de tous les messages, avec un lien vers le message d'origine.
 *
 * Les cartes de Gmail restent dans la page (masquées) : nos boutons cliquent
 * sur les vrais boutons de Gmail (aperçu, téléchargement, Drive).
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  const D = globalThis.GLDates;
  if (!GL || GL.disabled) return;

  const CARD = 'span.aZo, .aQH > span';
  const DL_RE = /telecharger|download|herunterladen|descargar|scarica|baixar|downloaden/;
  const DRIVE_RE = /drive/;
  const DL_ALL_RE = /^(tout telecharger|download all|alle herunterladen|descargar todo|scarica tutti|baixar todos)/;
  const SUMMARY_MIN_MESSAGES = 3;
  const SUMMARY_MIN_FILES = 2;
  const SUMMARY_VISIBLE = 6;

  let summaryOpen = true; // replié / déplié (pour la session)
  let summaryShowAll = false;

  // ---------- Petits outils d'interface ----------

  const ICONS = {
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
    download: 'M12 16l-5-5 1.41-1.41L11 12.17V4h2v8.17l2.59-2.58L17 11l-5 5zm-7 2h14v2H5v-2z',
    drive: 'M7.71 3.5 1.15 15l3.43 5.98h13.71L21.71 15 15.29 3.5H7.71zm1.04 2h5.5l5.14 9h-5.5l-5.14-9zM7.74 6.48l2.73 4.75-4.13 7.2L3.47 15l4.27-8.52zm3.89 6.77 1.4 2.45h6.5l-2.43 4.3H5.95l5.68-6.75z',
    clip: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z',
    chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
    goto: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  };

  function svg(path) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function iconButton(label, path, onClick) {
    const b = el('button', 'glx-att-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(svg(path));
    b.addEventListener('click', onClick);
    return b;
  }

  // Nos clics ne doivent pas atteindre Gmail (qui replierait le message, par ex.).
  function isolate(root) {
    for (const type of ['click', 'mousedown', 'mouseup', 'dblclick']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  // ---------- Lecture des cartes de Gmail ----------

  function cardsIn(area) {
    return [...new Set(area.querySelectorAll(CARD))].filter((c) => !c.closest('.glx-own'));
  }

  function cardInfo(card) {
    const du = card.getAttribute('download_url') || '';
    const m = du.match(/^([^:]*):(.*?):(https?:\/\/.*)$/);
    const nameEl = card.querySelector('.aV3');
    const sizeEl = card.querySelector('.aYp span, .aYp');
    const icon = card.querySelector('img.aSM, img.aZG');
    const thumb = card.querySelector('img.aQG');
    const link = card.querySelector('a.aQy') || card.querySelector('a[href]');
    return {
      card,
      name: (nameEl && nameEl.textContent.trim()) || (m && m[2]) || 'Pièce jointe',
      size: sizeEl ? sizeEl.textContent.trim() : '',
      url: m ? m[3] : link ? link.href : '',
      icon: icon ? icon.src : '',
      thumb: thumb ? thumb.src : '',
    };
  }

  function nativeButton(card, re) {
    for (const b of card.querySelectorAll('[role="button"], button, [data-tooltip]')) {
      if (b === card || b.matches('a.aQy')) continue;
      const label = GL.norm(b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '');
      if (label && re.test(label)) return b;
    }
    return null;
  }

  function hover(target) {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
  }

  /** Clique sur un bouton de la carte Gmail (affiché par Gmail au survol). */
  async function nativeAction(card, re) {
    if (!card.isConnected) return false;
    let b = nativeButton(card, re);
    if (!b) {
      hover(card);
      b = await GL.waitFor(() => nativeButton(card, re), 700, 50);
    }
    if (!b) return false;
    GL.click(b);
    return true;
  }

  function preview(info) {
    const target = info.card.querySelector('a.aQy') || info.card.querySelector('a[href]') || info.card;
    if (info.card.isConnected) GL.click(target);
  }

  async function download(info) {
    if (await nativeAction(info.card, DL_RE)) return;
    if (!info.url) return;
    const a = el('a', 'glx-own');
    a.href = info.url.replace(/([?&])disp=inline(?=&|$)/, '$1disp=safe');
    a.download = info.name;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function addToDrive(info) {
    nativeAction(info.card, DRIVE_RE).then((ok) => {
      if (!ok) GL.log('bouton Drive de Gmail introuvable pour', info.name);
    });
  }

  // ---------- Une pièce jointe (ligne ou petite carte) ----------

  function item(info, opts) {
    const row = el('div', 'glx-att-item');
    if (opts.thumbs && info.thumb) {
      const t = el('button', 'glx-att-thumb');
      t.type = 'button';
      t.title = 'Aperçu';
      const img = el('img');
      img.src = info.thumb;
      img.alt = '';
      t.appendChild(img);
      t.addEventListener('click', () => preview(info));
      row.appendChild(t);
      row.classList.add('has-thumb');
    }
    const line = el('div', 'glx-att-line');
    const name = el('button', 'glx-att-name');
    name.type = 'button';
    name.title = 'Aperçu de ' + info.name;
    if (info.icon) {
      const ic = el('img', 'glx-att-icon');
      ic.src = info.icon;
      ic.alt = '';
      name.appendChild(ic);
    } else {
      const ic = svg(ICONS.file);
      ic.classList.add('glx-att-icon');
      name.appendChild(ic);
    }
    name.appendChild(el('span', 'glx-att-label', info.name));
    name.addEventListener('click', () => preview(info));
    line.appendChild(name);
    if (info.size) line.appendChild(el('span', 'glx-att-size', info.size));
    if (opts.meta) line.appendChild(el('span', 'glx-att-meta', opts.meta));
    const actions = el('span', 'glx-att-actions');
    actions.appendChild(iconButton('Télécharger', ICONS.download, () => download(info)));
    actions.appendChild(iconButton('Ajouter à Drive', ICONS.drive, () => addToDrive(info)));
    if (opts.goto) actions.appendChild(iconButton('Voir le message', ICONS.goto, opts.goto));
    line.appendChild(actions);
    row.appendChild(line);
    return row;
  }

  // ---------- Barre de pièces jointes d'un message ----------

  function messageOf(area) {
    return area.closest('.adn') || area.closest(GL.MESSAGE) || area.parentElement;
  }

  function updateMessageBar(area, s) {
    const msg = messageOf(area);
    const body = msg && msg.querySelector('div.ii.gt');
    const active = (s.attachmentsOnTop || s.attachmentsCompact) && body;
    const old = msg ? msg.querySelectorAll('.glx-att-bar') : [];

    if (!active) {
      old.forEach((b) => b.remove());
      area.classList.remove('glx-att-native');
      return;
    }
    const cards = cardsIn(area);
    if (!cards.length) {
      old.forEach((b) => b.remove());
      area.classList.remove('glx-att-native');
      return;
    }

    const infos = cards.map(cardInfo);
    const compact = !!s.attachmentsCompact;
    const anchor = s.attachmentsOnTop ? body : area;
    const sig = [compact, s.attachmentsOnTop, ...infos.map((i) => i.name + '|' + i.size + '|' + (i.thumb ? 1 : 0))].join('§');
    const current = old[0];
    if (old.length === 1 && current.dataset.sig === sig && current.nextElementSibling === anchor) {
      area.classList.add('glx-att-native');
      return;
    }
    old.forEach((b) => b.remove());

    const bar = el('div', 'glx-own glx-att-bar ' + (compact ? 'glx-att-compact' : 'glx-att-cards'));
    bar.dataset.sig = sig;
    if (s.attachmentsOnTop) bar.classList.add('glx-att-top');
    if (infos.length > 1) {
      const head = el('div', 'glx-att-head');
      head.appendChild(el('span', 'glx-att-count', infos.length + ' pièces jointes'));
      const all = nativeButton(area, DL_ALL_RE);
      if (all) {
        const b = el('button', 'glx-att-all', 'Tout télécharger');
        b.type = 'button';
        b.addEventListener('click', () => {
          const btn = nativeButton(area, DL_ALL_RE);
          if (btn) GL.click(btn);
        });
        head.appendChild(b);
      }
      bar.appendChild(head);
    }
    const listEl = el('div', 'glx-att-list');
    for (const info of infos) listEl.appendChild(item(info, { thumbs: !compact }));
    bar.appendChild(listEl);
    isolate(bar);
    anchor.parentElement.insertBefore(bar, anchor);
    area.classList.add('glx-att-native');
  }

  // ---------- Toutes les pièces jointes de la conversation ----------

  function senderOf(msg) {
    const s = msg.querySelector('.gD, td.gF span[email], span[email]');
    if (!s) return '';
    const name = s.getAttribute('name') || s.textContent.trim();
    return name.split(/\s+/)[0];
  }

  function dateOf(msg) {
    const d = msg.querySelector('.g3');
    const parsed = d && D ? D.parse(d.getAttribute('title') || d.textContent, GL.lang(), new Date()) : null;
    if (!parsed) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return pad(parsed.getDate()) + '/' + pad(parsed.getMonth() + 1);
  }

  function flash(target) {
    target.classList.add('glx-flash');
    setTimeout(() => target.classList.remove('glx-flash'), 1600);
  }

  function updateSummary(list, s) {
    const parent = list.parentElement;
    const old = parent ? parent.querySelectorAll(':scope > .glx-att-summary') : [];
    const remove = () => old.forEach((p) => p.remove());
    if (!s.attachmentsSummary || !parent) return remove();

    const messageCount = list.querySelectorAll(GL.MESSAGE).length;
    const entries = new Map(); // nom|taille -> { info, msg, count, order, pos }
    [...list.querySelectorAll('div.hq')].forEach((area, order) => {
      const msg = messageOf(area);
      cardsIn(area).forEach((card, pos) => {
        const info = cardInfo(card);
        const key = info.name + '|' + info.size;
        const prev = entries.get(key);
        // Un même fichier envoyé plusieurs fois : on garde le message le plus récent.
        entries.set(key, { info, msg, order, pos, count: prev ? prev.count + 1 : 1 });
      });
    });
    if (messageCount < SUMMARY_MIN_MESSAGES || entries.size < SUMMARY_MIN_FILES) return remove();

    // Message le plus récent d'abord, et dans un message, l'ordre de Gmail.
    const rows = [...entries.values()].sort((a, b) => b.order - a.order || a.pos - b.pos);
    const sig = [summaryOpen, summaryShowAll, ...rows.map((r) => r.info.name + '|' + r.info.size + '|' + r.count)].join('§');
    if (old.length === 1 && old[0].dataset.sig === sig && old[0].nextElementSibling === list) return;
    remove();

    const panel = el('div', 'glx-own glx-att-summary' + (summaryOpen ? '' : ' is-closed'));
    panel.dataset.sig = sig;
    const head = el('button', 'glx-att-summary-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(summaryOpen));
    head.appendChild(svg(ICONS.clip));
    head.appendChild(el('span', 'glx-att-summary-title', rows.length + ' pièces jointes dans cette conversation'));
    const chev = svg(ICONS.chevron);
    chev.classList.add('glx-chevron');
    head.appendChild(chev);
    head.addEventListener('click', () => {
      summaryOpen = !summaryOpen;
      GL.schedule(0);
    });
    panel.appendChild(head);

    const listEl = el('div', 'glx-att-list');
    rows.forEach((r, i) => {
      const meta = [senderOf(r.msg), dateOf(r.msg)].filter(Boolean).join(' · ') + (r.count > 1 ? ' · ×' + r.count : '');
      const row = item(r.info, {
        meta,
        goto: () => {
          r.msg.scrollIntoView({ behavior: 'smooth', block: 'start' });
          flash(r.msg);
        },
      });
      if (!summaryShowAll && i >= SUMMARY_VISIBLE) row.classList.add('is-extra');
      listEl.appendChild(row);
    });
    panel.appendChild(listEl);

    if (rows.length > SUMMARY_VISIBLE) {
      const more = el('button', 'glx-att-more', summaryShowAll ? 'Afficher moins' : 'Afficher les ' + rows.length);
      more.type = 'button';
      more.addEventListener('click', () => {
        summaryShowAll = !summaryShowAll;
        GL.schedule(0);
      });
      panel.appendChild(more);
    }
    isolate(panel);
    parent.insertBefore(panel, list);
  }

  // ---------- Boucle ----------

  function update(s) {
    for (const area of document.querySelectorAll('div.hq')) {
      if (!area.closest('.glx-own')) updateMessageBar(area, s);
    }
    // Barres orphelines (message refermé ou effacé).
    for (const bar of document.querySelectorAll('.glx-att-bar')) {
      const msg = bar.parentElement && bar.parentElement.closest('.adn, ' + GL.MESSAGE);
      if (!msg || !msg.querySelector('div.hq')) bar.remove();
    }
    const list = GL.visibleThreadList();
    if (list) updateSummary(list, s);
    else if (!s.attachmentsSummary) document.querySelectorAll('.glx-att-summary').forEach((p) => p.remove());
  }

  GL.register({ name: 'pièces jointes', update });
})();
