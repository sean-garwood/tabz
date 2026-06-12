## Decisions already made

- Standalone extension, not a Vimium PR or fork
- Content script for multi-key sequences + `chrome.commands` for 3-4 most-used
  shortcuts (both approaches used together)
- Count prefix support (`3<key>`) for move operations; skip for group operations
- Auto-name groups (no prompt); user can rename after creation
- Regex matches against both URL and tab title, case-insensitively; current
  window only; pinned tabs never closed
- Regex input rendered as a minimal HUD overlay injected by the content script
  (open shadow root, live match-count preview)
- Distinct keys instead of overriding Vimium's `<<`/`>>` (override would require
  winning the listener race; see Key constraints)
- Group "delete" is non-destructive: `sQ` dissolves the group (ungroups
  members), closes nothing
- Keys are configurable (2026-06): defaults ship in top-level `config.json`,
  user overrides persist in `chrome.storage.sync` (the only persistence; no
  localStorage, no network). Edited via the options page; the service worker
  validates before anything is stored. Bindable keys: `a-z A-Z 0 $ , . ;`;
  digits 1-9 stay reserved for counts and the leader may not be `0`. Vimium
  conflict avoidance applies to the defaults only; users who rebind onto
  Vimium keys own the conflict.

## Keybindings (defaults)

**Subject to change at any time. More for the user's sake than the bot.**
Leader is `s`. Counts go before or after the leader (`3sw` or `s3w`), move
commands only.

- `sw` / `se`: move tab left (west) / right (east)
- `s0` / `s$`: move tab to first / last position (vim line-motion mnemonic)
- `sc`: create group from current tab, auto-named by hostname, color hashed from
  name
- `sa`: add current tab to nearest group (left wins distance ties)
- `sq`: remove current tab from its group
- `sQ`: dissolve current tab's group
- `ss`: regex-close prompt
- `chrome.commands` (work on `chrome://` pages): Alt+Shift+Comma / Period
  (move), Alt+Shift+C (group), Alt+Shift+Q (ungroup)
