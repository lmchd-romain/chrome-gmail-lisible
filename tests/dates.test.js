// Tests de lecture des dates et des groupes de séparateurs : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/content/dates.js');

const NOW = new Date(2026, 10, 6, 14, 0); // vendredi 6 novembre 2026

function ymd(d) {
  return d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null;
}

test('lit les formats de date de Gmail', () => {
  const cases = [
    ['ven. 6 nov. 2026, 10:05', 'fr', '2026-11-6'],
    ['mar. 4 nov. 2026 à 09:12', 'fr', '2026-11-4'],
    ['mar. 3 mars 2026', 'fr', '2026-3-3'],
    ['dim. 1 févr. 2026, 08:00', 'fr', '2026-2-1'],
    ['1er janv. 2026', 'fr', '2026-1-1'],
    ['jeu. 13 août 2026, 18:40', 'fr', '2026-8-13'],
    ['Thu, Dec 18, 2014 at 12:35 PM', 'en', '2014-12-18'],
    ['Thu, Nov 6, 2026, 10:05 AM', 'en', '2026-11-6'],
    ['Tue, Mar 3, 2026, 9:00 AM', 'en', '2026-3-3'],
    ['Thu, Nov 6, 2026, 10:05 AM (2 days ago)', 'en', '2026-11-6'],
    ['06/11/2025 10:05', 'fr', '2025-11-6'],
    ['11/06/2025', 'en', '2025-11-6'],
    ['2026-10-01 08:00', 'fr', '2026-10-1'],
    ['Do., 6. Nov. 2026, 10:05', 'de', '2026-11-6'],
    ['mar, 3 mar 2026, 10:05', 'es', '2026-3-3'],
  ];
  for (const [text, lang, expected] of cases) {
    assert.equal(ymd(D.parse(text, lang, NOW)), expected, text);
  }
});

test('lit le texte court de la liste (heure, jour sans année)', () => {
  assert.equal(ymd(D.parseShort('10:05', 'fr', NOW)), '2026-11-6');
  assert.equal(ymd(D.parseShort('6 nov.', 'fr', NOW)), '2026-11-6');
  assert.equal(ymd(D.parseShort('28 déc.', 'fr', NOW)), '2025-12-28'); // pas dans le futur
  assert.equal(D.parseShort('', 'fr', NOW), null);
  assert.equal(D.parse('n/a', 'fr', NOW), null);
  assert.equal(D.parse('12', 'fr', NOW), null);
});

test('groupes « chaque jour »', () => {
  const label = (daysAgo) => D.group(new Date(2026, 10, 6 - daysAgo, 9), NOW, 'day').label;
  assert.equal(label(0), "Aujourd'hui");
  assert.equal(label(1), 'Hier');
  assert.equal(label(2), '04/11');
  assert.equal(label(8), '29/10');
  assert.equal(label(400), '02/10/2025');
  assert.equal(D.group(new Date(2026, 10, 7), NOW, 'day').label, "Aujourd'hui"); // futur (horloge décalée)
});

test('groupes « regrouper » (semaine commençant le lundi)', () => {
  const label = (daysAgo) => D.group(new Date(2026, 10, 6 - daysAgo, 9), NOW, 'group').label;
  assert.equal(label(0), "Aujourd'hui");
  assert.equal(label(1), 'Hier');
  assert.equal(label(2), 'Cette semaine'); // mer. 4
  assert.equal(label(4), 'Cette semaine'); // lun. 2
  assert.equal(label(5), 'Semaine dernière'); // dim. 1
  assert.equal(label(11), 'Semaine dernière'); // lun. 26 oct.
  assert.equal(label(12), 'Octobre');
  assert.equal(label(40), 'Septembre');
  assert.equal(label(400), 'Octobre 2025');

  // Milieu de mois : « Plus tôt ce mois-ci »
  const mid = new Date(2026, 10, 25, 12); // mercredi 25 novembre
  assert.equal(D.group(new Date(2026, 10, 3), mid, 'group').label, 'Plus tôt ce mois-ci');
  // Lundi : « Hier » = dimanche, puis « Semaine dernière »
  const monday = new Date(2026, 10, 9, 12);
  assert.equal(D.group(new Date(2026, 10, 8), monday, 'group').label, 'Hier');
  assert.equal(D.group(new Date(2026, 10, 7), monday, 'group').label, 'Semaine dernière');
});
