# Gmail Lisible — notes pour les sessions de développement

Owner is a non-coder (French). UI text, README and code comments are in French.
Git: work on `main` only, commit and push directly to `main`. No other branches, no PRs unless asked.
Nobody can open the owner's Gmail from here: when real Gmail behaves differently from the fixtures, ask the owner for the popup's « Copier un diagnostic » output (structure only, no mail content).

## Structure
- `extension/` — the unpacked Chrome extension (MV3, no build step). The user loads this folder.
  - `manifest.json` — `key` field pins the extension ID (`minkcefmamppmchimjoecjdehmhbmojn`) so re-downloads keep settings.
  - `shared/defaults.js` — settings keys and defaults (popup + content scripts).
  - `content/core.js` — settings (chrome.storage.sync), MutationObserver (throttled `update`, synchronous `quick` hook), shared helpers (`GL.visibleThreadList`, `GL.threadKey`, `GL.isDraftMessage`, `GL.waitFor`, `GL.click`…). Features call `GL.register({name, update, quick?})`.
  - `content/expand.js` — auto-expand (expand-all button, fallback clicks); `quick` path + `.glx-expanding` veil so collapsed messages never paint.
  - `content/trimmed.js` — hides Apple Mail `<file.ext>` placeholders (line-based, robust to split text nodes / `<wbr>`).
  - `content/reply-popout.js` — clicks Gmail's own pop-out button when scrolling up; at the bottom closes the popup (Gmail saves a draft) and reopens the draft inline.
  - `content/attachments.js` — own attachment bar (on top / compact) + conversation summary; actions click Gmail's hidden native card buttons.
  - `content/day-separators.js` — date separators (skips the « Messages suivis » section).
  - `content/infinite-scroll.js` — overscroll at list bottom/top clicks « Plus anciens » / « Plus récents ».
  - `content/diagnostic.js` — privacy-safe DOM report requested by the popup.
  - `content/dates.js` — pure date parsing/grouping (also required by Node tests).
  - `popup/` — settings UI (also used as options page) + diagnostic button.
- `tests/` — `dates.test.js` (node:test) and `e2e.js` (Playwright loads the real extension, routes `mail.google.com` to `tests/fixtures/*.html`, which emulate Gmail behaviours).
- `tools/make-icons.py` — regenerates `extension/icons/`.

## Gmail DOM facts used (sources: InboxSDK 2026 selector registry, Trimless, Inbox Reborn)
- Thread: messages in `[role=list]`; message element classes: `.h7` expanded, `.kv`/`.ky` collapsed, `.kQ`/`.kx` hidden behind the `.adv` notice (`.adx` = count). Collapsed header `.adf.ads`. Expand-all icon `img.gx` (button = closest `[role=button]`). Subject `h2.hP`. Sender `.gD`, date `.g3[title]`. Drafts marked `.boq` / « Brouillon ».
- Body `div.ii.gt` > `.a3s`. Trimmed-content button wrappers `.ajU`/`.ajV`/`.adm`, button `.ajR` (also in compose); hidden content `.h5`/`.adL`.
- Attachments: area `div.hq` (toolbar `.ho`), cards `.aQH > span.aZo[download_url="mime:name:url"]`, link `a.aQy`, name `.aV3`, size `.aYp span`, icon `img.aSM`, thumbnail `img.aQG`, hover buttons in `.aQw`.
- Inline reply: `.ip` gets class `adB` when open; compose root `.M9`; editor `[g_editable=true]`. Popup composes live in `.AD`/`[role=dialog]`; title-bar buttons in `.Hm` (`.Hl` minimize, `.Hq` fullscreen, `.Ha` save & close). Main scroll container `div.Tm.aeJ`. Bottom reply buttons `.amn` (`.bkH` reply, `.bkG` reply all, `.bkI` forward).
- Thread list rows `tr.zA` in `div.Cp table > tbody`; date in `td.xW > span[title]` (vertical split: `td.yf.apt > div.apm > span[title]`); starred = `.T-KT:not(.aXw)`; section titles `.Wg h3.Wr .Wn`; list toolbar `[gh=tm]` with pager buttons aria-label « Plus récents » / « Plus anciens ». Separators are `div.glx-day-sep` (display: table-row) with a `td[colspan]`, so `tbody.rows` is unchanged.

## Rules
- Never move Gmail's DOM nodes; only add classes/CSS or insert our own `.glx-own` elements.
- Every feature must be idempotent (no DOM writes when already correct) and toggleable live.
- Run `npm test` before pushing.
