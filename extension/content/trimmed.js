/*
 * Noms de pièces jointes laissés par Apple Mail dans les messages
 * (« <plan.pdf><plan.dxf> », « <PastedGraphic-1.tiff> »).
 *
 *  - Une ligne qui ne contient QUE des noms de fichiers est masquée, où qu'elle soit
 *    dans le message (même si Gmail a découpé le texte en plusieurs morceaux).
 *  - Un nom de fichier au milieu d'une phrase n'est masqué que dans une citation
 *    ou sous le bouton « contenu abrégé ».
 * Le bouton « Afficher le contenu abrégé » lui-même est masqué en CSS (content.css).
 * Le masquage se fait en CSS : désactiver le réglage réaffiche tout aussitôt.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const BUTTON = '.ajU, .ajV, .adm, .ajR';
  const QUOTE = 'blockquote, .gmail_quote, .im, .h5, .adL, [type="cite"]';
  const BLANK = '\\s\\u200b-\\u200d\\u2060\\ufeff';
  const BLANK_RE = new RegExp('^[' + BLANK + ']*$');
  const TOKEN_RE = /<([^<>@/\\\r\n]{1,200})\.([A-Za-z0-9]{1,8})>/g;
  // Extensions qui ressemblent à des adresses web plutôt qu'à des fichiers.
  const WEB_EXT = new Set(['com', 'net', 'org', 'fr', 'io', 'eu', 'de', 'uk', 'be', 'ch', 'info', 'biz', 'gov', 'edu', 'co']);
  const SKIP_TAGS = new Set(['A', 'SCRIPT', 'STYLE', 'TEXTAREA', 'BUTTON']);
  const BLOCK_TAGS = new Set([
    'DIV', 'P', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'HR', 'DL', 'DT', 'DD',
    'CENTER', 'FORM', 'FIELDSET', 'ADDRESS', 'FIGURE', 'MAIN', 'NAV', 'ASIDE',
  ]);

  const done = new WeakMap(); // corps de message -> signature déjà traitée

  function isBlank(text) {
    return BLANK_RE.test(text);
  }

  function isFileToken(name, ext) {
    if (/^\s|\s$/.test(name)) return false;
    if (/^(www\.|https?|mailto|cid:)/i.test(name)) return false;
    return !WEB_EXT.has(ext.toLowerCase());
  }

  /** Vrai si le texte n'est fait que de noms de fichiers « <x.ext> » (et d'espaces). */
  function onlyTokens(text) {
    if (text.indexOf('<') < 0) return false;
    let rest = '';
    let last = 0;
    let found = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      if (!isFileToken(m[1], m[2])) return false;
      rest += text.slice(last, m.index);
      last = m.index + m[0].length;
      found++;
    }
    rest += text.slice(last);
    return found > 0 && isBlank(rest);
  }

  function makeSpan(text) {
    const span = document.createElement('span');
    span.className = 'glx-att-ph';
    span.textContent = text;
    return span;
  }

  function hide(node) {
    const span = makeSpan(node.nodeValue);
    node.parentNode.replaceChild(span, node);
    return span;
  }

  /** Nom de fichier isolé au milieu d'un texte : seul le nom est enveloppé. */
  function wrapMixedTokens(node) {
    const text = node.nodeValue;
    const parts = [];
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      if (!isFileToken(m[1], m[2])) continue;
      const before = text[m.index - 1];
      const after = text[m.index + m[0].length];
      if (before !== undefined && !isBlank(before) && before !== '>') continue;
      if (after !== undefined && !isBlank(after) && after !== '<') continue;
      parts.push([last, m.index, false], [m.index, m.index + m[0].length, true]);
      last = m.index + m[0].length;
    }
    if (!parts.length) return [];
    parts.push([last, text.length, false]);
    const frag = document.createDocumentFragment();
    const spans = [];
    for (const [a, b, token] of parts) {
      if (a === b) continue;
      if (token) {
        const span = makeSpan(text.slice(a, b));
        spans.push(span);
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(text.slice(a, b)));
      }
    }
    node.parentNode.replaceChild(frag, node);
    return spans;
  }

  /**
   * Découpe le contenu « en ligne » d'un bloc en lignes (séparées par <br> ou
   * par des blocs). Chaque ligne = liste de nœuds texte + le <br> qui la termine.
   */
  function linesOf(block) {
    const lines = [];
    let cur = { texts: [], br: null };
    const flush = (br) => {
      if (cur.texts.length) {
        cur.br = br || null;
        lines.push(cur);
      }
      cur = { texts: [], br: null };
    };
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          cur.texts.push(child);
        } else if (child.nodeType === 1) {
          if (child.tagName === 'BR') flush(child);
          else if (BLOCK_TAGS.has(child.tagName)) flush(null);
          else if (SKIP_TAGS.has(child.tagName) || child.classList.contains('glx-att-ph')) cur.texts.push(null);
          else walk(child);
        }
      }
    })(block);
    flush(null);
    return lines;
  }

  /** Vrai si l'élément ne contient plus rien de visible une fois les noms masqués. */
  function isEmptyOnceHidden(el, depth) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        if (!isBlank(child.nodeValue)) return false;
      } else if (child.nodeType === 1) {
        if (child.classList.contains('glx-att-ph') || child.tagName === 'BR' || child.tagName === 'WBR') continue;
        if (depth > 3 || /^(IMG|TABLE|A|VIDEO|IFRAME|INPUT|SVG|HR)$/i.test(child.tagName)) return false;
        if (!isEmptyOnceHidden(child, depth + 1)) return false;
      }
    }
    return true;
  }

  function hideEmptyBlocks(start, body) {
    let el = start;
    for (let i = 0; i < 3 && el && el !== body && body.contains(el); i++) {
      if (el.querySelector(BUTTON) || !isEmptyOnceHidden(el, 0)) break;
      el.classList.add('glx-att-ph-block');
      el = el.parentElement;
    }
  }

  function signatureOf(body) {
    return body.childNodes.length + ':' + body.getElementsByTagName('*').length;
  }

  function processBody(body) {
    if (done.get(body) === signatureOf(body)) return;
    if (body.textContent.indexOf('<') < 0) {
      done.set(body, signatureOf(body));
      return;
    }
    const button = body.querySelector(BUTTON);
    const blocks = [body, ...body.querySelectorAll([...BLOCK_TAGS].join(','))];
    const touched = new Set();

    for (const block of blocks) {
      if (block.closest('[contenteditable="true"], .glx-att-ph-block')) continue;
      for (const line of linesOf(block)) {
        if (line.texts.includes(null)) continue; // lien, bouton… : on ne touche pas
        const texts = line.texts;
        const joined = texts.map((t) => t.nodeValue).join('');
        if (joined.indexOf('<') < 0) continue;

        if (onlyTokens(joined)) {
          // Ligne faite uniquement de noms de fichiers : on la masque entièrement.
          for (const t of texts) touched.add(hide(t).parentElement);
          if (line.br) line.br.classList.add('glx-att-ph-br');
          continue;
        }

        // Nom de fichier au milieu d'un texte : seulement dans une citation ou sous le bouton.
        for (const t of texts) {
          if (t.nodeValue.indexOf('<') < 0) continue;
          const inQuote = !!t.parentElement.closest(QUOTE);
          const afterButton =
            button && !button.contains(t) && button.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING;
          if (!inQuote && !afterButton) continue;
          for (const span of wrapMixedTokens(t)) touched.add(span.parentElement);
        }
      }
    }

    for (const el of touched) hideEmptyBlocks(el, body);
    done.set(body, signatureOf(body));
  }

  function update(settings) {
    if (!settings.hideAttachmentPlaceholders) return;
    for (const body of document.querySelectorAll('div.ii.gt, div.adP')) {
      if (GL.isVisible(body)) processBody(body); // messages repliés : traités à l'ouverture
    }
  }

  GL.register({ name: 'noms de pièces jointes', update });
})();
