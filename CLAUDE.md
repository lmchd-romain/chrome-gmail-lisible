# Gmail Lisible — notes pour les sessions de développement

Owner is a non-coder (French). UI text, README and code comments are in French.
Git: work on `main` only, commit and push directly to `main`. No other branches, no PRs unless asked.

## Structure
- `extension/` — the unpacked Chrome extension (MV3, no build step). The user loads this folder.
  - `manifest.json` — `key` field pins the extension ID (`minkcefmamppmchimjoecjdehmhbmojn`) so re-downloads keep settings.
  - `shared/defaults.js` — settings keys and defaults (popup + content scripts).
  - `content/core.js` — settings (chrome.storage.sync), throttled MutationObserver, `GL.register({name, update})`.
  - `content/expand.js`, `trimmed.js`, `reply-float.js`, `day-separators.js` — one feature each.
  - `content/dates.js` — pure date parsing/grouping (also required by Node tests).
  - `popup/` — settings UI (also used as options page).
- `tests/` — `dates.test.js` (node:test) and `e2e.js` (Playwright loads the real extension, routes `mail.google.com` to `tests/fixtures/*.html`).
- `tools/make-icons.py` — regenerates `extension/icons/`.

## Gmail DOM facts used (sources: InboxSDK 2026 selector registry, Trimless, Inbox Reborn)
- Thread: messages in `[role=list]`; message element classes: `.h7` expanded, `.kv`/`.ky` collapsed, `.kQ`/`.kx` hidden behind the `.adv` notice (`.adx` = count). Collapsed header `.adf.ads`. Expand-all icon `img.gx` (button = closest `[role=button]`). Subject `h2.hP`.
- Body `div.ii.gt` > `.a3s`. Trimmed-content button wrappers `.ajU`/`.ajV`/`.adm`, button `.ajR`; hidden content `.h5`/`.adL`.
- Inline reply: `.ip` gets class `adB` when open; compose root `.M9`; editor `[g_editable=true]`. Popup composes live in `.AD`/`[role=dialog]`. Main scroll container `div.Tm.aeJ`.
- Thread list rows `tr.zA` in `div.Cp table > tbody`; date in `td.xW > span[title]` (vertical split: `td.yf.apt > div.apm > span[title]`). Separators are `div.glx-day-sep` (display: table-row) with a `td[colspan]`, so `tbody.rows` is unchanged.

## Rules
- Never move Gmail's DOM nodes; only add classes/CSS or insert our own `.glx-own` elements.
- Every feature must be idempotent (no DOM writes when already correct) and toggleable live.
- Run `npm test` before pushing.
