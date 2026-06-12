# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tabz is a Manifest V3 Chrome extension providing vim-style keyboard shortcuts for tab management (reordering, grouping, regex-based closing). Designed to coexist with Vimium without key conflicts.

## Architecture

MV3 extension written in TypeScript, compiled with plain `tsc` (no bundler) to classic scripts in `dist/`, which is what the manifest loads:

- `manifest.json`: declares permissions (`tabs`, `tabGroups` only — no host permissions, no `<all_urls>`), registers service worker (`dist/background.js`), content script (`dist/content.js`), and `chrome.commands` entries
- `src/background.ts`: service worker; owns all `chrome.tabs.*` and `chrome.tabGroups.*` calls; receives messages from content script and executes them
- `src/content.ts`: thin key listener injected into pages; parses key sequences (including count prefixes like `3<key>`); sends messages to service worker; renders the regex input overlay (single `<input>`, `Enter` to execute, `Esc` to cancel)
- `src/types.d.ts`: the message protocol both scripts share, as ambient declarations. **No top-level `import`/`export` in `src/`**: MV3 content scripts cannot be ES modules, so both files must stay classic scripts (tsc then emits them 1:1 with no module wrapper). Compile target is ES2021, the newest syntax fully supported by `minimum_chrome_version: 89` — bump both together or neither.

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
- Zero **runtime** dependencies is a hard rule (nothing from npm ships in the extension); devDependencies are fine when tried-and-true and few — currently Vitest, TypeScript, and type packages (`@types/chrome`, `@types/node`)
- TypeScript via plain `tsc`, no bundler: the two scripts share no runtime code, so nothing needs bundling; shared types live in ambient `src/types.d.ts`

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

`npm test` (Vitest; run `npm install` first). `pretest` runs `npm run build`, so tests always exercise the compiled `dist/` output — the exact scripts that ship. `npm run typecheck` type-checks sources and tests without emitting. Tests evaluate the compiled scripts in-realm via `loadScript` in `tests/chrome-mock.ts`: the script source is wrapped in `new Function`, with sandbox entries (e.g. the mocked `chrome`) shadowing globals as parameters, and the requested top-level bindings returned by name. This imposes nothing on the source files — `function`, `const`, and `let` bindings all work — and avoids cross-realm prototype issues entirely.

## Loading the extension locally

Chrome: run `npm run build` first (the manifest points at `dist/`, which is gitignored), then `chrome://extensions` > enable Developer mode > Load unpacked > select repo root.

After editing `src/background.ts` or `manifest.json`, rebuild and click the refresh icon on the extension card. `src/content.ts` changes take effect on the next page load after a rebuild (no extension reload needed).
