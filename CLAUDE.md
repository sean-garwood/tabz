# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tabz is a Manifest V3 Chrome extension providing vim-style keyboard shortcuts for tab management (reordering, grouping, regex-based closing). Designed to coexist with Vimium without key conflicts.

## Architecture

Three-file MV3 extension:

- `manifest.json`: declares permissions (`tabs`, `tabGroups` only — no host permissions, no `<all_urls>`), registers service worker, content script, and `chrome.commands` entries
- `background.js`: service worker; owns all `chrome.tabs.*` and `chrome.tabGroups.*` calls; receives messages from content script and executes them
- `content.js`: thin key listener injected into pages; parses key sequences (including count prefixes like `3<key>`); sends messages to service worker; renders the regex input overlay (single `<input>`, `Enter` to execute, `Esc` to cancel)

The content script does **no DOM mutation** beyond the regex overlay. All tab/group operations go through the service worker via `chrome.runtime.sendMessage`.

## Key constraints

- **Permissions**: `tabs` + `tabGroups` only. This is a primary design goal — do not add host permissions or `activeTab`.
- **Vimium coexistence**: must not conflict with Vimium's default keys. Vimium owns: `h l i m j k J K g G f F t T x X W r o O b B d u H L gg yy p P / n N v V ? gi gs yt << >> [[ ]] zH zL ge gu` (and more; check Vimium's `?` help dialog). Listener registration order between extensions is unspecified, so **every key in a Tabz sequence, including continuations, must avoid Vimium's bindings**; otherwise Vimium swallows the key mid-sequence whenever it wins the registration race. The safe alphabet currently in use: `s w e c a q Q 0 $` plus digits.
- **MV3 service worker**: no persistent background page; use event-driven patterns. `chrome.commands` entries in manifest serve as fallback for `chrome://` pages where content scripts can't run.

## Decisions already made

- Standalone extension, not a Vimium PR or fork
- Content script for multi-key sequences + `chrome.commands` for 3-4 most-used shortcuts (both approaches used together)
- Count prefix support (`3<key>`) for move operations; skip for group operations
- Auto-name groups (no prompt); user can rename after creation
- Regex matches against both URL and tab title, case-insensitively; current window only; pinned tabs never closed
- Regex input rendered as a minimal HUD overlay injected by the content script (open shadow root, live match-count preview)
- Distinct keys instead of overriding Vimium's `<<`/`>>` (override would require winning the listener race; see Key constraints)
- Group "delete" is non-destructive: `sQ` dissolves the group (ungroups members), closes nothing
- No persistence of any kind: no chrome.storage, no localStorage, no network; service worker is stateless

## Keybindings (final)

Leader is `s`. Counts go before or after the leader (`3sw` or `s3w`), move commands only.

- `sw` / `se`: move tab left (west) / right (east)
- `s0` / `s$`: move tab to first / last position (vim line-motion mnemonic)
- `sc`: create group from current tab, auto-named by hostname, color hashed from name
- `sa`: add current tab to nearest group (left wins distance ties)
- `sq`: remove current tab from its group
- `sQ`: dissolve current tab's group
- `ss`: regex-close prompt
- `chrome.commands` (work on `chrome://` pages): Alt+Shift+Comma / Period (move), Alt+Shift+C (group), Alt+Shift+Q (ungroup)

## Testing

`node --test` (Node 18+, zero dependencies). Tests load the plain browser scripts into a `node:vm` context with the mocked `chrome` API in `tests/chrome-mock.js`. Notes: the VM realm needs `URL` passed in, and tests use non-strict `assert` because `deepStrictEqual` compares prototypes across realms. Testable logic in `background.js`/`content.js` must be top-level function declarations (they become properties of the VM context; `const`/`let` do not).

## Loading the extension locally

Chrome: `chrome://extensions` > enable Developer mode > Load unpacked > select repo root.

After editing `background.js` or `manifest.json`, click the refresh icon on the extension card. Content script changes take effect on the next page load (no extension reload needed).
