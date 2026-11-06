/*
 * Contenu abrégé :
 *  - le bouton « Afficher le contenu abrégé » est masqué en CSS (content.css) ;
 *  - ici, on repère les noms de pièces jointes laissés par Apple Mail dans les
 *    citations (« <plan.pdf> », « <PastedGraphic-1.tiff> ») qui s'affichent
 *    sous ce bouton, et on les enveloppe pour pouvoir les masquer.
 * Le masquage se fait en CSS : désactiver le réglage les réaffiche aussitôt.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const BUTTON = '.ajU, .ajV, .adm, .ajR';
  const TOKEN_RE = /<([^<>@/\\\r\n]{1,200})\.([A-Za-z0-9]{1,8})>/g;
  // Extensions qui ressemblent à des adresses web plutôt qu'à des fichiers.
  const WEB_EXT = new Set(['com', 'net', 'org', 'fr', 'io', 'eu', 'de', 'uk', 'be', 'ch', 'info', 'biz', 'gov', 'edu', 'co']);
  const SKIP_TAGS = new Set(['A', 'SCRIPT', 'STYLE', 'TEXTAREA']);

  const done = new WeakMap(); // corps de message -> signature déjà traitée

  function isFileToken(name, ext) {
    if (/^\s|\s$/.test(name)) return false;
    if (/^(www\.|https?|mailto|cid:)/i.test(name)) return false;
    return !WEB_EXT.has(ext.toLowerCase());
  }

  /** Découpe un nœud texte : chaque « <fichier.ext> » isolé devient un <span>. */
  function wrapTokens(node) {
    const text = node.nodeValue;
    const parts = [];
    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      if (!isFileToken(m[1], m[2])) continue;
      const before = text[m.index - 1];
      const after = text[m.index + m[0].length];
      if (before !== undefined && !/[\s>]/.test(before)) continue;
      if (after !== undefined && !/[\s<]/.test(after)) continue;
      parts.push({ start: last, end: m.index, token: false });
      parts.push({ start: m.index, end: m.index + m[0].length, token: true });
      last = m.index + m[0].length;
    }
    if (!parts.length) return [];
    parts.push({ start: last, end: text.length, token: false });

    // Uniquement des noms de fichiers (et des espaces) : on enveloppe tout le nœud.
    const rest = parts.filter((p) => !p.token).map((p) => text.slice(p.start, p.end)).join('');
    if (!rest.trim()) {
      const span = makeSpan(text);
      node.parentNode.replaceChild(span, node);
      return [span];
    }

    const frag = document.createDocumentFragment();
    const spans = [];
    for (const p of parts) {
      if (p.start === p.end) continue;
      const chunk = text.slice(p.start, p.end);
      if (p.token) {
        const span = makeSpan(chunk);
        spans.push(span);
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(chunk));
      }
    }
    node.parentNode.replaceChild(frag, node);
    return spans;
  }

  function makeSpan(text) {
    const span = document.createElement('span');
    span.className = 'glx-att-ph';
    span.textContent = text;
    return span;
  }

  /** Vrai si l'élément ne contient plus rien de visible une fois les noms masqués. */
  function isEmptyOnceHidden(el, depth) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        if (child.nodeValue.trim()) return false;
      } else if (child.nodeType === 1) {
        if (child.classList.contains('glx-att-ph') || child.tagName === 'BR') continue;
        if (depth > 3 || /^(IMG|TABLE|A|VIDEO|IFRAME|INPUT|SVG)$/i.test(child.tagName)) return false;
        if (!isEmptyOnceHidden(child, depth + 1)) return false;
      }
    }
    return true;
  }

  function isBlankText(n) {
    return n && n.nodeType === 3 && !n.nodeValue.trim();
  }

  function tidyAround(span, body, button) {
    // Supprime le retour à la ligne laissé par le nom masqué (s'il était seul sur sa ligne).
    let prev = span.previousSibling;
    while (isBlankText(prev)) prev = prev.previousSibling;
    const startsLine =
      !prev || (prev.nodeType === 1 && (prev.tagName === 'BR' || prev.classList.contains('glx-att-ph')));
    let next = span.nextSibling;
    while (isBlankText(next)) next = next.nextSibling;
    if (startsLine && next && next.nodeType === 1 && next.tagName === 'BR') next.classList.add('glx-att-ph-br');

    // Masque les blocs devenus vides (au plus deux niveaux au-dessus).
    let el = span.parentElement;
    for (let i = 0; i < 2 && el && el !== body && !el.contains(button); i++) {
      if (!isEmptyOnceHidden(el, 0)) break;
      el.classList.add('glx-att-ph-block');
      el = el.parentElement;
    }
  }

  function signatureOf(body) {
    return body.childNodes.length + ':' + body.getElementsByTagName('*').length;
  }

  function processBody(body) {
    if (done.get(body) === signatureOf(body)) return;
    const button = body.querySelector(BUTTON);
    if (!button) return;

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.indexOf('<') < 0) return NodeFilter.FILTER_SKIP;
        const parent = n.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest('.glx-att-ph, [contenteditable="true"]')) {
          return NodeFilter.FILTER_SKIP;
        }
        if (button.contains(n)) return NodeFilter.FILTER_SKIP;
        // Seulement ce qui se trouve après le bouton « contenu abrégé ».
        if (!(button.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      for (const span of wrapTokens(node)) tidyAround(span, body, button);
    }
    done.set(body, signatureOf(body));
  }

  function update(settings) {
    if (!settings.hideAttachmentPlaceholders) return;
    for (const body of document.querySelectorAll('div.ii.gt')) {
      if (GL.isVisible(body)) processBody(body); // messages repliés : traités à l'ouverture
    }
  }

  GL.register({ name: 'noms de pièces jointes', update });
})();
