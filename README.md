# Tabz

Vim-style tab management for Chrome: move tabs, group tabs, close tabs by
regex, and save tabs to the reading list, all from the keyboard. The default
keys sit alongside [Vimium](https://github.com/philc/vimium) without stealing
any of its keys, and every binding is configurable.

- **Minimal permissions**: `tabs`, `tabGroups`, `storage` (used only to
  persist your key bindings), and `readingList` (used only for the
  reading-list keys). No host permissions, no `activeTab`.
- **Zero runtime dependencies**: nothing from npm ships in the extension.
- **Nothing sent**: no network requests, no analytics. The only thing ever
  stored is your key config in `chrome.storage.sync`; regex patterns you type
  live in memory for the duration of one message and are then gone.

## Install

Requires Chrome 120 or newer (the reading-list API) for full feature support. Basic functionality (move, regex-close, close duplicates) is available on Firefox with tab grouping and reading list features disabled.

### Chrome

1. `npm install && npm run build` (compiles `src/` to `dist/`)
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select this repo's root directory

### Firefox

1. `npm install && npm run build` (compiles `src/` to `dist/`)
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select any file in this repo's directory

After rebuilding or editing `manifest.json`, reload the extension.

## Keys

All sequences start with a leader (`s` by default) followed by one or two
keys. Press the keys in order (like vim), not as a chord. The tables below
show the defaults; see [Configuring keys](#configuring-keys) to change any of
them.

### Move

| Keys    | Action                              |
| ------- | ----------------------------------- |
| `sw`    | Move tab left (west)                |
| `se`    | Move tab right (east)               |
| `s0`    | Move tab to the first position      |
| `s$`    | Move tab to the last position       |

Move commands take a count, before or after the leader: `3sw` and `s3w` both
move the tab three positions left. Prefer the `s3w` form; the count is typed
after the leader, so pages that bind digit keys (YouTube seeking, for
example) never see it.

### Group

| Keys    | Action                                                        |
| ------- | ------------------------------------------------------------- |
| `sc`    | Create a group from the current tab, auto-named by hostname   |
| `sa`    | Add the current tab to the nearest group (left wins ties)     |
| `sq`    | Remove the current tab from its group                         |
| `sQ`    | Dissolve the current tab's group (ungroups; closes nothing)   |

Groups are auto-named from the tab's hostname (`github.com`) with a color
picked deterministically from the name, so the same site always gets the same
color. Rename or recolor via Chrome's normal group UI whenever you like.

### Close by regex

| Keys    | Action                              |
| ------- | ----------------------------------- |
| `ss`    | Open the regex-close prompt         |

A small HUD appears at the bottom of the page. Type a pattern; the match
count updates live so you can see the blast radius before committing.
`Enter` closes every matching tab, `Esc` cancels.

- Matches against URL **and** title, case-insensitively
- Scoped to the current window only
- Pinned tabs are never closed

### Reading list

| Keys    | Action                                  |
| ------- | --------------------------------------- |
| `sA`    | Add the current tab to the reading list |
| `sD`    | Remove the current tab from it          |

Both are idempotent: adding a page that is already listed and removing one
that is not are no-ops (a toast tells you which case you hit). Chrome's
reading list only accepts `http(s)` pages.

`Esc` also cancels a pending key sequence.

## Configuring keys

Open the extension's options page: right-click the Tabz icon and pick
**Options**, or go to `chrome://extensions`, open Tabz details, and click
**Extension options** (the page lives at
`chrome-extension://<extension-id>/options.html`).

- The leader and every action key can be rebound. Allowed keys: `a-z`, `A-Z`,
  `0`, `$`, comma, period, semicolon. Each binding is one or two characters.
  Digits 1-9 are reserved for count prefixes, and the leader may not be `0`
  (it would break counts).
- Every edit is validated live, and again before saving; duplicate bindings,
  prefix conflicts, and disallowed keys are rejected. A binding may equal the
  leader (that is how the default `ss` regex prompt works). No binding may be
  a prefix of another (e.g. `c` and `cg` would conflict).
- Defaults ship in [`config.json`](config.json); your changes are stored in
  `chrome.storage.sync` and follow your Chrome profile. **Reset to defaults**
  puts everything back.
- Saved changes apply to already-open tabs immediately.
- Bindings are **not** checked against other extensions. If you rebind onto a
  key Vimium uses, resolving that conflict is up to you (see below).

## Global shortcuts (work on chrome:// pages too)

Content scripts cannot run on `chrome://` pages, the Web Store, or other
extensions' pages, so the most useful operations are also exposed as
browser-level commands:

| Default key       | Action                       |
| ----------------- | ---------------------------- |
| `Alt+Shift+,`     | Move tab left                |
| `Alt+Shift+.`     | Move tab right               |
| `Alt+Shift+C`     | Group current tab            |
| `Alt+Shift+Q`     | Ungroup current tab          |
| (unbound)         | Add tab to reading list      |
| (unbound)         | Remove tab from reading list |

Rebind them (or bind the unbound ones; Chrome allows at most four suggested
defaults per extension) at `chrome://extensions/shortcuts`.

## How Vimium coexistence works

Both extensions listen for keys on every page, and Chrome does not define
which extension's listener runs first. If Tabz used any key Vimium binds,
whichever extension won that race would swallow the key, even mid-sequence.

So every key in the default Tabz grammar (`s`, `w`, `e`, `c`, `a`, `q`, `Q`,
`A`, `D`, `0`, `$`, and count digits) is chosen to be absent from Vimium's
default bindings, as a starter *and* as a continuation. Vimium passes them through
untouched no matter who registered first, and Tabz never suppresses a key
Vimium would have handled. This guarantee only holds for the defaults: if you
rebind Tabz onto a key Vimium uses (or vice versa), whichever extension wins
the registration race swallows it.

Tabz also ignores keystrokes in text inputs, editable elements, and during
IME composition, and stands down for any key carrying `Ctrl`, `Alt`, or
`Meta`.

## Firefox Support

Tabz works on Firefox (90+) with some limitations due to differences in the WebExtensions API:

- **Tab groups** are not available in Firefox (both creation and UI features are disabled)
- **Reading list** is not available in Firefox (reading list actions are disabled)
- **Basic tab movement** (move left/right, move to edges) works normally
- **Regex-based tab closing** works normally
- **Duplicate tab closing** works normally
- **Configuration** and **key bindings** work normally

When running on Firefox, the options page will show warnings that tab grouping and reading list features are unavailable. Key bindings for these features (default: `c`, `a`, `q`, `Q`, `A`, `D`) can still be customized but will not function. Consider rebinding these keys to other features or leaving them empty.

## Privacy

- Permissions are `tabs` (read tab URL/title to move and match tabs), `storage` (persist your key
  bindings), and optionally `tabGroups` and `readingList` on Chrome (create and edit groups; add and remove the current page). That is the
  entire list.
- The content script is a key listener; the only DOM it ever touches is its
  own HUD overlay, isolated in a shadow root.
- The only stored data is the key config in `chrome.storage.sync`. No
  `localStorage`, no cookies, no external services, no telemetry.

## Known limitations

- On pages that bind bare letters (for example a site shortcut on `s`), Tabz
  intercepts the leader key outside of text fields. Rebind the leader on the
  options page if it clashes with a site you use.
- If Vimium is in a mode entered without focusing an input (its `i` insert
  mode or visual mode), the two extensions can race for the leader key.
  Normal-mode coexistence is conflict-free.
- Moving a tab across a tab group follows Chrome's group-contiguity rules,
  so a single-step move may hop over an entire group.
- Counts typed before the leader (`3sw`) reach the page; counts typed after
  (`s3w`) do not.

## Development

```
tabz/
  manifest.json      MV3 manifest: permissions, content script, options, commands
  config.json        default key bindings (leader + one key per action)
  options.html       key-binding editor page
  src/background.ts  service worker (ES module); chrome.tabs/tabGroups calls
  src/config.ts      key-binding schema, defaults, parsing, and validation
  src/content.ts     key sequence parser + HUD overlay; messages the worker
  src/options.ts     options page logic; validates via the service worker
  tests/             vitest unit tests + chrome API mock
```

```sh
npm install
npm test        # builds src/ to dist/, then runs vitest
```

The service worker compiles to an ES module that tests import with a mocked
`chrome` API stubbed onto the global; the page-side scripts compile to plain
browser scripts that tests evaluate in-realm with the mock shadowing the
global.

## License

[MIT](LICENSE)
