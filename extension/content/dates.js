/*
 * Lecture des dates affichées par Gmail et calcul des groupes
 * (« Aujourd'hui », « Hier », « 04/11 », « Cette semaine »…).
 * Fonctions pures : utilisables dans Gmail et dans les tests Node.
 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;

  // Noms de mois (sans accents, minuscules) -> index 0..11, plusieurs langues.
  const MONTH_WORDS = [
    // janvier
    ['janvier', 'janv', 'jan', 'january', 'enero', 'ene', 'januar', 'janner', 'gennaio', 'gen', 'janeiro', 'januari'],
    // février
    ['fevrier', 'fevr', 'fev', 'february', 'feb', 'febrero', 'februar', 'febbraio', 'fevereiro', 'februari'],
    // mars
    ['mars', 'march', 'mar', 'marzo', 'marz', 'mrz', 'marco', 'maart', 'mrt'],
    // avril
    ['avril', 'avr', 'april', 'apr', 'abril', 'abr', 'aprile'],
    // mai
    ['mai', 'may', 'mayo', 'maggio', 'mag', 'maio', 'mei'],
    // juin
    ['juin', 'june', 'jun', 'junio', 'juni', 'giugno', 'giu', 'junho'],
    // juillet
    ['juillet', 'juil', 'july', 'jul', 'julio', 'juli', 'luglio', 'lug', 'julho'],
    // août
    ['aout', 'august', 'aug', 'agosto', 'ago', 'augustus'],
    // septembre
    ['septembre', 'sept', 'september', 'sep', 'septiembre', 'setiembre', 'settembre', 'set', 'setembro'],
    // octobre
    ['octobre', 'oct', 'october', 'octubre', 'oktober', 'okt', 'ottobre', 'ott', 'outubro', 'out'],
    // novembre
    ['novembre', 'nov', 'november', 'noviembre', 'novembro'],
    // décembre
    ['decembre', 'dec', 'december', 'diciembre', 'dic', 'dezember', 'dez', 'dicembre', 'dezembro'],
  ];

  const MONTHS = Object.create(null);
  MONTH_WORDS.forEach((words, index) => words.forEach((w) => (MONTHS[w] = index)));

  const MONTH_NAMES_FR = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];

  const TIME_RE = /\b\d{1,2}[:h]\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\b\.?)?/gi;

  function normalize(str) {
    return String(str)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function makeDate(year, month, day) {
    if (!(month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 1970 && year <= 2200)) return null;
    const d = new Date(year, month, day);
    if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
    return d;
  }

  // Sans année affichée, on prend l'année en cours (ou la précédente si la date serait dans le futur).
  function withGuessedYear(month, day, now) {
    let d = makeDate(now.getFullYear(), month, day);
    if (d && d.getTime() - now.getTime() > 2 * DAY_MS) d = makeDate(now.getFullYear() - 1, month, day);
    return d;
  }

  // Langues où le mois s'écrit avant le jour en format numérique (11/06/2026).
  function isMonthFirst(lang) {
    const l = String(lang || '').toLowerCase();
    return l === 'en' || l === 'en-us' || l === 'en-ph';
  }

  /**
   * Transforme le texte d'une date Gmail en objet Date (jour seulement).
   * Exemples : « jeu. 6 nov. 2026, 10:05 », « Thu, Nov 6, 2026 at 10:05 AM », « 06/11/2026 ».
   */
  function parse(str, lang, now) {
    if (!str) return null;
    now = now || new Date();
    // On retire l'heure et les mentions entre parenthèses (« (il y a 2 jours) »).
    const s = normalize(str).replace(/\([^)]*\)/g, ' ').replace(TIME_RE, ' ');

    let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return makeDate(+m[1], +m[2] - 1, +m[3]);

    m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) {
      let a = +m[1];
      let b = +m[2];
      let year = +m[3];
      if (year < 100) year += 2000;
      let day = a;
      let month = b;
      if (isMonthFirst(lang)) {
        day = b;
        month = a;
      }
      if (month > 12 && day <= 12) [day, month] = [month, day];
      return makeDate(year, month - 1, day);
    }

    const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
    let monthIndex = -1;
    let month = -1;
    let year = null;
    tokens.forEach((t, i) => {
      if (/^\d{4}$/.test(t)) year = +t;
      else if (t in MONTHS) {
        // Le dernier mot-mois l'emporte (« mar. 4 nov. » : « mar » = mardi).
        monthIndex = i;
        month = MONTHS[t];
      }
    });

    if (month >= 0) {
      let day = null;
      let best = Infinity;
      tokens.forEach((t, i) => {
        const dm = t.match(/^(\d{1,2})(?:er|e|st|nd|rd|th)?$/);
        if (!dm) return;
        const dist = Math.abs(i - monthIndex);
        if (dist < best) {
          best = dist;
          day = +dm[1];
        }
      });
      if (day === null) return null;
      return year !== null ? makeDate(year, month, day) : withGuessedYear(month, day, now);
    }

    if (!/\d{4}/.test(s)) return null;
    const fallback = new Date(String(str).replace(/\s(at|à|um|a las|alle|às|om)\s/i, ' '));
    if (isNaN(fallback)) return null;
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  /** Lecture du texte court affiché dans la liste (« 10:05 », « 6 nov. », « 06/11/2025 »). */
  function parseShort(text, lang, now) {
    if (!text) return null;
    now = now || new Date();
    const t = String(text).trim();
    if (/^\d{1,2}[:h]\d{2}(\s*[ap]\.?\s?m\.?)?$/i.test(t)) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    return parse(t, lang, now);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Groupe d'une date pour les séparateurs.
   * mode 'day'   : Aujourd'hui, Hier, 04/11, 03/11, …
   * mode 'group' : Aujourd'hui, Hier, Cette semaine, Semaine dernière, Plus tôt ce mois-ci, Octobre, …
   */
  function group(date, now, mode) {
    now = now || new Date();
    const today = startOfDay(now);
    const day = startOfDay(date);
    const diff = Math.round((today - day) / DAY_MS);

    if (diff <= 0) return { key: 'today', label: "Aujourd'hui" };
    if (diff === 1) return { key: 'yesterday', label: 'Hier' };

    const y = day.getFullYear();
    const m = day.getMonth();
    const d = day.getDate();

    if (mode !== 'group') {
      const label = pad(d) + '/' + pad(m + 1) + (y !== today.getFullYear() ? '/' + y : '');
      return { key: 'd' + y + '-' + m + '-' + d, label };
    }

    const weekStart = addDays(today, -((today.getDay() + 6) % 7)); // lundi
    if (day >= weekStart) return { key: 'week', label: 'Cette semaine' };
    if (day >= addDays(weekStart, -7)) return { key: 'lastweek', label: 'Semaine dernière' };
    if (y === today.getFullYear() && m === today.getMonth()) return { key: 'month', label: 'Plus tôt ce mois-ci' };
    const name = MONTH_NAMES_FR[m];
    return { key: 'm' + y + '-' + m, label: y === today.getFullYear() ? name : name + ' ' + y };
  }

  const api = { parse, parseShort, group, startOfDay, MONTH_NAMES_FR };
  root.GLDates = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
