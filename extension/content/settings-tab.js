/*
 * Onglet « Personnalisation » dans les paramètres de Gmail (⚙️ → Voir tous les
 * paramètres). Notre onglet est une copie d'un onglet de Gmail (même aspect) ;
 * quand il est ouvert, le contenu de Gmail est caché (classe) et nos réglages
 * s'affichent à sa place. Aucun nœud de Gmail n'est déplacé.
 */
(function () {
  'use strict';

  const GL = globalThis.GL;
  if (!GL || GL.disabled) return;

  const TAB_TEXT = 'Personnalisation';

  const SECTIONS = [
    {
      title: 'Conversations',
      items: [
        { key: 'autoExpand', title: 'Déplier tous les messages', desc: 'Plus de messages repliés dans les longues conversations.' },
        { key: 'hideTrimmedButton', title: 'Masquer « Afficher le contenu abrégé »', desc: 'Cache le bouton « ••• » sous les messages et dans votre réponse.' },
        { key: 'hideQuotedHistory', title: "Masquer l'historique déjà lu", desc: 'Dans les réponses, les anciens messages recopiés sont cachés s’ils sont déjà plus haut. Ceux que vous n’avez jamais reçus restent affichés.' },
        { key: 'hideRepeatedSignatures', title: 'Une seule signature par e-mail', desc: 'Quand la même signature est empilée plusieurs fois dans un e-mail.' },
        { key: 'hideAttachmentPlaceholders', title: 'Masquer les noms de fichiers « <plan.pdf> »', desc: 'Ajoutés par Apple Mail dans le texte des réponses.' },
        { key: 'reverseThread', title: 'Conversation inversée', desc: 'Le dernier message en haut, le premier en bas. La réponse et les boutons « Répondre » passent tout en haut.' },
        { key: 'floatingReply', title: 'Réponse en fenêtre pop-up quand je remonte', desc: 'Votre réponse passe dans la fenêtre pop-up de Gmail pendant que vous relisez.' },
        { key: 'dockReplyAtBottom', parent: 'floatingReply', title: 'La remettre en place en redescendant', desc: 'Dès que sa place réapparaît à l’écran, elle revient dans la conversation (Gmail garde votre texte en brouillon).' },
      ],
    },
    {
      title: 'Pièces jointes',
      items: [
        { key: 'attachmentsOnTop', title: 'Au-dessus du message', desc: 'Les pièces jointes s’affichent avant le texte.' },
        { key: 'attachmentsCompact', title: 'Compactes', desc: 'Une ligne par fichier, sans grand aperçu, avec Télécharger et Drive.' },
        { key: 'attachmentsSummary', title: 'Toutes regroupées en haut', desc: 'Dans les longues conversations, la liste de toutes les pièces jointes.' },
      ],
    },
    {
      title: 'Boîte de réception',
      items: [
        { key: 'daySeparators', title: 'Séparateurs de dates', desc: 'Un petit titre entre les e-mails de chaque jour (sauf « Messages suivis »).' },
        {
          radio: 'daySeparatorMode',
          parent: 'daySeparators',
          options: [
            { value: 'day', title: 'Chaque jour', desc: 'Aujourd’hui · Hier · 04/11 · 03/11…' },
            { value: 'group', title: 'Regrouper', desc: 'Aujourd’hui · Hier · Cette semaine · Semaine dernière · Octobre…' },
          ],
        },
      ],
    },
  ];

  let wanted = false; // notre onglet est-il ouvert ?
  let openRequest = 0; // demande d'ouverture venue de l'icône de l'extension
  let keepUntil = 0; // ne pas refermer sur le changement d'adresse qui suit cette demande
  let tabEl = null;
  let panel = null;
  let styleEl = null;
  let hiddenNodes = [];
  let dimmed = [];

  const isSettingsView = () => /^#settings(\/|$)/.test(location.hash);
  const own = (el) => !!el.closest('.glx-own');

  // ---------- Barre d'onglets de Gmail ----------

  function tabTarget(el) {
    if (el.tagName === 'A') {
      const m = /#settings\/([\w-]+)$/.exec(el.getAttribute('href') || '');
      return m ? m[1] : null;
    }
    return el.getAttribute('role') === 'tab' ? 'tab' : null;
  }

  function commonAncestor(nodes) {
    let root = nodes[0].parentElement;
    while (root && !nodes.every((n) => root.contains(n))) root = root.parentElement;
    return root;
  }

  /** Les onglets de la page des paramètres : { root, units, links, active }. */
  function findTabs() {
    if (!isSettingsView()) return null;
    let links = [...document.querySelectorAll('a[href*="#settings/"]')].filter((a) => tabTarget(a) && !own(a) && GL.isVisible(a));
    if (links.length < 3) {
      links = [...document.querySelectorAll('[role="tab"]')].filter((t) => !own(t) && GL.isVisible(t));
    }
    if (links.length < 3) return null;
    const root = commonAncestor(links);
    if (!root) return null;
    // Un onglet = le plus grand bloc autour du lien qui ne contient aucun autre onglet.
    const units = links.map((link) => {
      let u = link;
      while (u.parentElement && u.parentElement !== root && links.filter((l) => u.parentElement.contains(l)).length === 1) u = u.parentElement;
      return u;
    });
    const current = (location.hash.split('?')[0].split('/')[1] || 'general').toLowerCase();
    let active = links.findIndex((l) => l.getAttribute('aria-selected') === 'true');
    if (active < 0) active = links.findIndex((l) => (tabTarget(l) || '').toLowerCase() === current);
    return { root, units, links, active };
  }

  /** Le contenu de l'onglet de Gmail (ce qui suit la barre d'onglets). */
  function findContent(root) {
    const counts = (s) => s.classList.contains('glx-settings-hidden') || GL.isVisible(s);
    for (let n = root; n && n.parentElement && n !== document.body; n = n.parentElement) {
      const after = [];
      for (let s = n.nextElementSibling; s; s = s.nextElementSibling) {
        if (!s.classList.contains('glx-own') && counts(s)) after.push(s);
      }
      if (after.some((s) => s.querySelector('input, select, textarea, table, button, [role="button"]'))) return { anchor: n, nodes: after };
      if (n.matches('[role="main"]')) break;
    }
    return null;
  }

  // ---------- Notre onglet ----------

  const STRIP = /^(id|href|jsaction|jscontroller|jsname|jslog|jsmodel|onclick|tabindex|aria-selected|aria-controls|data-.*)$/;

  function makeTab(template) {
    const clone = template.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) if (STRIP.test(a.name)) el.removeAttribute(a.name);
    }
    // Le texte de l'onglet : l'élément le plus profond qui porte du texte.
    let label = clone;
    while (label.firstElementChild && label.textContent.trim() === label.firstElementChild.textContent.trim()) label = label.firstElementChild;
    label.textContent = TAB_TEXT;
    const link = clone.matches('a, [role="tab"]') ? clone : clone.querySelector('a, [role="tab"]') || clone;
    link.setAttribute('role', 'tab');
    link.setAttribute('tabindex', '0');
    link.setAttribute('aria-selected', String(wanted));
    clone.classList.remove('glx-tab-dim');
    clone.classList.add('glx-own', 'glx-settings-tab');
    clone.dataset.glxState = wanted ? 'on' : 'off';
    clone.addEventListener('click', onTabClick, true);
    clone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onTabClick(e);
    });
    return clone;
  }

  function onTabClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (wanted) return;
    wanted = true;
    sync();
  }

  function ensureTab(tabs) {
    const state = wanted ? 'on' : 'off';
    const last = tabs.units[tabs.units.length - 1];
    if (tabEl && tabEl.isConnected && tabEl.previousElementSibling === last && tabEl.dataset.glxState === state) return;
    // Modèle : l'onglet actif de Gmail quand le nôtre est ouvert, sinon un onglet inactif.
    let index = tabs.active;
    if (!wanted) {
      index = tabs.units.length - 1;
      if (index === tabs.active) index--;
    }
    const template = tabs.units[index < 0 ? tabs.units.length - 1 : index];
    if (tabEl) tabEl.remove();
    tabEl = makeTab(template);
    last.after(tabEl);
  }

  /** L'onglet actif de Gmail prend l'aspect d'un onglet inactif pendant que le nôtre est ouvert. */
  function dimActive(tabs) {
    const unit = tabs.units[tabs.active];
    if (!wanted || !unit) return undim();
    if (!(dimmed.length === 1 && dimmed[0] === unit && unit.classList.contains('glx-tab-dim'))) {
      undim();
      unit.classList.add('glx-tab-dim');
      dimmed = [unit];
    }
    const other = tabs.links.find((l, i) => i !== tabs.active);
    const otherUnit = tabs.units[tabs.links.indexOf(other)];
    if (!other || !otherUnit) return;
    const cl = getComputedStyle(other);
    const cu = getComputedStyle(otherUnit);
    const css =
      '.glx-tab-dim, .glx-tab-dim * { color: ' + cl.color + ' !important; font-weight: ' + cl.fontWeight + ' !important; }\n' +
      '.glx-tab-dim { background-color: ' + cu.backgroundColor + ' !important; border-bottom: ' + cu.borderBottomWidth + ' ' + cu.borderBottomStyle + ' ' + cu.borderBottomColor + ' !important; box-shadow: ' + cu.boxShadow + ' !important; }';
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.createElement('style');
      styleEl.className = 'glx-own';
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  function undim() {
    for (const u of dimmed) u.classList.remove('glx-tab-dim');
    dimmed = [];
  }

  // ---------- Panneau des réglages ----------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function option(type, attrs, title, desc, sub) {
    const label = el('label', 'glx-set-item' + (sub ? ' glx-set-sub' : ''));
    const input = el('input');
    input.type = type;
    for (const k in attrs) input.setAttribute(k, attrs[k]);
    const text = el('span', 'glx-set-text');
    text.append(el('span', 'glx-set-title', title), el('span', 'glx-set-desc', desc));
    label.append(input, text);
    return label;
  }

  function buildPanel() {
    const root = el('div', 'glx-own glx-settings');
    root.append(el('p', 'glx-set-intro', 'Réglages de l’extension Gmail Lisible. Les changements s’appliquent tout de suite, pas besoin d’enregistrer.'));
    const table = el('table', 'glx-set-table');
    const tbody = el('tbody');
    for (const section of SECTIONS) {
      const tr = el('tr');
      const cell = el('td', 'glx-set-options');
      for (const item of section.items) {
        if (item.radio) {
          const group = el('div', 'glx-set-group');
          group.setAttribute('role', 'radiogroup');
          group.dataset.depends = item.parent;
          for (const o of item.options) group.append(option('radio', { name: 'glx-' + item.radio, 'data-radio': item.radio, value: o.value }, o.title, o.desc, true));
          cell.append(group);
        } else {
          const row = option('checkbox', { 'data-key': item.key }, item.title, item.desc, !!item.parent);
          if (item.parent) row.dataset.depends = item.parent;
          cell.append(row);
        }
      }
      tr.append(el('td', 'glx-set-label', section.title + ' :'), cell);
      tbody.append(tr);
    }
    table.append(tbody);
    root.append(table);
    let version = '';
    try {
      version = ' v' + chrome.runtime.getManifest().version;
    } catch (err) {
      version = '';
    }
    root.append(el('p', 'glx-set-foot', 'Gmail Lisible' + version + ' · Un souci ? Ouvrez la page Gmail concernée, cliquez sur l’icône de l’extension puis « Copier un diagnostic ».'));

    root.addEventListener('change', (e) => {
      const t = e.target;
      let change = null;
      if (t.dataset.key) change = { [t.dataset.key]: t.checked };
      else if (t.dataset.radio && t.checked) change = { [t.dataset.radio]: t.value };
      if (!change) return;
      Object.assign(GL.settings, change);
      fill(root);
      try {
        chrome.storage.sync.set(change);
      } catch (err) {
        GL.trace('paramètres', 'enregistrement impossible (rechargez Gmail)');
      }
      GL.schedule(0);
    });
    return root;
  }

  /** Affiche les valeurs actuelles (sans rien toucher si c'est déjà bon). */
  function fill(root) {
    const s = GL.settings;
    for (const input of root.querySelectorAll('input[data-key]')) {
      if (input.checked !== !!s[input.dataset.key]) input.checked = !!s[input.dataset.key];
    }
    for (const input of root.querySelectorAll('input[data-radio]')) {
      const on = s[input.dataset.radio] === input.value;
      if (input.checked !== on) input.checked = on;
    }
    for (const block of root.querySelectorAll('[data-depends]')) {
      const off = !s[block.dataset.depends];
      if (block.classList.contains('glx-set-off') !== off) block.classList.toggle('glx-set-off', off);
      for (const i of block.querySelectorAll('input')) if (i.disabled !== off) i.disabled = off;
    }
  }

  // ---------- Placement : dans la zone de défilement de Gmail ----------

  let scroller = null; // la zone qui défile sous les onglets (celle de Gmail)
  let layout = null; // marges, colonnes et polices relevées sur l'onglet de Gmail

  const scrollsY = (e) => /^(auto|scroll|overlay)$/.test(getComputedStyle(e).overflowY);

  /** La zone de défilement de Gmail qui contient le contenu de l'onglet. */
  function findScroller(nodes) {
    for (const n of nodes) {
      for (const e of [n, ...n.querySelectorAll('div')]) {
        if (scrollsY(e) && e.querySelector('input, select, table')) return e;
      }
    }
    return null;
  }

  const px = (v) => parseFloat(v) || 0;

  /** Relève la mise en page du contenu de Gmail (avant de le cacher). */
  function measure(sc) {
    for (const row of sc.querySelectorAll('tr')) {
      const cells = [...row.children].filter((c) => c.tagName === 'TD' && GL.isVisible(c));
      if (cells.length < 2 || !cells[0].textContent.trim()) continue;
      const [a, b] = cells;
      const ca = getComputedStyle(a);
      const cb = getComputedStyle(b);
      const cs = getComputedStyle(sc);
      const r = sc.getBoundingClientRect();
      const left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
      const textA = a.getBoundingClientRect().left + px(ca.paddingLeft);
      const textB = b.getBoundingClientRect().left + px(cb.paddingLeft);
      if (textB - textA < 40) continue;
      const line = px(ca.borderBottomWidth) ? ca : getComputedStyle(row);
      const strong = b.querySelector('b, strong, label');
      return {
        '--glx-set-indent': Math.max(0, Math.round(textA - left)) + 'px',
        '--glx-set-labelw': Math.round(textB - textA) + 'px',
        '--glx-set-padt': ca.paddingTop,
        '--glx-set-padb': ca.paddingBottom,
        '--glx-set-line': px(line.borderBottomWidth) ? line.borderBottomWidth + ' ' + line.borderBottomStyle + ' ' + line.borderBottomColor : '',
        '--glx-set-family': ca.fontFamily,
        '--glx-set-size': ca.fontSize,
        '--glx-set-label-weight': ca.fontWeight,
        '--glx-set-title-weight': strong ? getComputedStyle(strong).fontWeight : ca.fontWeight,
        '--glx-set-color': ca.color,
        '--glx-set-desc-size': cb.fontSize,
      };
    }
    return null;
  }

  function applyLayout() {
    for (const k in layout) {
      if (!layout[k]) continue;
      if (panel.style.getPropertyValue(k) !== layout[k]) panel.style.setProperty(k, layout[k]);
    }
  }

  function hideOnly(nodes) {
    for (const n of hiddenNodes) if (!nodes.includes(n)) n.classList.remove('glx-settings-hidden');
    for (const n of nodes) if (!n.classList.contains('glx-settings-hidden')) n.classList.add('glx-settings-hidden');
    hiddenNodes = nodes;
  }

  function ensurePanel(tabs) {
    const content = findContent(tabs.root);
    if (!panel) panel = buildPanel();
    if (!content && hiddenNodes.length === 0 && !panel.isConnected) GL.trace('paramètres', 'contenu de l’onglet de Gmail introuvable');

    if (!scroller || !scroller.isConnected || !content || !content.nodes.some((n) => n.contains(scroller))) {
      scroller = content ? findScroller(content.nodes) : null;
    }
    if (scroller) {
      // Comme l'onglet de Gmail : même zone de défilement, mêmes marges et polices.
      const gmail = [...scroller.children].filter((c) => c !== panel && !c.classList.contains('glx-own'));
      if (gmail.some((c) => !c.classList.contains('glx-settings-hidden') && GL.isVisible(c))) {
        layout = measure(scroller) || layout;
        if (!panel.isConnected || panel.parentElement !== scroller) scroller.scrollTop = 0;
      }
      if (panel.parentElement !== scroller || scroller.firstElementChild !== panel) scroller.prepend(panel);
      hideOnly(gmail);
    } else {
      const anchor = content ? content.anchor : tabs.root;
      if (panel.previousElementSibling !== anchor) anchor.after(panel);
      hideOnly(content ? content.nodes : []);
    }
    if (panel.classList.contains('glx-set-inner') !== !!scroller) panel.classList.toggle('glx-set-inner', !!scroller);
    if (layout) applyLayout();
    fill(panel);
    fitPanel();
  }

  /**
   * Si la zone de défilement de Gmail fait partie de ce qu'on cache, le panneau
   * défile lui-même, dans la hauteur qui reste à l'écran.
   */
  function fitPanel() {
    let bottom = window.innerHeight;
    let scrolls = false;
    for (let p = panel.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
        scrolls = true;
        break;
      }
      if (oy !== 'visible') bottom = Math.min(bottom, p.getBoundingClientRect().bottom);
    }
    const want = scrolls ? '' : Math.max(160, Math.floor(bottom - panel.getBoundingClientRect().top - 8)) + 'px';
    if (panel.style.maxHeight !== want) panel.style.maxHeight = want;
  }

  function closePanel() {
    if (panel && panel.isConnected) panel.remove();
    scroller = null;
    for (const n of hiddenNodes) n.classList.remove('glx-settings-hidden');
    hiddenNodes = [];
  }

  function cleanup() {
    closePanel();
    undim();
    if (tabEl) {
      tabEl.remove();
      tabEl = null;
    }
  }

  function sync() {
    if (!isSettingsView()) {
      if (Date.now() > keepUntil) wanted = false;
      return cleanup();
    }
    const tabs = findTabs();
    if (!tabs) return cleanup();
    if (openRequest) {
      if (Date.now() - openRequest < 30000) {
        wanted = true;
        keepUntil = Date.now() + 3000;
      }
      openRequest = 0;
    }
    ensureTab(tabs);
    dimActive(tabs);
    if (wanted) ensurePanel(tabs);
    else closePanel();
  }

  // Un clic sur un onglet de Gmail referme le nôtre.
  document.addEventListener(
    'click',
    (e) => {
      if (!wanted || !e.target.closest) return;
      const tab = e.target.closest('a[href*="#settings/"], [role="tab"]');
      if (!tab || own(tab)) return;
      wanted = false;
      sync();
    },
    true
  );

  window.addEventListener('hashchange', () => {
    if (Date.now() > keepUntil) wanted = false;
  });

  /** Ouvre l'onglet « Personnalisation » (demandé par l'icône de l'extension). */
  function requestOpen() {
    openRequest = Date.now();
    keepUntil = Date.now() + 5000;
    if (!isSettingsView()) location.hash = '#settings/general';
    GL.schedule(0);
    GL.later(500);
    GL.later(1500);
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'glx-open-settings') {
        requestOpen();
        sendResponse({ ok: true });
      }
    });
    // Nouvel onglet Gmail ouvert par l'icône de l'extension.
    if (isSettingsView()) {
      chrome.storage.local.get('glxOpenSettings', (items) => {
        const at = items && items.glxOpenSettings;
        if (!at) return;
        chrome.storage.local.remove('glxOpenSettings');
        if (Date.now() - at < 30000) requestOpen();
      });
    }
  } catch (err) {
    // extension rechargée : rien à faire
  }

  /** Pour le diagnostic. */
  GL.settingsTabs = () => {
    const tabs = findTabs();
    return { tabs, content: tabs && findContent(tabs.root), open: wanted, ours: tabEl && tabEl.isConnected ? tabEl : null };
  };

  GL.register({ name: 'settings-tab', update: sync });
})();
