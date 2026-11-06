/*
 * Test de bout en bout : charge la vraie extension dans Chromium et remplace
 * mail.google.com par de fausses pages Gmail (tests/fixtures).
 *
 *   node tests/e2e.js            (SHOTS=dossier pour enregistrer des captures)
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../extension/content/dates.js');

const EXT = path.resolve(__dirname, '..', 'extension');
const FIXTURES = path.resolve(__dirname, 'fixtures');
const SHOTS = process.env.SHOTS || '';

function extensionId() {
  const key = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).key;
  const hash = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['OK ', name]);
    console.log('  ✔', name);
  } catch (err) {
    results.push(['ÉCHEC', name]);
    console.log('  ✘', name, '\n     ', String(err && err.message).split('\n').join('\n      '));
  }
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glx-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const errors = [];

  await context.route('https://mail.google.com/**', (route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.includes('inbox') ? 'inbox.html' : url.pathname.includes('history') ? 'history.html' : 'thread.html';
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIXTURES, file)) });
  });

  const id = extensionId();
  const popupUrl = `chrome-extension://${id}/popup/popup.html`;
  const popup = await context.newPage();
  await popup.goto(popupUrl);

  async function setOption(key, value) {
    await popup.evaluate(([k, v]) => chrome.storage.sync.set({ [k]: v }), [key, value]);
    await new Promise((r) => setTimeout(r, 250));
  }

  async function openGmail(url) {
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-glx-loaded'), null, { timeout: 5000 });
    return page;
  }

  const scrollTo = (page, where) =>
    page.evaluate((w) => {
      const s = document.getElementById('scroller');
      s.scrollTop = w === 'top' ? 0 : s.scrollHeight;
    }, where);

  // ---------------- Conversation ----------------
  console.log('\nConversation :');
  const thread = await openGmail('https://mail.google.com/mail/u/0/thread?delayRender=1#inbox/FMfcgzTEST1');

  await step('tous les messages dépliés, sans « flash » des messages repliés', async () => {
    await thread.waitForFunction(() => document.getElementById('list') && !document.querySelector('#list .kv, #list .kQ'), null, { timeout: 6000 });
    const f = await thread.evaluate(() => window.__fake);
    assert.equal(f.expandAllClicks, 1, 'un seul clic sur « Tout développer »');
    assert.equal(f.flashSeen, false, 'aucune image affichée avec des messages repliés');
  });

  await step('bouton « Afficher le contenu abrégé » masqué', async () => {
    const display = await thread.evaluate(() => [
      getComputedStyle(document.querySelector('.ajU')).display,
      getComputedStyle(document.querySelector('[data-index="6"] .ajR')).display,
    ]);
    assert.deepEqual(display, ['none', 'none']);
  });

  await step('noms de fichiers masqués (sous le bouton et cas de la capture)', async () => {
    await thread.waitForFunction(() => !document.querySelector('#leftover').innerText.includes('BEAR_Rennes'), null, { timeout: 3000 });
    const text = await thread.evaluate(() => document.querySelector('#leftover').innerText);
    assert.ok(!text.includes('PastedGraphic'), 'PastedGraphic encore visible');
    for (const keep of ['Fichiers', 'Fin du message', 'jean.dupont@example.com', 'www.example.com']) {
      assert.ok(text.includes(keep), `« ${keep} » doit rester visible`);
    }
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(lines.slice(0, 2), ['Fichiers :', 'Fin du message'], 'pas de ligne vide : ' + JSON.stringify(lines));
    const last = await thread.evaluate(() => document.querySelector('[data-index="7"] .ii.gt').innerText);
    assert.ok(!last.includes('BEAR_Rennes'), 'cas de la capture encore visible : ' + last);
    assert.ok(last.includes('Merci !') && last.includes('Amandine'), 'le reste du message reste visible');
    const other = await thread.evaluate(() => document.querySelector('[data-index="2"] .ii.gt').innerText);
    assert.ok(other.includes('garde-moi.pdf'), 'un nom de fichier dans une phrase normale reste visible');
  });

  await step('réglage « noms de fichiers » désactivable à chaud', async () => {
    await setOption('hideAttachmentPlaceholders', false);
    const body7 = () => document.querySelector('[data-index="6"] .ii.gt').innerText;
    await thread.waitForFunction((f) => eval(f)().includes('BEAR_Rennes'), body7.toString(), { timeout: 3000 });
    await setOption('hideAttachmentPlaceholders', true);
    await thread.waitForFunction((f) => !eval(f)().includes('BEAR_Rennes'), body7.toString(), { timeout: 3000 });
  });

  await step('pièces jointes compactes au-dessus du message', async () => {
    const info = await thread.evaluate(() => {
      const msg = document.querySelector('[data-index="0"]');
      const bar = msg.querySelector('.glx-att-bar');
      return {
        bar: !!bar,
        beforeBody: bar && bar.nextElementSibling === msg.querySelector('div.ii.gt'),
        compact: bar && bar.classList.contains('glx-att-compact'),
        items: bar ? bar.querySelectorAll('.glx-att-item').length : 0,
        head: bar ? bar.querySelector('.glx-att-head').textContent : '',
        nativeHidden: getComputedStyle(msg.querySelector('.hq')).display === 'none',
        thumbs: bar ? bar.querySelectorAll('img.glx-att-thumb, .glx-att-thumb').length : -1,
      };
    });
    assert.deepEqual(info, {
      bar: true,
      beforeBody: true,
      compact: true,
      items: 2,
      head: '2 pièces jointesTout télécharger',
      nativeHidden: true,
      thumbs: 0,
    });
  });

  await step('pièces jointes : aperçu, téléchargement, Drive, tout télécharger', async () => {
    const bar = '[data-index="0"] .glx-att-bar';
    await thread.click(`${bar} .glx-att-item:nth-child(1) .glx-att-name`);
    await thread.click(`${bar} .glx-att-item:nth-child(1) [aria-label="Télécharger"]`);
    await thread.click(`${bar} .glx-att-item:nth-child(2) [aria-label="Ajouter à Drive"]`);
    await thread.click(`${bar} .glx-att-all`);
    await thread.waitForTimeout(300);
    const f = await thread.evaluate(() => window.__fake);
    assert.deepEqual(f.previews, ['BEAR_Rennes_6mm.pdf']);
    assert.deepEqual(f.downloads, ['BEAR_Rennes_6mm.pdf']);
    assert.deepEqual(f.drive, ['BEAR_Rennes_6mm.dxf']);
    assert.equal(f.downloadAll, 1);
    const collapsed = await thread.evaluate(() => document.querySelector('[data-index="0"]').className);
    assert.equal(collapsed, 'h7', 'le message reste ouvert');
  });

  await step('toutes les pièces jointes regroupées en haut', async () => {
    const info = await thread.evaluate(() => {
      const p = document.querySelector('.glx-att-summary');
      return p && {
        beforeList: p.nextElementSibling === document.getElementById('list'),
        title: p.querySelector('.glx-att-summary-title').textContent,
        rows: [...p.querySelectorAll('.glx-att-item')].map((r) => r.querySelector('.glx-att-label').textContent + ' | ' + (r.querySelector('.glx-att-meta') || {}).textContent),
      };
    });
    assert.ok(info, 'récapitulatif absent');
    assert.equal(info.beforeList, true);
    assert.equal(info.title, '5 pièces jointes dans cette conversation');
    assert.equal(info.rows.length, 5);
    assert.ok(info.rows[0].startsWith('BEAR_Rennes_6mm.pdf') && info.rows[0].includes('×2'), 'doublon compté et en premier : ' + info.rows.join(' / '));
    assert.ok(info.rows.every((r) => / · 04\/11/.test(r)), 'expéditeur et date : ' + info.rows.join(' / '));
    const geo = await thread.evaluate(() => {
      const p = document.querySelector('.glx-att-summary').getBoundingClientRect();
      const c = document.querySelector('.h7 .gs').getBoundingClientRect();
      return { dx: Math.round(p.left - c.left), width: Math.round(p.width) };
    });
    assert.equal(geo.dx, 0, 'aligné sur le texte des messages');
    assert.ok(geo.width <= 640, 'largeur ' + geo.width);
    await thread.click('.glx-att-summary .glx-att-item:nth-child(1) [aria-label="Voir le message"]');
    await thread.waitForFunction(() => !!document.querySelector('.glx-flash'), null, { timeout: 2000 });
    await thread.click('.glx-att-summary-head');
    await thread.waitForFunction(() => document.querySelector('.glx-att-summary').classList.contains('is-closed'), null, { timeout: 2000 });
    await thread.click('.glx-att-summary-head');
    await shot(thread, 'pieces-jointes');
  });

  await step('pièces jointes : réglages (aperçu, position, récapitulatif)', async () => {
    await setOption('attachmentsCompact', false);
    await thread.waitForFunction(() => document.querySelector('[data-index="0"] .glx-att-bar.glx-att-cards .glx-att-thumb img'), null, { timeout: 3000 });
    await setOption('attachmentsOnTop', false);
    await thread.waitForFunction(() => !document.querySelector('[data-index="0"] .glx-att-bar') && getComputedStyle(document.querySelector('[data-index="0"] .hq')).display !== 'none', null, { timeout: 3000 });
    await setOption('attachmentsCompact', true);
    await thread.waitForFunction(() => {
      const bar = document.querySelector('[data-index="0"] .glx-att-bar');
      return bar && bar.nextElementSibling === document.querySelector('[data-index="0"] .hq');
    }, null, { timeout: 3000 });
    await setOption('attachmentsOnTop', true);
    await setOption('attachmentsSummary', false);
    await thread.waitForFunction(() => !document.querySelector('.glx-att-summary'), null, { timeout: 3000 });
    await setOption('attachmentsSummary', true);
    await thread.waitForSelector('.glx-att-summary');
  });

  await step('réponse : « ••• » masqué aussi pendant la rédaction', async () => {
    await thread.click('#reply-btn');
    await thread.waitForSelector('#compose');
    const dots = await thread.evaluate(() => [getComputedStyle(document.querySelector('#compose-dots')).display, getComputedStyle(document.querySelector('#dots-wrap')).display]);
    assert.deepEqual(dots, ['none', 'none'], 'ni les points ni leur espace vide');
  });

  await step('réponse : passe dans la fenêtre pop-up de Gmail quand on remonte', async () => {
    await thread.waitForTimeout(300);
    assert.equal(await thread.evaluate(() => !!document.getElementById('popup')), false, 'pas de pop-up tant que la réponse est visible');
    await scrollTo(thread, 'top');
    await thread.waitForSelector('#popup', { timeout: 3000 });
    const state = await thread.evaluate(() => ({ inline: !!document.querySelector('.ip.adB'), popouts: window.__fake.popouts }));
    assert.deepEqual(state, { inline: false, popouts: 1 });
    await shot(thread, 'reponse-popup');
  });

  await step('pop-up : on écrit, puis elle reprend sa place tout en bas (brouillon rouvert)', async () => {
    await thread.click('#popup #editor');
    await thread.keyboard.type('Bonjour, bien reçu.');
    await thread.waitForTimeout(1300);
    await scrollTo(thread, 'bottom');
    await thread.waitForFunction(() => !document.getElementById('popup') && window.__fake.draftReopened && document.querySelector('.ip.adB #editor'), null, { timeout: 6000 });
    const text = await thread.evaluate(() => document.querySelector('.ip.adB #editor').textContent);
    assert.equal(text, 'Bonjour, bien reçu.');
  });

  await step('pop-up vide : une réponse vide se rouvre en bas', async () => {
    await thread.evaluate(() => window.__closeReply());
    await thread.click('#reply-btn');
    await thread.waitForSelector('.ip.adB #compose');
    await thread.waitForTimeout(1700);
    await scrollTo(thread, 'top');
    await thread.waitForSelector('#popup', { timeout: 3000 });
    await thread.waitForTimeout(1300);
    await scrollTo(thread, 'bottom');
    await thread.waitForFunction(() => !document.getElementById('popup') && document.querySelector('.ip.adB #compose'), null, { timeout: 5000 });
    const text = await thread.evaluate(() => document.querySelector('.ip.adB #editor').textContent);
    assert.equal(text, '');
  });

  await step('« la remettre en place » désactivé : la pop-up reste', async () => {
    await setOption('dockReplyAtBottom', false);
    await thread.waitForTimeout(1700);
    await scrollTo(thread, 'top');
    await thread.waitForSelector('#popup', { timeout: 3000 });
    await thread.waitForTimeout(1300);
    await scrollTo(thread, 'bottom');
    await thread.waitForTimeout(1500);
    assert.equal(await thread.evaluate(() => !!document.getElementById('popup')), true);
    await setOption('dockReplyAtBottom', true);
  });
  await thread.close();

  console.log('\nConversation (dépliage lent) :');
  const slow = await openGmail('https://mail.google.com/mail/u/0/thread?delayRender=1&asyncExpand=1#inbox/FMfcgzTEST4');
  await step('conversation masquée le temps du dépliage, puis affichée', async () => {
    await slow.waitForSelector('#list');
    await slow.waitForTimeout(120);
    const during = await slow.evaluate(() => ({ cls: document.getElementById('list').classList.contains('glx-expanding'), op: getComputedStyle(document.getElementById('list')).opacity }));
    assert.deepEqual(during, { cls: true, op: '0' });
    await slow.waitForFunction(() => !document.querySelector('#list .kv, #list .kQ'), null, { timeout: 4000 });
    await slow.waitForFunction(() => getComputedStyle(document.getElementById('list')).opacity === '1', null, { timeout: 2000 });
    assert.equal(await slow.evaluate(() => window.__fake.flashSeen), false);
  });
  await slow.close();

  console.log('\nConversation (sans bouton « Tout développer ») :');
  const thread2 = await openGmail('https://mail.google.com/mail/u/0/thread?noExpandAll=1&delayRender=1#inbox/FMfcgzTEST2');
  await step('dépliage de secours (bloc caché + messages repliés)', async () => {
    await thread2.waitForFunction(() => document.getElementById('list') && !document.querySelector('#list .kv, #list .kQ'), null, { timeout: 8000 });
    const f = await thread2.evaluate(() => window.__fake);
    assert.ok(f.noticeClicks >= 1, 'clic sur « messages plus anciens »');
    assert.ok(f.headerClicks >= 3, 'clic sur chaque message replié');
  });

  await step('message replié par l’utilisateur après coup : reste replié', async () => {
    await thread2.evaluate(() => {
      const m = document.querySelector('[data-index="1"]');
      m.classList.remove('h7');
      m.classList.add('kv');
    });
    await thread2.waitForTimeout(4000);
    const still = await thread2.evaluate(() => document.querySelector('[data-index="1"]').classList.contains('kv'));
    assert.equal(still, true);
  });
  await thread2.close();

  // ---------------- Historique recopié et signatures ----------------
  console.log('\nHistorique recopié :');
  const hist = await openGmail('https://mail.google.com/mail/u/0/history#inbox/FMfcgzHIST');
  const bodyText = (page, i) => page.evaluate((n) => document.querySelector(`[data-index="${n}"] .ii.gt`).innerText, i);
  const count = (text, word) => (text.match(new RegExp(word, 'g')) || []).length;

  await step('anciens messages recopiés masqués quand ils sont déjà plus haut', async () => {
    await hist.waitForFunction(() => !!document.querySelector('.glx-quote-hidden'), null, { timeout: 4000 });
    const t = await Promise.all([0, 1, 2, 3, 4].map((i) => bodyText(hist, i)));
    assert.ok(t[0].includes('Bonjour Yves'), 'le 1er message reste entier');
    assert.ok(t[1].includes('A rajouter') && !t[1].includes('Bonjour Yves') && !t[1].includes('a écrit'), 'message 2 : ' + t[1]);
    assert.ok(t[2].includes('supplémentaires') && !t[2].includes('A rajouter') && !t[2].includes('Bonjour Yves'), 'message 3 : ' + t[2]);
    assert.ok(t[3].includes('Bien reçu') && !t[3].includes('supplémentaires') && !t[3].includes('Envoyé'), 'message Outlook : ' + t[3]);
    assert.ok(t[4].includes('Tarifs 2027'), 'un transfert jamais reçu reste visible');
    for (const i of [0, 1, 2]) assert.equal(count(t[i], 'Thomas FERNANDEZ'), 1, 'une signature dans le message ' + i);
    await shot(hist, 'historique');
  });

  await step('réglage « historique » désactivable à chaud', async () => {
    await setOption('hideQuotedHistory', false);
    await hist.waitForFunction(() => document.querySelector('[data-index="1"] .ii.gt').innerText.includes('Bonjour Yves'), null, { timeout: 3000 });
    await setOption('hideQuotedHistory', true);
    await hist.waitForFunction(() => !document.querySelector('[data-index="1"] .ii.gt').innerText.includes('Bonjour Yves'), null, { timeout: 3000 });
  });
  await hist.close();

  const single = await openGmail('https://mail.google.com/mail/u/0/history?single=1#inbox/FMfcgzHIST2');
  await step('historique jamais reçu : affiché même si Gmail l’a caché, une seule signature', async () => {
    await single.waitForFunction(() => document.querySelector('[data-index="0"] .ii.gt').innerText.includes('Bonjour Yves'), null, { timeout: 4000 });
    const t = await bodyText(single, 0);
    assert.ok(t.includes('A rajouter') && t.includes('supplémentaires'), 'toute la commande est visible');
    assert.equal(count(t, 'Thomas FERNANDEZ'), 1, 'signatures empilées : ' + count(t, 'Thomas FERNANDEZ'));
    await shot(single, 'historique-jamais-recu');
  });

  await step('réglage « une seule signature » désactivable à chaud', async () => {
    await setOption('hideRepeatedSignatures', false);
    await single.waitForFunction(() => (document.querySelector('[data-index="0"] .ii.gt').innerText.match(/Thomas FERNANDEZ/g) || []).length === 3, null, { timeout: 3000 });
    await setOption('hideRepeatedSignatures', true);
    await single.waitForFunction(() => (document.querySelector('[data-index="0"] .ii.gt').innerText.match(/Thomas FERNANDEZ/g) || []).length === 1, null, { timeout: 3000 });
  });
  await single.close();

  // ---------------- Boîte de réception ----------------
  console.log('\nBoîte de réception :');
  const inbox = await openGmail('https://mail.google.com/mail/u/0/inbox#inbox');

  function expectedLabels(mode, days) {
    const now = new Date();
    const ago = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 9);
    const labels = [];
    let last = null;
    for (const n of days) {
      const g = D.group(ago(n), now, mode);
      if (!last || last.key !== g.key) labels.push(g.label);
      last = g;
    }
    return labels;
  }
  const PAGE1 = [0, 0, 1, 2, 3, 8, 20, 40, 400];

  async function labels(page, section) {
    return page.evaluate((s) => [...document.querySelectorAll(`#${s} .glx-day-sep`)].map((e) => e.textContent), section);
  }

  await step('séparateurs « chaque jour » au bon endroit', async () => {
    await inbox.waitForSelector('#section1 .glx-day-sep');
    await inbox.waitForTimeout(200);
    assert.deepEqual(await labels(inbox, 'section1'), expectedLabels('day', PAGE1));
    assert.deepEqual(await labels(inbox, 'section2'), ["Aujourd'hui", 'Hier']);
    const firstIsSep = await inbox.evaluate(() => document.querySelector('#section1 tbody').firstElementChild.classList.contains('glx-day-sep'));
    assert.ok(firstIsSep, 'le premier séparateur est en haut (e-mail remis en avant inclus)');
    await shot(inbox, 'separateurs-jour');
  });

  await step('pas de séparateurs dans « Messages suivis »', async () => {
    assert.deepEqual(await labels(inbox, 'section0'), []);
  });

  await step('séparateurs compacts, lignes de Gmail intactes', async () => {
    const info = await inbox.evaluate(() => {
      const tb = document.querySelector('#section1 tbody');
      const sep = [...tb.querySelectorAll('.glx-day-sep td')][1];
      return {
        rows: tb.rows.length,
        sepWidth: Math.round(sep.getBoundingClientRect().width),
        tableWidth: Math.round(tb.closest('table').getBoundingClientRect().width),
        sepHeight: Math.round(sep.getBoundingClientRect().height),
      };
    });
    assert.equal(info.rows, 10, 'tbody.rows ne compte pas les séparateurs');
    assert.equal(info.sepWidth, info.tableWidth, 'séparateur sur toute la largeur');
    assert.ok(info.sepHeight >= 22 && info.sepHeight <= 28, 'hauteur ' + info.sepHeight);
  });

  await step('nouvel e-mail et e-mail supprimé : mise à jour', async () => {
    await inbox.evaluate(() => window.__fake.addNewMail());
    await inbox.waitForTimeout(400);
    const top = await inbox.evaluate(() => {
      const tb = document.querySelector('#section1 tbody');
      return [tb.children[0].className.includes('glx-day-sep'), tb.children[1].textContent.includes('Nouveau message')];
    });
    assert.deepEqual(top, [true, true]);
    assert.deepEqual(await labels(inbox, 'section1'), expectedLabels('day', PAGE1));
    await inbox.evaluate(() => window.__fake.removeRow(1));
    await inbox.waitForTimeout(400);
    assert.ok(!(await labels(inbox, 'section1')).includes('Hier'), 'plus de « Hier » sans e-mail d’hier');
  });

  await step('popup : réglages par défaut affichés', async () => {
    await popup.reload();
    const state = await popup.evaluate(() => ({
      switches: [...document.querySelectorAll('input[data-key]')].map((i) => [i.dataset.key, i.checked]),
      mode: document.querySelector('input[name="daySeparatorMode"]:checked').value,
    }));
    assert.deepEqual(Object.fromEntries(state.switches), {
      autoExpand: true,
      hideTrimmedButton: true,
      hideQuotedHistory: true,
      hideRepeatedSignatures: true,
      hideAttachmentPlaceholders: true,
      floatingReply: true,
      dockReplyAtBottom: true,
      attachmentsOnTop: true,
      attachmentsCompact: true,
      attachmentsSummary: true,
      infiniteScroll: true,
      daySeparators: true,
    });
    assert.equal(state.mode, 'day');
    await popup.setViewportSize({ width: 360, height: 980 });
    await shot(popup, 'popup');
  });

  await step('mode « Regrouper » appliqué tout de suite', async () => {
    await popup.click('input[value="group"] + .mode-body');
    const want = expectedLabels('group', [0, 0, 2, 3, 8, 20, 40, 400]);
    await inbox.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('#section1 .glx-day-sep')].map((e) => e.textContent)) === JSON.stringify(w), want, { timeout: 3000 });
    await shot(inbox, 'separateurs-regroupes');
    await popup.click('input[value="day"] + .mode-body');
  });

  await step('séparateurs désactivés : tous retirés', async () => {
    await popup.click('input[data-key="daySeparators"]');
    await inbox.waitForFunction(() => !document.querySelector('.glx-day-sep'), null, { timeout: 3000 });
    assert.equal(await popup.evaluate(() => document.querySelector('input[value="day"]').disabled), true, 'choix du mode grisé');
    await popup.click('input[data-key="daySeparators"]');
    await inbox.waitForSelector('.glx-day-sep');
  });

  await step('défilement continu : page suivante puis précédente', async () => {
    await inbox.bringToFront();
    await inbox.mouse.move(800, 500);
    await scrollTo(inbox, 'bottom');
    await inbox.waitForTimeout(100);
    for (let i = 0; i < 10 && (await inbox.evaluate(() => window.__fake.page)) === 1; i++) {
      await inbox.mouse.wheel(0, 120);
      await inbox.waitForTimeout(90);
    }
    await inbox.waitForFunction(() => window.__fake.page === 2, null, { timeout: 3000 });
    await inbox.waitForTimeout(300);
    assert.equal(await inbox.evaluate(() => document.getElementById('scroller').scrollTop), 0, 'page suivante affichée depuis le haut');
    await inbox.waitForTimeout(1600);
    for (let i = 0; i < 10 && (await inbox.evaluate(() => window.__fake.page)) === 2; i++) {
      await inbox.mouse.wheel(0, -120);
      await inbox.waitForTimeout(90);
    }
    await inbox.waitForFunction(() => window.__fake.page === 1, null, { timeout: 3000 });
    await inbox.waitForTimeout(300);
    // (les derniers crans de molette continuent de faire remonter un peu : c'est voulu)
    const fromBottom = await inbox.evaluate(() => {
      const s = document.getElementById('scroller');
      return s.scrollHeight - s.scrollTop - s.clientHeight;
    });
    assert.ok(fromBottom <= 400, 'en remontant, on arrive en bas de la page précédente (' + fromBottom + ' px du bas)');
  });

  await step('défilement continu sans libellés de boutons (adresse #inbox/p2)', async () => {
    const plain = await openGmail('https://mail.google.com/mail/u/0/inbox?nolabels=1#inbox');
    await plain.bringToFront();
    await plain.waitForSelector('.glx-day-sep');
    await plain.mouse.move(800, 500);
    await scrollTo(plain, 'bottom');
    await plain.waitForTimeout(100);
    for (let i = 0; i < 10 && (await plain.evaluate(() => window.__fake.page)) === 1; i++) {
      await plain.mouse.wheel(0, 120);
      await plain.waitForTimeout(90);
    }
    await plain.waitForFunction(() => window.__fake.page === 2 && location.hash === '#inbox/p2', null, { timeout: 4000 });
    await plain.close();
  });

  await step('diagnostic copié, sans contenu personnel', async () => {
    await popup.evaluate(() => {
      navigator.clipboard.writeText = async (t) => {
        window.__copied = t;
      };
    });
    await popup.click('#diag');
    await popup.waitForFunction(() => !!window.__copied, null, { timeout: 4000 });
    const text = await popup.evaluate(() => window.__copied);
    assert.ok(text.startsWith('# Diagnostic Gmail Lisible'), text.slice(0, 80));
    assert.ok(text.includes('Listes d’e-mails') && text.includes('Plus anciens'), 'structure et boutons de Gmail inclus');
    for (const secret of ['Devis atelier', 'x@example.com', 'Commande bois']) {
      assert.ok(!text.includes(secret), 'contenu personnel présent : ' + secret);
    }
  });

  await step('aucune erreur dans la console', async () => {
    const own = errors.filter((e) => /Gmail Lisible|glx/i.test(e));
    assert.deepEqual(own, []);
  });

  await context.close();
  const failed = results.filter((r) => r[0] !== 'OK ');
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
