# Tabz

Vim-style tab management browser extension.

> Note: This document assumes Google Chrome, which was used during development.
> Tabz is compatible with any Chromium-based, non-native browser. See [Browser
> Support](#browser-support) for more info.

## Browser Support

[Coming soon to the Chrome
store](https://github.com/sean-garwood/tabz/issues/26), which also supports
many other chromium-based browsers.

- Brave
- Vivaldi (apparently)
- MS Edge (ew)

Feel free to clone/load unpacked until then.

> Note: No native extension support is planned.

## Features

Implemented:

- move, group, and close tabs
- Add/remove tabs to/from the Reading List

Some planned features are enumerated [on the GitHub Issues
page](https://github.com/sean-garwood/tabz/issues).

### Privacy

The content script listens for keypresses. The HUD is isolated in a shadow root.
No data is ever collected or sent over the network.

- Minimal permissions:
    - `tabs` (read tab URL/title to move, match, and name
      groups)
    - `tabGroups` (create and edit groups)
    - `storage` (persist keybindings)
    - `readingList` (add and remove the current page)
- Zero runtime dependencies
- Nothing stored except for config in `chrome.storage.sync`
- Ephemeral messages

### Keys

All sequences start with a leader (`s` by default) followed by one or two
keys. Press the keys in order (like vim), not as a chord. The tables below
show the defaults; see [Configuring keys](#configuring-keys) to change any of
them.

#### Move

| Keys | Action                         |
| ---- | ------------------------------ |
| `sw` | Move tab left (west)           |
| `se` | Move tab right (east)          |
| `s0` | Move tab to the first position |
| `s$` | Move tab to the last position  |

Move commands take a count, before or after the leader: `3sw` and `s3w` both
move the tab three positions left. Prefer the `s3w` form; the count is typed
after the leader, so pages that bind digit keys (YouTube seeking, for
example) never see it.

#### Group

| Keys | Action                                                      |
| ---- | ----------------------------------------------------------- |
| `sc` | Create a group from the current tab, auto-named by hostname |
| `sa` | Add the current tab to the nearest group (left wins ties)   |
| `sq` | Remove the current tab from its group                       |
| `sQ` | Dissolve the current tab's group (ungroups; closes nothing) |

Groups are auto-named from the tab's hostname (`github.com`) with a color
picked deterministically from the name, so the same site always gets the same
color. Rename or recolor via Chrome's normal group UI whenever you like.

#### Close by regex

| Keys | Action                      |
| ---- | --------------------------- |
| `ss` | Open the regex-close prompt |

A small HUD appears at the bottom of the page. Type a pattern; the match
count updates live so you can see the blast radius before committing.
`Enter` closes every matching tab, `Esc` cancels.

- Matches against URL and title, case-insensitively
- Scoped to the current window only
- Pinned tabs are never closed

#### Reading list

| Keys | Action                                  |
| ---- | --------------------------------------- |
| `sA` | Add the current tab to the reading list |
| `sD` | Remove the current tab from it          |

Both are idempotent: adding a page that is already listed and removing one
that is not are no-ops (a toast tells you which case you hit). Chrome's
reading list only accepts `http(s)` pages.

`Esc` also cancels a pending key sequence.

## Configuration

Open the extension's options page: right-click the Tabz icon and pick
Options, or go to `chrome://extensions`, open Tabz details, and click
Extension options (the page lives at
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
  `chrome.storage.sync` and follow your Chrome profile. Reset to defaults
  puts everything back.
- Saved changes apply to already-open tabs immediately.
- Bindings are not checked against other extensions. Resolving conflicts is
  the responsibility of the user.

### Global shortcuts (work on chrome:// pages too)

Content scripts cannot run on `chrome://` pages, the Web Store, or other
extensions' pages, so the most useful operations are also exposed as
browser-level commands:

| Default key   | Action                       |
| ------------- | ---------------------------- |
| `Alt+Shift+,` | Move tab left                |
| `Alt+Shift+.` | Move tab right               |
| `Alt+Shift+C` | Group current tab            |
| `Alt+Shift+Q` | Ungroup current tab          |
| (unbound)     | Add tab to reading list      |
| (unbound)     | Remove tab from reading list |

Rebind them (or bind the unbound ones; Chrome allows at most four suggested
defaults per extension) at `chrome://extensions/shortcuts`.

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

### Conflicts

Extensions that listen for keypresses (this being one of them) may race;
precedence is undefined. If Tabz loses, the keypress never happened as far as
Tabz is concerned--even those that occur mid-sequence.

[Vimium](https://github.com/philc/vimium#vimium---the-hackers-browser) heavily
inspired this extension; forking it was a consideration. Therefore, to reduce
such conflicts, every key in the default Tabz grammar (`s`, `w`, `e`, `c`, `a`, `q`,
`Q`, `A`, `D`, `0`, `$`, and count digits) is chosen to be absent from Vimium's
default bindings, as a starter _and_ as a continuation. Vimium passes them through
untouched no matter who registered first, and Tabz never suppresses a key
Vimium would have handled.

This guarantee only holds for the defaults: if you rebind Tabz onto a key Vimium
uses (or vice versa), whichever extension wins the registration race swallows
it. Furthermore, it is subject to change without notice, if, for instance, the
author gets lazy (likely) or sloppy (almost certain).

Tabz ignores keystrokes

- in editable elements, e.g. text inputs
- during IME composition (whatever that is--thanks, Claude?)
- carrying `Ctrl`, `Alt`, or `Meta` except for the extension's shortcuts.

### Known unknowns

- Support for reading list/groups might be limited?

## Contributing

Contributions are welcome.

### Development

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

### Developer Installation

> Note: npm is not good. There is an [open
> issue](https://github.com/sean-garwood/tabz/issues/28) to replace it.

Assumes `node`/`npm` are installed. Sorry. Feel free to [make it do `make
install`](https://github.com/sean-garwood/tabz/issues/27).

1. `npm install && npm run build` (compiles `src/` to `dist/`)
1. Open `chrome://extensions`
1. Enable Developer mode
1. Click Load unpacked and select this repo's root directory

After rebuilding or editing `manifest.json`, click the refresh icon on the
extension card. Content script changes take effect on the next page load.

## License

[MIT](LICENSE)
