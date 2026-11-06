/*
 * Historique recopié et signatures répétées.
 *
 * Beaucoup de réponses recopient toute la conversation précédente. Ici, pour
 * chaque message, on compare chaque partie citée (« Le … a écrit : », « De : … »,
 * citations Gmail / Apple Mail / Outlook / Thunderbird…) avec les messages
 * situés AU-DESSUS dans la conversation :
 *  - déjà présente plus haut : masquée (vous l'avez déjà sous les yeux) ;
 *  - jamais reçue (vous avez été ajouté en copie en cours de route…) : affichée,
 *    même si Gmail l'avait cachée derrière « ••• ».
 * Dans un même e-mail, une signature identique répétée (une par réponse
 * empilée) n'est affichée qu'une fois.
 * Tout passe par des classes CSS : couper un réglage réaffiche tout aussitôt.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const K = 6; // les textes sont comparés par suites de 6 mots
  const BLOCK_TAGS = new Set([
    'DIV', 'P', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'HR', 'DL', 'DT', 'DD',
    'CENTER', 'FORM', 'FIELDSET', 'ADDRESS', 'FIGURE', 'MAIN', 'NAV', 'ASIDE',
  ]);
  const ATTRIB_RE = /(a [eé]crit|wrote|schrieb|escribi[oó]|ha scritto|escreveu|schreef)\s*:?\s*$/i;
  const HEADER_LINE_RE = /^(de|from|von|da|envoy[eé]|sent|gesendet|enviado|inviato|[aà]|to|an|para|cc|cci|objet|subject|betreff|asunto|oggetto|date|datum|fecha|data)\s*:/i;
  const SEPARATOR_RE = /^([-_=*~]{2,}.*|.*(message d'origine|original message|forwarded message|message transf[eé]r[eé]|mensaje original|urspr[uü]ngliche nachricht).*)$/i;
  const QUOTE_SEL = '.gmail_quote, blockquote[type="cite"], blockquote.gmail_quote, .yahoo_quoted, [id*="divRplyFwdMsg"]';
  const TRIMMED_SEL = '.h5, .adL';
  const SIG_SEL = '.gmail_signature, [data-smartmail="gmail_signature"], [class*="signature" i], [id*="signature" i], [id*="_rc_sig"]';
  const DEPTH_SEL = 'blockquote, .gmail_quote, .yahoo_quoted, .h5, .adL';

  const done = new WeakMap(); // liste de messages -> empreinte déjà traitée

  // ---------- Texte ----------

  /** Texte découpé en lignes (blocs et retours à la ligne). */
  function linesOf(nodes) {
    const out = [];
    let cur = '';
    const flush = () => {
      const t = cur.replace(/[\s​﻿]+/g, ' ').trim();
      if (t) out.push(t);
      cur = '';
    };
    const walk = (n) => {
      if (n.nodeType === 3) {
        cur += n.nodeValue;
        return;
      }
      if (n.nodeType !== 1 || n.classList.contains('glx-own')) return;
      const tag = n.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (tag === 'BR') return flush();
      const block = BLOCK_TAGS.has(tag);
      if (block) flush();
      for (const c of n.childNodes) walk(c);
      if (block) flush();
    };
    for (const n of nodes) walk(n);
    flush();
    return out;
  }

  /** Mots utiles (sans « Le … a écrit : », en-têtes « De : », séparateurs). */
  function wordsOf(nodes) {
    const lines = linesOf(nodes).filter((l) => !ATTRIB_RE.test(l) && !HEADER_LINE_RE.test(l) && !SEPARATOR_RE.test(l));
    return GL.norm(lines.join(' ')).match(/[\p{L}\p{N}]+/gu) || [];
  }

  function shingles(words) {
    const out = [];
    for (let i = 0; i + K <= words.length; i++) out.push(words.slice(i, i + K).join(' '));
    return out;
  }

  /** Vrai si ce texte figure déjà (presque entièrement) dans les messages précédents. */
  function alreadySeen(words, seen, seenWords) {
    if (!words.length) return true;
    const sh = shingles(words);
    if (!sh.length) return words.every((w) => seenWords.has(w));
    let hit = 0;
    for (const s of sh) if (seen.has(s)) hit++;
    const miss = sh.length - hit;
    return hit / sh.length >= 0.8 && miss <= Math.max(4, Math.round(sh.length * 0.1));
  }

  function toggle(els, cls, on) {
    for (const el of els) {
      if (el.nodeType === 1 && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
    }
  }

  // ---------- Parties citées d'un message ----------

  function isOutlookHeader(el) {
    const lines = linesOf([el]).slice(0, 8);
    return lines.length >= 2 && /^(de|from|von|da)\s*:/i.test(lines[0]) && lines.some((l) => /^(envoy[eé]|sent|gesendet|enviado|inviato|date)\s*:/i.test(l));
  }

  function followingSiblings(el) {
    const out = [el];
    for (let s = el.nextElementSibling; s; s = s.nextElementSibling) out.push(s);
    return out;
  }

  function quoteUnits(body) {
    const units = [];
    const taken = new Set();
    const isInside = (el) => {
      for (let p = el.parentElement; p && p !== body; p = p.parentElement) if (taken.has(p)) return true;
      return false;
    };
    const add = (els, trimmed) => {
      els.forEach((e) => taken.add(e));
      units.push({ els, trimmed });
    };

    // 1. Parties que Gmail a déjà cachées derrière « ••• ».
    for (const el of body.querySelectorAll(TRIMMED_SEL)) {
      if (!taken.has(el) && !isInside(el) && el.textContent.trim()) add([el], true);
    }

    // 2. Citations balisées : Gmail, Apple Mail, Thunderbird, Roundcube, Yahoo, Outlook web.
    for (const el of body.querySelectorAll(QUOTE_SEL)) {
      if (taken.has(el) || isInside(el)) continue;
      let els = [el];
      if (/divRplyFwdMsg/.test(el.id || '')) {
        els = followingSiblings(el);
        const hr = el.previousElementSibling;
        if (hr && hr.tagName === 'HR') els.unshift(hr);
      } else {
        const prev = el.previousElementSibling;
        if (prev && !taken.has(prev) && (prev.classList.contains('moz-cite-prefix') || (prev.textContent.length < 300 && ATTRIB_RE.test(prev.textContent.trim())))) {
          els.unshift(prev);
        }
      }
      add(els, false);
    }

    // 3. Outlook (logiciel) : bloc « De : … Envoyé : … » puis tout le message cité.
    for (const b of body.querySelectorAll('b, strong')) {
      if (!/^(de|from|von|da)\s*:?$/i.test(b.textContent.trim())) continue;
      const head = b.closest('p, div');
      if (!head || head === body || taken.has(head) || isInside(head) || !isOutlookHeader(head)) continue;
      const parent = head.parentElement;
      const box = parent && parent !== body && /border-top/i.test(parent.getAttribute('style') || '') ? parent : head;
      if (taken.has(box) || isInside(box)) continue;
      add(followingSiblings(box), false);
    }
    return units;
  }

  // ---------- Signatures répétées dans un même e-mail ----------

  function depthOf(el, body) {
    let d = 0;
    for (let p = el.parentElement; p && p !== body; p = p.parentElement) if (p.matches(DEPTH_SEL)) d++;
    return d;
  }

  function signatureLike(el) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 15 || text.length > 1500) return false;
    return !!el.querySelector('img') || /@|\+?\d[\d .()-]{7,}\d|www\./.test(text);
  }

  /** « -- » seul sur sa ligne : la signature suit (jusqu'à une citation). */
  function delimiterRegions(body) {
    const regions = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!/^[\s ]*--[\s ]*$/.test(t.nodeValue)) continue;
      const parent = t.parentElement;
      if (!parent || parent.closest('.glx-own')) continue;
      const alone = parent !== body && !parent.textContent.replace(/[-\s ]/g, '') && parent.children.length <= 1;
      const start = alone ? parent : t;
      const nodes = [start];
      let size = 0;
      for (let s = start.nextSibling; s; s = s.nextSibling) {
        if (s.nodeType === 1 && (s.matches(QUOTE_SEL + ', ' + TRIMMED_SEL) || s.querySelector(QUOTE_SEL + ', ' + TRIMMED_SEL))) break;
        if (s.nodeType === 1 && ATTRIB_RE.test((s.textContent || '').trim()) && s.textContent.length < 300) break;
        size += (s.textContent || '').length;
        if (size > 2000) break;
        nodes.push(s);
      }
      if (nodes.length > 1) regions.push(nodes);
    }
    return regions;
  }

  function wrapText(node) {
    if (node.nodeType !== 3) return node;
    if (!node.nodeValue.trim()) return null;
    const span = document.createElement('span');
    span.textContent = node.nodeValue;
    node.parentNode.replaceChild(span, node);
    return span;
  }

  function dedupeSignatures(body, on) {
    const cands = [];
    const addCand = (nodes) => {
      const els = nodes.filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.nodeValue.trim()));
      if (!els.length) return;
      const words = wordsOf(els);
      if (words.length < 3) return;
      const imgs = els.reduce((n, e) => n + (e.nodeType === 1 ? e.querySelectorAll('img').length + (e.tagName === 'IMG' ? 1 : 0) : 0), 0);
      cands.push({ nodes, key: words.slice(0, 300).join(' ') + '|' + imgs, first: els[0] });
    };
    for (const el of body.querySelectorAll(SIG_SEL)) if (signatureLike(el)) addCand([el]);
    for (const nodes of delimiterRegions(body)) addCand(nodes);
    for (const t of body.querySelectorAll('table')) {
      if (!t.parentElement.closest('table') && signatureLike(t)) addCand([t]);
    }

    // Une signature trouvée deux fois (ex. le tableau dans une zone « -- ») ne compte qu'une fois.
    const covers = (a, b) => a !== b && a.nodes.some((n) => n.nodeType === 1 && n !== b.first && n.contains(b.first));
    const kept = cands.filter((b) => !cands.some((a) => covers(a, b) || (a !== b && a.nodes.length > b.nodes.length && a.nodes.includes(b.first))));

    const groups = new Map();
    for (const c of kept) {
      if (!groups.has(c.key)) groups.set(c.key, []);
      groups.get(c.key).push(c);
    }
    for (const list of groups.values()) {
      if (list.length < 2) {
        for (const c of list) toggle(c.nodes, 'glx-sig-dup', false);
        continue;
      }
      // On garde celle de l'e-mail le plus récent : la moins imbriquée, puis la dernière.
      const depth = (c) => depthOf(c.first.nodeType === 1 ? c.first : c.first.parentElement, body);
      let keep = list[0];
      let keepDepth = depth(keep);
      for (const c of list.slice(1)) {
        const d = depth(c);
        if (d <= keepDepth) {
          keep = c;
          keepDepth = d;
        }
      }
      for (const c of list) {
        const hideIt = on && c !== keep;
        c.nodes = c.nodes.map((n) => (n.nodeType === 3 && hideIt ? wrapText(n) : n)).filter(Boolean);
        toggle(c.nodes, 'glx-sig-dup', hideIt);
      }
    }
  }

  // ---------- Boucle ----------

  function update(s) {
    const list = GL.visibleThreadList();
    if (!list) return;
    const bodies = [...list.querySelectorAll('div.ii.gt')];
    const key = [s.hideQuotedHistory, s.hideTrimmedButton, s.hideRepeatedSignatures, ...bodies.map((b) => b.textContent.length)].join(',');
    if (done.get(list) === key) return;

    const seen = new Set();
    const seenWords = new Set();
    for (const body of bodies) {
      for (const u of quoteUnits(body)) {
        const old = alreadySeen(wordsOf(u.els), seen, seenWords);
        if (u.trimmed) toggle(u.els, 'glx-quote-show', !old); // caché par Gmail mais jamais reçu : on le montre
        else toggle(u.els, 'glx-quote-hidden', old); // recopié alors qu'il est déjà plus haut : on le cache
      }
      dedupeSignatures(body, s.hideRepeatedSignatures);
      const all = wordsOf([body]);
      for (const sh of shingles(all)) seen.add(sh);
      for (const w of all) seenWords.add(w);
    }
    done.set(list, key);
  }

  GL.register({ name: 'historique et signatures', update });
})();
