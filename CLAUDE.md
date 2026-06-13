## Tabz

Manifest V3 Chrome extension providing vim-style keyboard shortcuts for tab
management (reordering, grouping, regex-based closing). Designed to coexist with
Vimium without key conflicts.

## Architecture

MV3 extension:
- `manifest.json`: declares permissions (`tabs`, `tabGroups`, `storage`,
  `readingList`; no host permissions, no `<all_urls>`), registers service
  worker, content script, options page, and `chrome.commands` entries;
  `minimum_chrome_version` is 120, set by the `chrome.readingList` API (the
  module service worker alone would only need 91)
- `config.json`: shipped default key bindings (leader + one or two keys per
  action)
- `background.ts`: service worker, registered as an ES module (`"type":
  "module"`); owns all `chrome.tabs.*`, `chrome.tabGroups.*`, and
  `chrome.readingList.*` calls; receives messages from
  content script and executes them; serves config to the other surfaces
  (`getConfig` / `validateConfig` / `setConfig` messages)
- `config.ts`: worker-side ES module imported by `background.ts`; owns the
  binding schema, fetches `config.json`, overlays user overrides from
  `chrome.storage.sync` (lenient parse with warnings), and strictly validates
  options-page submissions
- `messaging.ts`: shared `tabzSendMessage` helper (typed per message via
  `TabzResponseFor`); loaded as a classic script before `content.js` and
  `options.js`, so it is a shared global rather than a module export
- `content.ts`: thin key listener injected into pages; builds a trie from the
  effective config (rebuilt on `storage.onChanged`); parses key sequences by
  walking the trie (including count prefixes like `3<key>`); sends messages to
  service worker; renders the input overlay (single `<input>`, `Enter` to
  execute, `Esc` to cancel)
- `options.html` + `options.ts`: key-binding editor; pure relay to the service
  worker, which is the single source of validation truth

The content script does **no DOM mutation** beyond the overlay. All
tab/group operations go through the service worker via
`chrome.runtime.sendMessage`.

## Key constraints

- **Permissions**: `tabs` + `tabGroups` + `storage` + `readingList` only. This
  is a primary design goal; do not add host permissions or `activeTab`.
  `storage` exists solely to persist key bindings (`chrome.storage.sync`, key
  `config`); `readingList` exists solely for the reading-list add/remove
  actions.
- **Configurable keys**: leader and per-action keys come from `config.json`
  defaults plus user overrides. Bindable set: `a-z A-Z 0 $ , . ;` (digits 1-9
  are reserved for counts; the leader may not be `0`). Each binding is one or
  two characters; the set must be prefix-free (no binding may equal or start
  another). The content-script parser walks a trie built from the bindings.
  Validation lives only in the service worker.
- **Vimium coexistence**: the *defaults* avoid Vimium's default keys (Vimium
  owns: `h l i m j k J K g G f F t T x X W r o O b B d u H L gg yy p P / n N v
  V ? gi gs yt << >> [[ ]] zH zL ge gu`). Users may rebind onto Vimium keys;
  resolving such conflicts is their responsibility, since listener registration
  order between extensions is unspecified and Vimium can swallow a key
  mid-sequence when it wins the race.
- **MV3 service worker**: no persistent background page; use event-driven
  patterns. `chrome.commands` entries in manifest serve as fallback for
  `chrome://` pages where content scripts can't run.
- **Script formats**: the worker side is ES modules; the page side
  (`messaging.ts`, `content.ts`, `options.ts`) must stay classic scripts
  because MV3 content scripts cannot be ES modules (sharing happens via
  globals and the ambient types in `types.d.ts`).

## Testing

Content-script tests evaluate the plain browser scripts in-realm via
`loadScript` in `tests/chrome-mock.ts`: the script source is wrapped in
`new Function`, with sandbox entries (e.g. the mocked `chrome`) shadowing
globals as parameters, and the requested top-level bindings returned by name.
Service-worker tests import `dist/background.js` as a real module instead:
`vi.stubGlobal` supplies the mocked `chrome`/`fetch`, and `vi.resetModules()`
gives each test a fresh worker instance.
