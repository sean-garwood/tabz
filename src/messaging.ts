// Shared bridge from the content script and options page to the service
// worker. Loaded before content.js / options.js as a plain script, so the
// function is a shared global rather than a module export (see types.d.ts).
// Failures (worker restarting, extension reloaded under us) surface as a
// normal ok:false response instead of a rejection.
const tabzSendMessage: TabzSendFn = async (msg) => {
    try {
        return await chrome.runtime.sendMessage(msg);
    } catch (err) {
        return {
            ok: false,
            notice: `Tabz: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
};
