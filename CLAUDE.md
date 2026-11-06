# Gmail Lisible — notes pour les sessions de développement

Owner is a non-coder (French). UI text, README and code comments are in French.
Git: work on `main` only, commit and push directly to `main`. No other branches, no PRs unless asked.
Nobody can open the owner's Gmail from here: when real Gmail behaves differently from the fixtures, ask the owner for the popup's « Copier un diagnostic » output (structure only, no mail content).

## Structure
- `extension/` — the unpacked Chrome extension (MV3, no build step). The user loads this folder.
  - `manifest.json` — `key` field pins the extension ID (`minkcefmamppmchimjoecjdehmhbmojn`) so re-downloads keep settings.
  - `shared/defaults.js` — settings keys and defaults (popup + content scripts).
  - `content/core.js` — settings (chrome.storage.sync), MutationObserver (throttled `update`, synchronous `quick` hook), shared helpers (`GL.visibleThreadList`, `GL.threadKey`, `GL.isDraftMessage`, `GL.waitFor`, `GL.click`…). Features call `GL.register({name, update, quick?})`.
  - Themes: `core.js` sets `html[data-glx-dark]` when `[role=main]` text is light (dark / dark-image Gmail themes); CSS uses `--glx-accent` (blue #0b57d0 / #a8c7fa) and greys from `color-mix(currentColor …)`, so never hard-code colors in `content.css`.
  - `content/expand.js` — auto-expand (expand-all button, fallback clicks); `quick` path + `.glx-expanding` veil so collapsed messages never paint.
  - `content/history.js` — per message, quote units (Gmail-trimmed `.h5/.adL`, `.gmail_quote`, `blockquote[type=cite]` + attribution line, Outlook « De : / Envoyé : » block + following siblings) are compared (6-word shingles) with the messages ABOVE: redundant → `.glx-quote-hidden`; Gmail-trimmed but never received → `.glx-quote-show` (revealed). Also dedupes identical signatures within one body (`-- ` regions, signature classes, signature-like tables): keeps the least nested one.
  - `content/trimmed.js` — hides Apple Mail `<file.ext>` placeholders (line-based, robust to split text nodes / `<wbr>`).
  - `content/reply-popout.js` — clicks Gmail's own pop-out button when scrolling up (after climbing ≥150 px and the reply <35 % visible); when scrolling down and the reply's former spot (its `.ip` anchor) is visible again, closes the popup — real Gmail then puts the reply back inline itself (fallback: reopen the collapsed draft). Repeats indefinitely: inline reply = any visible editor in the thread outside popups (a reopened draft may have no `.ip.adB`), pop-out button searched in the reply, its `.adn` and list item; popups detected as « newly visible » (Gmail may reuse a hidden compose window). Problems go to `GL.trace` → diagnostic « Journal ».
  - `content/attachments.js` — own attachment bar (on top / compact) + conversation summary; actions click Gmail's hidden native card buttons.
  - `content/day-separators.js` — date separators (skips the « Messages suivis » section).
  - `content/settings-tab.js` — settings UI: « Personnalisation » tab added to Gmail's settings page (`#settings/…`). Tabs found generically (`a[href$="#settings/x"]`, fallback `[role=tab]`; tab unit = largest ancestor holding one link); our tab = sanitized clone of a Gmail tab (active-tab clone while open; Gmail's active tab gets `.glx-tab-dim` with inactive computed styles). Open: Gmail content after the tab bar gets `.glx-settings-hidden`, our `.glx-settings` panel inserted; hash unchanged; closes on Gmail tab click / hashchange. Popup asks it via message `glx-open-settings` (or `storage.local.glxOpenSettings` for a new tab).
  - `content/diagnostic.js` — privacy-safe DOM report requested by the popup.
  - `content/dates.js` — pure date parsing/grouping (also required by Node tests).
  - `popup/` — « Ouvrir les réglages » button (→ Gmail tab) + diagnostic button (also options page).
- `tests/` — `dates.test.js` (node:test) and `e2e.js` (Playwright loads the real extension, routes `mail.google.com` to `tests/fixtures/*.html`, which emulate Gmail behaviours).
- `tools/make-icons.py` — regenerates `extension/icons/`.

## Gmail DOM facts used (sources: InboxSDK 2026 selector registry, Trimless, Inbox Reborn)
- Thread: messages in `[role=list]`; message element classes: `.h7` expanded, `.kv`/`.ky` collapsed, `.kQ`/`.kx` hidden behind the `.adv` notice (`.adx` = count). Collapsed header `.adf.ads`. Expand-all icon `img.gx` (button = closest `[role=button]`). Subject `h2.hP`. Sender `.gD`, date `.g3[title]`. Drafts marked `.boq` / « Brouillon ».
- Body `div.ii.gt` > `.a3s`. Trimmed-content button wrappers `.ajU`/`.ajV`/`.adm`, button `.ajR` (also in compose); hidden content `.h5`/`.adL`.
- Attachments: area `div.hq` (toolbar `.ho`), cards `.aQH > span.aZo[download_url="mime:name:url"]`, link `a.aQy`, name `.aV3`, size `.aYp span`, icon `img.aSM`, thumbnail `img.aQG`, hover buttons in `.aQw`.
- Inline reply: `.ip` gets class `adB` when open; compose root `.M9`; editor `[g_editable=true]`. Popup composes live in `.AD`/`[role=dialog]`; title-bar buttons in `.Hm` (`.Hl` minimize, `.Hq` fullscreen, `.Ha` save & close). Main scroll container `div.Tm.aeJ`. Bottom reply buttons `.amn` (`.bkH` reply, `.bkG` reply all, `.bkI` forward).
- Thread list rows `tr.zA` in `div.Cp table > tbody`; date in `td.xW > span[title]` (vertical split: `td.yf.apt > div.apm > span[title]`); starred = `.T-KT:not(.aXw)`; section titles `.Wg h3.Wr .Wn`; list toolbar `[gh=tm]` with pager buttons aria-label « Plus récents » / « Plus anciens ». Owner's inbox is sectioned (« Messages suivis » / « Autres messages », sections `div.ae4[role=tabpanel]`): no pager in `[gh=tm]`; each section's counter `.Dj` sits in a `div.Wm[role=button]` « Afficher plus de messages ». Separators are `div.glx-day-sep` (display: table-row) with a `td[colspan]`, so `tbody.rows` is unchanged.

## Removed
- Continuous scroll (page turn on overscroll) was removed at the owner's request: they wanted e-mails appended below the list, which Gmail cannot do (pages of max 100); not worth a hidden-iframe hack.

## Rules
- Never move Gmail's DOM nodes; only add classes/CSS or insert our own `.glx-own` elements.
- Every feature must be idempotent (no DOM writes when already correct) and toggleable live.
- Run `npm test` before pushing.
