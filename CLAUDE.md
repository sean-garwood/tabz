## Tabz

Manifest V3 Chrome extension providing vim-style keyboard shortcuts for tab
management (reordering, grouping, regex-based closing). Designed to coexist with
Vimium without key conflicts.

## Architecture

MV3 extension:
- `manifest.json`: declares permissions (`tabs`, `tabGroups`, `storage`; no host
  permissions, no `<all_urls>`), registers service worker, content script,
  options page, and `chrome.commands` entries
- `config.json`: shipped default key bindings (leader + one key per action)
- `background.ts`: service worker; owns all `chrome.tabs.*` and
  `chrome.tabGroups.*` calls; receives messages from content script and executes
  them; owns config: fetches `config.json`, overlays user overrides from
  `chrome.storage.sync`, and validates bindings (`getConfig` /
  `validateConfig` / `setConfig` messages)
- `content.ts`: thin key listener injected into pages; builds its sequence map
  from the effective config (rebuilt on `storage.onChanged`); parses key
  sequences (including count prefixes like `3<key>`); sends messages to service
  worker; renders the input overlay (single `<input>`, `Enter` to execute,
  `Esc` to cancel)
- `options.html` + `options.ts`: key-binding editor; pure relay to the service
  worker, which is the single source of validation truth

The content script does **no DOM mutation** beyond the overlay. All
tab/group operations go through the service worker via
`chrome.runtime.sendMessage`.

## Key constraints

- **Permissions**: `tabs` + `tabGroups` + `storage` only. This is a primary
  design goal; do not add host permissions or `activeTab`. `storage` exists
  solely to persist key bindings (`chrome.storage.sync`, key `config`).
- **Configurable keys**: leader and per-action keys come from `config.json`
  defaults plus user overrides. Bindable set: `a-z A-Z 0 $ , . ;` (digits 1-9
  are reserved for counts; the leader may not be `0`). Validation lives only in
  the service worker.
- **Vimium coexistence**: the *defaults* avoid Vimium's default keys (Vimium
  owns: `h l i m j k J K g G f F t T x X W r o O b B d u H L gg yy p P / n N v
  V ? gi gs yt << >> [[ ]] zH zL ge gu`). Users may rebind onto Vimium keys;
  resolving such conflicts is their responsibility, since listener registration
  order between extensions is unspecified and Vimium can swallow a key
  mid-sequence when it wins the race.
- **MV3 service worker**: no persistent background page; use event-driven
  patterns. `chrome.commands` entries in manifest serve as fallback for
  `chrome://` pages where content scripts can't run.

## Testing

Tests evaluate the plain browser scripts in-realm via `loadScript` in
`tests/chrome-mock.ts`: the script source is wrapped in `new Function`, with
sandbox entries (e.g. the mocked `chrome`) shadowing globals as parameters, and
the requested top-level bindings returned by name.
