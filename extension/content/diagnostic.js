/*
 * Diagnostic : décrit la structure de la page Gmail affichée (balises, classes,
 * boutons de Gmail) SANS le contenu de vos e-mails : les textes sont remplacés
 * par leur longueur, les adresses et noms de fichiers sont masqués.
 * Demandé par la fenêtre de réglages (bouton « Copier un diagnostic »).
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const MAX_LEN = 60000;
  const ATTRS = ['role', 'aria-label', 'data-tooltip', 'aria-disabled', 'aria-expanded', 'gh', 'g_editable', 'contenteditable', 'type', 'title', 'download_url', 'data-message-id', 'data-thread-perm-id', 'id'];

  /** Masque ce qui peut être personnel (adresses, fichiers, nombres longs). */
  function scrub(s) {
    return String(s)
      .replace(/[\w.+-]+@[\w.-]+/g, '•@•')
      .replace(/https?:\/\/[^\s"]+/g, (u) => u.split('?')[0].replace(/\/[^/]*$/, '/…'))
      .replace(/[^\s<>"':/]+\.(\w{2,5})\b/g, '•.$1')
      .replace(/\d{5,}/g, '#');
  }

  const CONTROL = '[role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], button, img';

  function attrText(el, name) {
    if (!el.hasAttribute(name)) return null;
    const v = el.getAttribute(name);
    if (name === 'id' && /^:/.test(v)) return null; // identifiants internes de Gmail, inutiles
    if (name === 'download_url') return v.split(':')[0] + ':•:…';
    if (name === 'title' && el.closest('td.xW, .apm, .g3')) return v; // dates
    if (name === 'aria-label' || name === 'data-tooltip' || name === 'title') {
      // Seuls les libellés des boutons de Gmail sont gardés (pas les noms, sujets…).
      return el.matches(CONTROL) ? scrub(v).slice(0, 80) : '…(' + v.length + ')';
    }
    return scrub(v).slice(0, 80);
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.classList.length) s += '.' + [...el.classList].join('.');
    for (const a of ATTRS) {
      const v = attrText(el, a);
      if (v !== null) s += ' [' + a + (v ? '="' + v + '"' : '') + ']';
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none') s += ' {caché}';
    else if (cs.position === 'fixed') s += ' {fixed}';
    return s;
  }

  function textInfo(t) {
    const v = t.nodeValue.trim();
    if (!v) return null;
    if (v.indexOf('<') >= 0 && /<[^<>]+\.\w{1,8}>/.test(v)) {
      const masked = v
        .split(/(<[^<>]+\.\w{1,8}>)/)
        .map((part, i) => (i % 2 ? part.replace(/<[^<>]+\.(\w{1,8})>/, '<•.$1>') : part.replace(/\S/g, '·')))
        .join('');
      return '#texte « ' + masked.slice(0, 120) + ' »';
    }
    return '#texte(' + v.length + ')';
  }

  /** Arbre compact : profondeur et nombre d'enfants limités. */
  function tree(root, maxDepth, maxChildren, out, depth) {
    depth = depth || 0;
    if (!root || out.length > 4000) return out;
    out.push('  '.repeat(depth) + describe(root));
    if (depth >= maxDepth) return out;
    let shown = 0;
    for (const child of root.childNodes) {
      if (shown >= maxChildren) {
        out.push('  '.repeat(depth + 1) + '… (' + (root.childNodes.length - shown) + ' de plus)');
        break;
      }
      if (child.nodeType === 3) {
        const t = textInfo(child);
        if (t) {
          out.push('  '.repeat(depth + 1) + t);
          shown++;
        }
      } else if (child.nodeType === 1 && !/^(SCRIPT|STYLE|SVG|PATH)$/i.test(child.tagName)) {
        tree(child, maxDepth, maxChildren, out, depth + 1);
        shown++;
      }
    }
    return out;
  }

  /** Chemin d'un élément vers un ancêtre (pour situer un nœud). */
  function path(node, stop) {
    const parts = [];
    for (let el = node.nodeType === 1 ? node : node.parentElement; el && el !== stop; el = el.parentElement) {
      parts.unshift(describe(el));
      if (parts.length > 12) break;
    }
    return parts.join('\n    > ');
  }

  function section(title, lines) {
    return '\n## ' + title + '\n' + (lines.length ? lines.join('\n') : '(rien)') + '\n';
  }

  function threadPart() {
    const lines = [];
    const list = GL.visibleThreadList();
    if (!list) return section('Conversation', ['aucune conversation affichée']);
    const counts = {};
    for (const c of ['h7', 'kv', 'ky', 'kQ', 'kx', 'adv', 'adn', 'hq', 'glx-att-bar']) counts[c] = list.getElementsByClassName(c).length;
    lines.push('messages : ' + JSON.stringify(counts));
    const scope = GL.threadScope(list);
    lines.push('zone conversation : ' + (scope ? describe(scope) : '?'));
    lines.push('bouton « Tout développer » (img.gx) : ' + (document.querySelector('img.gx') ? 'oui' : 'non') + ', img.gq : ' + (document.querySelector('img.gq') ? 'oui' : 'non'));
    lines.push('\nStructure de la liste :');
    tree(list, 4, 12, lines);

    // Messages qui contiennent des « <fichier.ext> »
    let n = 0;
    for (const body of list.querySelectorAll('div.ii.gt')) {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && n < 6) {
        const t = walker.currentNode;
        if (!/<[^<>]+\.\w{1,8}>/.test(t.nodeValue)) continue;
        n++;
        const hidden = t.parentElement.closest('.glx-att-ph, .glx-att-ph-block');
        lines.push('\nNom de fichier trouvé (' + (hidden ? 'masqué' : 'VISIBLE') + ') : ' + textInfo(t));
        lines.push('    > ' + path(t, body.parentElement));
        lines.push('  bloc parent :');
        tree(t.parentElement.closest('div, blockquote, p') || t.parentElement, 3, 8, lines, 2);
      }
    }
    // Zones de pièces jointes de Gmail
    const area = list.querySelector('div.hq');
    if (area) {
      lines.push('\nZone de pièces jointes (1re) :');
      tree(area, 7, 6, lines);
    }
    return section('Conversation', lines);
  }

  function composePart() {
    const lines = [];
    for (const host of document.querySelectorAll('.ip')) {
      if (!host.classList.contains('adB') && !host.querySelector(GL.EDITOR)) continue;
      lines.push('Réponse dans la conversation : ' + describe(host));
      tree(host, 6, 10, lines, 1);
    }
    const popups = document.querySelectorAll('.AD, [role="dialog"]');
    lines.push('\nFenêtres de rédaction / dialogues : ' + popups.length);
    [...popups].slice(0, 3).forEach((p) => {
      lines.push(describe(p));
      const bar = p.querySelector('.Hm');
      if (bar) tree(bar, 3, 8, lines, 1);
      for (const b of p.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip]')) {
        lines.push('  bouton : ' + describe(b));
      }
    });
    return section('Rédaction', lines.slice(0, 400));
  }

  function replyPart() {
    const lines = [];
    if (!GL.replyState) return section('Réponse pop-up', lines);
    const st = GL.replyState();
    lines.push('réponse dans la conversation : ' + (st.found ? 'oui' : 'non'));
    if (st.found) {
      lines.push('  conteneur : ' + describe(st.found.host));
      lines.push('  carte : ' + describe(st.found.card));
      lines.push('  chemin : ' + path(st.found.card, document.body).split('\n').slice(-6).join('\n'));
    }
    lines.push('bouton « fenêtre pop-up » : ' + (st.popoutButton ? describe(st.popoutButton) : 'introuvable'));
    lines.push('fenêtre ouverte par l’extension : ' + (st.popped ? describe(st.popped) : 'non'));
    lines.push('zone de défilement : ' + (st.scroller ? describe(st.scroller) : '?') + ' · part visible ' + st.ratio + ' · en bas ' + st.atBottom);
    lines.push('occupé : ' + st.busy + ' · attente ' + st.cooldown + ' ms');
    if (st.found) {
      lines.push('\nBoutons autour de la réponse :');
      const scope = st.found.card.closest('[role="listitem"]') || st.found.host;
      for (const b of scope.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip], button[aria-label]')) {
        lines.push('  ' + describe(b));
        if (lines.length > 80) break;
      }
    }
    return section('Réponse pop-up', lines);
  }

  function listPart() {
    const lines = [];
    const bodies = new Set([...document.querySelectorAll('tr.zA')].map((r) => r.parentElement));
    lines.push('tableaux de messages : ' + bodies.size);
    let i = 0;
    for (const tbody of bodies) {
      if (i++ >= 6) break;
      const visible = GL.isVisible(tbody);
      const rows = tbody.querySelectorAll('tr.zA');
      const starred = [...rows].filter((r) => r.querySelector('.T-KT-Jp, .T-KT:not(.aXw)')).length;
      lines.push('\nTableau ' + i + (visible ? ' (affiché)' : ' (caché)') + ' : ' + rows.length + ' lignes, ' + starred + ' suivies, ' + tbody.querySelectorAll('.glx-day-sep').length + ' séparateurs');
      const titles = [];
      let el = tbody.closest('table');
      for (let k = 0; el && k < 8; k++, el = el.parentElement) {
        titles.push(describe(el));
        const h = el.querySelector(':scope > * .Wn, :scope > .Wg, :scope h3.Wr');
        if (h) {
          titles.push('   titre de section : « ' + h.textContent.trim().slice(0, 40) + ' »');
          break;
        }
      }
      lines.push('  ancêtres :\n    ' + titles.join('\n    '));
      if (visible && rows[0]) {
        lines.push('  1re ligne :');
        tree(rows[0], 3, 12, lines, 2);
      }
    }
    lines.push('\nBarres d’outils visibles [gh=tm] :');
    for (const t of document.querySelectorAll('[gh="tm"]')) {
      if (!GL.isVisible(t)) continue;
      for (const b of t.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip]')) {
        if (GL.isVisible(b)) lines.push('  ' + describe(b));
      }
    }
    return section('Listes d’e-mails', lines);
  }

  function scrollPart() {
    const lines = [];
    const t = GL.scrollTrace;
    if (t) {
      const ago = t.at ? Math.round((Date.now() - t.at) / 1000) + ' s' : '—';
      lines.push('dernier essai (il y a ' + ago + ', ' + t.count + ' crans) : ' + t.reason);
      if (t.metrics) lines.push('  zone : haut ' + t.metrics.top + ' / hauteur ' + t.metrics.height + ' / visible ' + t.metrics.view + (t.metrics.html ? ' (page entière)' : ''));
    }
    const sc = GL.listScroller ? GL.listScroller() : null;
    if (sc) {
      lines.push('zone qui défile : ' + describe(sc) + ' · overflow ' + getComputedStyle(sc).overflowY + ' · haut ' + Math.round(sc.scrollTop) + ' / hauteur ' + sc.scrollHeight + ' / visible ' + sc.clientHeight);
    } else {
      lines.push('zone qui défile : aucune liste affichée');
    }
    if (GL.listPager) {
      for (const dir of [1, -1]) {
        const how = GL.listPager(dir);
        lines.push((dir > 0 ? 'page suivante' : 'page précédente') + ' : ' + (how ? (how.button ? 'bouton ' + describe(how.button) : 'sans bouton') + (how.hash ? ' · adresse ' + how.hash.split('/').slice(-1)[0] : '') : 'aucune'));
      }
    }
    const c = GL.listCounter && GL.listCounter();
    lines.push('compteur : ' + (c ? c.from + '–' + c.to + ' sur ' + c.total : 'introuvable'));
    return section('Défilement continu', lines);
  }

  function build() {
    const head = [
      '# Diagnostic Gmail Lisible',
      'version : ' + chrome.runtime.getManifest().version,
      'date : ' + new Date().toISOString(),
      'langue : ' + GL.lang() + ' · fenêtre : ' + innerWidth + '×' + innerHeight,
      'vue : ' + (location.hash.split('/')[0] || '#') + (location.hash.indexOf('/') > 0 ? '/…' : ''),
      'réglages : ' + JSON.stringify(GL.settings),
    ];
    let text = head.join('\n');
    for (const part of [threadPart, composePart, replyPart, listPart, scrollPart]) {
      try {
        text += part();
      } catch (err) {
        text += '\n(erreur : ' + err.message + ')\n';
      }
    }
    text += section('Journal', GL.traces.slice(-25));
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN) + '\n… (tronqué)';
    return text;
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'glx-diagnostic') sendResponse({ ok: true, text: build() });
    });
  } catch (err) {
    // extension rechargée : rien à faire
  }

  GL.register({ name: 'diagnostic', update() {} });
})();
