# Tabz

Vim-style tab management for Chrome: move tabs, group tabs, and close tabs by
regex, all from the keyboard. Built to sit alongside
[Vimium](https://github.com/philc/vimium) without stealing any of its keys.

- **Minimal permissions**: `tabs` and `tabGroups` only. No host permissions,
  no `activeTab`, no storage.
- **Zero runtime dependencies**: TypeScript compiles to two plain scripts;
  nothing from npm ships in the extension.
- **Nothing persisted, nothing sent**: no storage APIs, no network requests,
  no analytics. Regex patterns you type live in memory for the duration of one
  message and are then gone.

## Install

1. Run `npm install && npm run build` (compiles `src/*.ts` to `dist/`)
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select this repo's root directory

After editing `src/background.ts` or `manifest.json`, run `npm run build` and
click the refresh icon on the extension card. Changes to `src/content.ts`
take effect on the next page load after a rebuild.

## Keys

All sequences start with the `s` leader. Press the keys in order (like vim),
not as a chord.

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

`Esc` also cancels a pending key sequence.

## Global shortcuts (work on chrome:// pages too)

Content scripts cannot run on `chrome://` pages, the Web Store, or other
extensions' pages, so the four most useful operations are also exposed as
browser-level commands:

| Default key       | Action                       |
| ----------------- | ---------------------------- |
| `Alt+Shift+,`     | Move tab left                |
| `Alt+Shift+.`     | Move tab right               |
| `Alt+Shift+C`     | Group current tab            |
| `Alt+Shift+Q`     | Ungroup current tab          |

Rebind them at `chrome://extensions/shortcuts`.

## How Vimium coexistence works

Both extensions listen for keys on every page, and Chrome does not define
which extension's listener runs first. If Tabz used any key Vimium binds,
whichever extension won that race would swallow the key, even mid-sequence.

So every key in the Tabz grammar (`s`, `w`, `e`, `c`, `a`, `q`, `Q`, `0`,
`$`, and count digits) is chosen to be absent from Vimium's default bindings,
as a starter *and* as a continuation. Vimium passes them through untouched no
matter who registered first, and Tabz never suppresses a key Vimium would
have handled.

Tabz also ignores keystrokes in text inputs, editable elements, and during
IME composition, and stands down for any key carrying `Ctrl`, `Alt`, or
`Meta`.

## Privacy

- Permissions are `tabs` (read tab URL/title to move, match, and name
  groups) and `tabGroups` (create and edit groups). That is the entire list.
- The content script is a key listener; the only DOM it ever touches is its
  own HUD overlay, isolated in a shadow root.
- No `chrome.storage`, no `localStorage`, no cookies, no `fetch`, no
  external services, no telemetry. There is nothing to opt out of.

## Known limitations

- On pages that bind bare letters (for example a site shortcut on `s`), Tabz
  intercepts the leader key outside of text fields. Key customization may
  come later.
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
  manifest.json        MV3 manifest: permissions, content script, commands
  src/background.ts    service worker; owns all chrome.tabs/tabGroups calls
  src/content.ts       key sequence parser + HUD overlay; messages the worker
  src/types.d.ts       message protocol shared by both scripts (ambient types)
  dist/                compiled output (gitignored); what the manifest loads
  tests/               Vitest unit tests and the chrome API mock
```

```sh
npm install
npm run build      # compile src/*.ts to dist/
npm run typecheck  # type-check sources and tests without emitting
npm test           # build, then run the tests against the compiled output
```

The compiled extension files are plain browser scripts (no module wrapper —
MV3 content scripts cannot be ES modules); tests evaluate the `dist/` output
in-realm with a mocked `chrome` API.

## License

[MIT](LICENSE)
