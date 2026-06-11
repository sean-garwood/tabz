# Handoff — Vim-style Tab Management Chrome Extension (MV3)

_Origin: claude.ai ideation. No code written yet._

## TL;DR
A Manifest V3 Chrome extension providing vim-like keyboard shortcuts for tab manipulation (reordering, grouping, regex-based closing). Designed to coexist with Vimium without key conflicts.

## Context
- User runs Vimium daily and doesn't want to conflict with its keybindings
- Tried Chrome Web Store tab managers, dislikes their permission scope
- Considered contributing to Vimium upstream but it's a poor fit: maintainers keep scope tight (~50 LOC PRs preferred), 43 open PRs already, and tab grouping/regex features would be classified as niche/complex per their CONTRIBUTING.md
- No AI contribution policy exists for Vimium, but the codebase philosophy favors simplicity and maintainer understanding of every line
- Standalone extension is the right call

## Scope

### In
- **Tab position manipulation**: move current tab left/right, move N tabs left/right (count prefix like Vimium's `5t` pattern)
- **Tab grouping**: create group, add tab(s) to group, remove tab(s) from group, delete group
- **Regex tab closing**: prompt for regex, close all tabs whose URL matches
- All shortcuts vim-flavored, home-row biased, `ctrl`/`meta`/`alt` acceptable for less-used operations
- Must not overlap common Vimium keys

### Out
- No tab search/fuzzy-find (Vimium's Vomnibar already handles this via `T`)
- No tab restore (Vimium has `X`)
- No visual UI beyond a minimal input for the regex prompt
- Not a Vimium fork or PR

## Approach
- **Manifest V3** extension, service worker architecture
- **Permissions**: `tabs`, `tabGroups` only. No `<all_urls>`, no host permissions, no `activeTab`
- **Keybinding layer**: two options to evaluate
  - `chrome.commands` API for modifier-key shortcuts (limited to ~4 commands, but zero content script needed)
  - Thin content script that listens for key sequences (enables Vimium-style multi-key combos like `gn` for new group). Must not interfere with Vimium's key handler — register on `keydown` at lower priority or check for Vimium's suppression
  - Likely need both: `chrome.commands` for the most-used operations, content script for the extended grammar
- **Service worker** (`background.js`): all `chrome.tabs.*` and `chrome.tabGroups.*` calls. Content script sends messages, service worker executes
- **Regex input**: inject a minimal overlay (like Vimium's HUD) when the regex-close shortcut fires. Single text input, `Enter` to execute, `Esc` to cancel

## Decisions made
- Standalone MV3 extension, not a Vimium PR. Vimium's contribution bar is too high for this scope and the maintainers explicitly recommend forks/separate extensions for niche features.
- Minimal permissions — `tabs` + `tabGroups` only. This was a primary motivation (Chrome Web Store extensions ask for too much).
- Vim-style keys, not arbitrary shortcuts. Home-row preference.

## Open questions
- **Exact keybinding map**: not yet specced. Next Claude should propose a mapping that avoids Vimium defaults (`j`, `k`, `J`, `K`, `g`, `G`, `f`, `F`, `t`, `T`, `x`, `X`, `W`, `r`, `o`, `O`, `b`, `B`, `d`, `u`, `H`, `L`, `gg`, `yy`, `p`, `P`, `/`, `n`, `N`, `v`, `V`, `?`, `gi`, `gs`, `yt`, `<<`, `>>`). Vimium already uses `<<`/`>>` for moveTabLeft/Right — decide whether to override or pick different keys. Ask user.
- **Count prefix support**: should `3<key>` move tab 3 positions? Adds complexity to the content script key parser. Suggest yes for move operations, skip for group operations. Make a call.
- **Group naming**: auto-name groups or prompt? Make a call (suggest auto-name with option to rename).
- **Regex scope**: match against full URL, or also tab title? Suggest both (URL + title), make a call.
- **Content script vs. commands tradeoff**: the content script approach is more flexible but means injecting into pages. Acceptable given it's a tiny listener with no DOM mutation. Make a call.

## First steps
1. Scaffold MV3 extension: `manifest.json`, `background.js` (service worker), `content.js`
2. Implement `chrome.tabs.move()` wrappers: move-left, move-right, move-N
3. Implement `chrome.tabGroups` wrappers: create, add, remove, delete
4. Implement regex-close: overlay input → collect pattern → `chrome.tabs.query({})` → filter by regex → `chrome.tabs.remove()`
5. Build the key listener in content script, map to message-passing to service worker
6. Test coexistence with Vimium (install both, verify no key conflicts)
7. Add `chrome.commands` entries in manifest for the 3-4 most critical shortcuts as fallback (works even on `chrome://` pages where content scripts can't run)

## References
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [MV3 migration guide](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- Vimium source + key defaults: https://github.com/philc/vimium — see `commands.js` for full command list, help dialog (`?`) for default mappings
- Vimium CONTRIBUTING.md: https://github.com/philc/vimium/blob/master/CONTRIBUTING.md
