## Distribution

### Firefox

1. Go to your [Firefox Add-ons developer dashboard](https://addons.mozilla.org/en-US/developers/)
1. If not already submitted: create a new submission with your current manifest (it already includes `browser_specific_settings.gecko.id`)
1. Wait for review (~7 days)
1. Once approved, users visit your Firefox Add-ons listing and click "Add to Firefox"
1. Tabz is installed; settings sync across Firefox and Chrome via `browser.storage.sync`

Optional: Submit to Firefox Add-ons Store for discoverability (already recommended above--this is the primary path)

---

### Safari (macOS)

1. Install Xcode (free from App Store)
1. Create a new Xcode project → App → macOS
1. Add a Safari Web Extension target to the project
1. Copy your manifest, background script, content script, and icons into the extension folder
1. Xcode auto-generates a boilerplate app wrapper
1. Sign with a free Apple Developer account (Xcode Settings → Accounts)
1. Build and submit to [App Store Connect](https://appstoreconnect.apple.com/)
1. Wait for Apple's review (~2–3 days)
1. Users download the app from the App Store; Safari extension is bundled
1. In Safari → Settings → Extensions, enable Tabz

---

### TODO

1. Firefox Add-ons
1. Safari App Store (requires Xcode; ~1 day setup)
1. Optional: Edge, Opera, Vivaldi native stores (each ~3–7 days for better discoverability)
