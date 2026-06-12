## Tabz

Manifest V3 Chrome extension providing vim-style keyboard shortcuts for tab
management (reordering, grouping, regex-based closing). Designed to coexist with
Vimium without key conflicts.

## Architecture

MV3 extension:
- `manifest.json`: declares permissions (`tabs`, `tabGroups` only — no host
  permissions, no `<all_urls>`), registers service worker, content script, and
  `chrome.commands` entries
- `background.ts`: service worker; owns all `chrome.tabs.*` and
  `chrome.tabGroups.*` calls; receives messages from content script and executes
  them
- `content.ts`: thin key listener injected into pages; parses key sequences
  (including count prefixes like `3<key>`); sends messages to service worker;
  renders the input overlay (single `<input>`, `Enter` to execute, `Esc`
  to cancel)

The content script does **no DOM mutation** beyond the overlay. All
tab/group operations go through the service worker via
`chrome.runtime.sendMessage`.

## Key constraints

- **Permissions**: `tabs` + `tabGroups` only. This is a primary design goal — do
  not add host permissions or `activeTab`.
- **Vimium coexistence**: must not conflict with Vimium's default keys. Vimium
  owns: `h l i m j k J K g G f F t T x X W r o O b B d u H L gg yy p P / n N v V
  ? gi gs yt << >> [[ ]] zH zL ge gu`.
- Listener registration order between extensions is unspecified
  - **keys in a Tabz sequence, including continuations, should avoid Vimium's
  bindings**; otherwise Vimium swallows the key mid-sequence whenever it wins
  the registration race.
    <!-- TODO: implement configurable keys and leader. -->
- **MV3 service worker**: no persistent background page; use event-driven
  patterns. `chrome.commands` entries in manifest serve as fallback for
  `chrome://` pages where content scripts can't run.

## Testing

Tests evaluate the plain browser scripts in-realm via `loadScript` in
`tests/chrome-mock.ts`: the script source is wrapped in `new Function`, with
sandbox entries (e.g. the mocked `chrome`) shadowing globals as parameters, and
the requested top-level bindings returned by name.
