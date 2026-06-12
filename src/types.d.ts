// Shared message protocol between the content script and the service worker.
// Ambient declarations (no imports/exports) keep both source files classic
// scripts: MV3 content scripts cannot be ES modules, so the compiled output
// must have no module wrapper.

interface TabzMessageMap {
    move: { delta: number };
    moveEdge: { edge: "start" | "end" };
    createGroup: {};
    joinGroup: {};
    ungroup: {};
    dissolveGroup: {};
    countMatches: { pattern: string };
    closeMatches: { pattern: string };
}

type TabzMessageType = keyof TabzMessageMap;

type TabzMessage = {
    [K in TabzMessageType]: { type: K } & TabzMessageMap[K];
}[TabzMessageType];

// "prompt" is content-script-internal: it opens the regex HUD and is never
// sent to the service worker.
interface TabzCommandMap extends TabzMessageMap {
    prompt: {};
}

type TabzCommand = {
    [K in keyof TabzCommandMap]: { type: K } & TabzCommandMap[K];
}[keyof TabzCommandMap];

type TabzResponse =
    | { ok: true; notice?: string; count?: number }
    | { ok: false; notice: string };

// Tab whose id is guaranteed present (always true for queried tabs with the
// tabs permission, but chrome.tabs.Tab types id as optional).
type ResolvedTab = chrome.tabs.Tab & { id: number };
