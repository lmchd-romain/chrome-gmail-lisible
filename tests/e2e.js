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
    const file = url.pathname.includes('inbox') ? 'inbox.html' : 'thread.html';
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIXTURES, file)) });
  });

  const id = extensionId();
  const popupUrl = `chrome-extension://${id}/popup/popup.html`;

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

  // ---------------- Conversation ----------------
  console.log('\nConversation (avec bouton « Tout développer ») :');
  const thread = await openGmail('https://mail.google.com/mail/u/0/thread#inbox/FMfcgzTEST1');

  await step('tous les messages sont dépliés', async () => {
    await thread.waitForFunction(() => !document.querySelector('#list .kv, #list .kQ'), null, { timeout: 6000 });
    const clicks = await thread.evaluate(() => window.__fake.expandAllClicks);
    assert.equal(clicks, 1, 'un seul clic sur « Tout développer »');
  });

  await step('bouton « Afficher le contenu abrégé » masqué', async () => {
    const display = await thread.evaluate(() => [
      getComputedStyle(document.querySelector('.ajU')).display,
      getComputedStyle(document.querySelector('.ajR')).display,
    ]);
    assert.deepEqual(display, ['none', 'none']);
  });

  await step('noms de pièces jointes masqués, le reste visible', async () => {
    await thread.waitForFunction(() => !document.querySelector('#leftover').innerText.includes('BEAR_Rennes'), null, { timeout: 3000 });
    const text = await thread.evaluate(() => document.querySelector('#leftover').innerText);
    assert.ok(!text.includes('BEAR_Rennes'), 'BEAR_Rennes encore visible : ' + text);
    assert.ok(!text.includes('PastedGraphic'), 'PastedGraphic encore visible');
    for (const keep of ['Fichiers', 'Fin du message', 'jean.dupont@example.com', 'www.example.com']) {
      assert.ok(text.includes(keep), `« ${keep} » doit rester visible`);
    }
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(lines.slice(0, 2), ['Fichiers :', 'Fin du message'], 'pas de ligne vide laissée : ' + JSON.stringify(lines));
    const other = await thread.evaluate(() => document.querySelector('[data-index="2"] .ii.gt').innerText);
    assert.ok(other.includes('garde-moi.pdf'), 'sans contenu abrégé, rien ne doit être masqué');
  });

  await step('réglage « noms de pièces jointes » désactivable à chaud', async () => {
    await thread.evaluate(() => {}); // page prête
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await popup.click('input[data-key="hideAttachmentPlaceholders"]');
    await thread.waitForFunction(() => document.querySelector('#leftover').innerText.includes('BEAR_Rennes'), null, { timeout: 3000 });
    await popup.click('input[data-key="hideAttachmentPlaceholders"]');
    await thread.waitForFunction(() => !document.querySelector('#leftover').innerText.includes('BEAR_Rennes'), null, { timeout: 3000 });
    await popup.close();
  });

  await step('réponse : reste en place tant qu’elle est visible', async () => {
    await thread.click('#reply-btn');
    await thread.waitForSelector('#compose');
    await thread.waitForTimeout(400);
    const floating = await thread.evaluate(() => document.querySelector('#compose').classList.contains('glx-floating'));
    assert.equal(floating, false);
    const dots = await thread.evaluate(() => getComputedStyle(document.querySelector('#compose-dots')).display);
    assert.notEqual(dots, 'none', 'les « ••• » de la zone de rédaction restent visibles');
  });

  await step('réponse : devient flottante quand on remonte', async () => {
    await thread.evaluate(() => (document.getElementById('scroller').scrollTop = 0));
    await thread.waitForFunction(() => document.querySelector('#compose').classList.contains('glx-floating'), null, { timeout: 3000 });
    await thread.waitForTimeout(250);
    const info = await thread.evaluate(() => {
      const c = document.querySelector('#compose');
      const r = c.getBoundingClientRect();
      const s = document.getElementById('scroller').getBoundingClientRect();
      const h = document.querySelector('.glx-float-header');
      const hr = h && h.getBoundingClientRect();
      return {
        position: getComputedStyle(c).position,
        bottomGap: Math.round(innerHeight - r.bottom),
        insideRight: r.right <= s.right && r.right > s.right - 60,
        visible: r.top >= 0 && r.bottom <= innerHeight,
        width: Math.round(r.width),
        headerAbove: hr ? Math.round(r.top - hr.bottom) : null,
        headerText: h ? h.textContent : null,
        hostMinHeight: document.querySelector('.ip.adB').style.minHeight,
      };
    });
    assert.equal(info.position, 'fixed');
    assert.equal(info.bottomGap, 0);
    assert.ok(info.insideRight, 'collée à droite de la conversation');
    assert.ok(info.visible, 'entièrement visible');
    assert.ok(info.width >= 320 && info.width <= 680, 'largeur ' + info.width);
    assert.equal(info.headerAbove, 0, 'barre de titre juste au-dessus');
    assert.ok(/Plans BEAR Rennes/.test(info.headerText), 'titre avec le sujet');
    assert.ok(parseInt(info.hostMinHeight, 10) > 50, 'la place est gardée dans la conversation');
    await shot(thread, 'reponse-flottante');
  });

  await step('réponse flottante : on peut écrire dedans', async () => {
    await thread.click('#editor');
    await thread.keyboard.type('Bonjour, bien reçu.');
    const txt = await thread.evaluate(() => document.getElementById('editor').textContent);
    assert.equal(txt, 'Bonjour, bien reçu.');
  });

  await step('réponse flottante : réduire puis agrandir', async () => {
    await thread.click('.glx-float-header button[aria-label="Réduire"]');
    let display = await thread.evaluate(() => getComputedStyle(document.querySelector('#compose')).display);
    assert.equal(display, 'none');
    const headerBottom = await thread.evaluate(() => Math.round(innerHeight - document.querySelector('.glx-float-header').getBoundingClientRect().bottom));
    assert.equal(headerBottom, 0, 'barre réduite collée en bas');
    await thread.click('.glx-float-header button[aria-label="Agrandir"]');
    display = await thread.evaluate(() => getComputedStyle(document.querySelector('#compose')).display);
    assert.notEqual(display, 'none');
  });

  await step('réponse : reprend sa place en bas de la conversation', async () => {
    await thread.evaluate(() => {
      const s = document.getElementById('scroller');
      s.scrollTop = s.scrollHeight;
    });
    await thread.waitForFunction(() => !document.querySelector('#compose').classList.contains('glx-floating'), null, { timeout: 3000 });
    const state = await thread.evaluate(() => ({
      header: !!document.querySelector('.glx-float-header'),
      minHeight: document.querySelector('.ip.adB').style.minHeight,
      position: getComputedStyle(document.querySelector('#compose')).position,
      text: document.getElementById('editor').textContent,
    }));
    assert.deepEqual(state, { header: false, minHeight: '', position: 'static', text: 'Bonjour, bien reçu.' });
  });

  await step('réponse : bouton « revenir » la remet en place', async () => {
    await thread.evaluate(() => (document.getElementById('scroller').scrollTop = 0));
    await thread.waitForSelector('.glx-float-header');
    await thread.click('.glx-float-header button[aria-label^="Revenir"]');
    await thread.waitForFunction(() => !document.querySelector('#compose').classList.contains('glx-floating'), null, { timeout: 4000 });
  });

  await step('réponse fermée : tout est nettoyé', async () => {
    await thread.evaluate(() => (document.getElementById('scroller').scrollTop = 0));
    await thread.waitForSelector('.glx-float-header');
    await thread.evaluate(() => window.__closeReply());
    await thread.waitForFunction(() => !document.querySelector('.glx-float-header'), null, { timeout: 3000 });
    const minH = await thread.evaluate(() => document.querySelector('[data-index="7"] .ip').style.minHeight);
    assert.equal(minH, '');
  });

  console.log('\nConversation (sans bouton « Tout développer ») :');
  const thread2 = await openGmail('https://mail.google.com/mail/u/0/thread?noExpandAll=1#inbox/FMfcgzTEST2');
  await step('dépliage de secours (bloc caché + messages repliés)', async () => {
    await thread2.waitForFunction(() => !document.querySelector('#list .kv, #list .kQ'), null, { timeout: 8000 });
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

  // ---------------- Boîte de réception ----------------
  console.log('\nBoîte de réception :');
  const inbox = await openGmail('https://mail.google.com/mail/u/0/inbox#inbox');

  function expectedLabels(mode) {
    const now = new Date();
    const ago = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 9);
    const days = [0, 0, 1, 2, 3, 8, 20, 40, 400];
    const labels = [];
    let last = null;
    for (const n of days) {
      const g = D.group(ago(n), now, mode);
      if (!last || last.key !== g.key) labels.push(g.label);
      last = g;
    }
    return labels;
  }

  async function labels(page, section) {
    return page.evaluate((s) => [...document.querySelectorAll(`#${s} .glx-day-sep`)].map((e) => e.textContent), section);
  }

  await step('séparateurs « chaque jour » au bon endroit', async () => {
    await inbox.waitForSelector('#section1 .glx-day-sep');
    await inbox.waitForTimeout(200);
    assert.deepEqual(await labels(inbox, 'section1'), expectedLabels('day'));
    assert.deepEqual(await labels(inbox, 'section2'), ["Aujourd'hui", 'Hier']);
    const firstIsSep = await inbox.evaluate(() => document.querySelector('#section1 tbody').firstElementChild.classList.contains('glx-day-sep'));
    assert.ok(firstIsSep, 'le premier séparateur est en haut (e-mail remis en avant inclus)');
    await shot(inbox, 'separateurs-jour');
  });

  await step('les lignes de Gmail ne sont pas touchées', async () => {
    const info = await inbox.evaluate(() => {
      const tb = document.querySelector('#section1 tbody');
      const sep = tb.querySelector('.glx-day-sep td');
      return { rows: tb.rows.length, sepWidth: Math.round(sep.getBoundingClientRect().width), tableWidth: Math.round(tb.closest('table').getBoundingClientRect().width) };
    });
    assert.equal(info.rows, 10, 'tbody.rows ne compte pas les séparateurs');
    assert.equal(info.sepWidth, info.tableWidth, 'séparateur sur toute la largeur');
  });

  await step('nouvel e-mail et e-mail supprimé : mise à jour', async () => {
    await inbox.evaluate(() => window.__fake.addNewMail());
    await inbox.waitForTimeout(400);
    const top = await inbox.evaluate(() => {
      const tb = document.querySelector('#section1 tbody');
      return [tb.children[0].className.includes('glx-day-sep'), tb.children[1].textContent.includes('Nouveau message')];
    });
    assert.deepEqual(top, [true, true]);
    assert.deepEqual(await labels(inbox, 'section1'), expectedLabels('day'));
    await inbox.evaluate(() => window.__fake.removeRow(1));
    await inbox.waitForTimeout(400);
    const now = await labels(inbox, 'section1');
    assert.ok(!now.includes('Hier'), 'plus de « Hier » sans e-mail d’hier');
  });

  const popup = await context.newPage();
  await popup.goto(popupUrl);

  await step('popup : réglages par défaut affichés', async () => {
    const state = await popup.evaluate(() => ({
      switches: [...document.querySelectorAll('input[data-key]')].map((i) => [i.dataset.key, i.checked]),
      mode: document.querySelector('input[name="daySeparatorMode"]:checked').value,
    }));
    assert.deepEqual(Object.fromEntries(state.switches), {
      autoExpand: true,
      hideTrimmedButton: true,
      hideAttachmentPlaceholders: true,
      floatingReply: true,
      daySeparators: true,
    });
    assert.equal(state.mode, 'day');
    await popup.setViewportSize({ width: 360, height: 640 });
    await shot(popup, 'popup');
  });

  await step('mode « Regrouper » appliqué tout de suite', async () => {
    await inbox.evaluate(() => window.__fake.addNewMail()); // remet une ligne « aujourd'hui » en haut
    await popup.click('input[value="group"] + .mode-body');
    const want = expectedLabels('group').filter((l) => l !== 'Hier');
    await inbox.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('#section1 .glx-day-sep')].map((e) => e.textContent)) === JSON.stringify(w), want, { timeout: 3000 });
    await shot(inbox, 'separateurs-regroupes');
  });

  await step('séparateurs désactivés : tous retirés', async () => {
    await popup.click('input[data-key="daySeparators"]');
    await inbox.waitForFunction(() => !document.querySelector('.glx-day-sep'), null, { timeout: 3000 });
    const disabled = await popup.evaluate(() => document.querySelector('input[value="day"]').disabled);
    assert.equal(disabled, true, 'choix du mode grisé');
    await popup.click('input[data-key="daySeparators"]');
    await inbox.waitForSelector('.glx-day-sep');
  });

  await step('bouton « contenu abrégé » réaffiché si désactivé', async () => {
    const t = await openGmail('https://mail.google.com/mail/u/0/thread#inbox/FMfcgzTEST3');
    await popup.click('input[data-key="hideTrimmedButton"]');
    await t.waitForFunction(() => getComputedStyle(document.querySelector('.ajU')).display !== 'none', null, { timeout: 3000 });
    await popup.click('input[data-key="hideTrimmedButton"]');
    await t.close();
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
