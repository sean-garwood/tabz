// Shared message protocol between the content script and the service worker.
// Ambient declarations (no imports/exports) keep both source files classic
// scripts: MV3 content scripts cannot be ES modules, so the compiled output
// must have no module wrapper.

// One name per user-facing operation; config.json and chrome.storage key
// bindings by these names, and the content script maps them to commands.
type TabzAction =
    | "moveLeft"
    | "moveRight"
    | "moveStart"
    | "moveEnd"
    | "createGroup"
    | "joinGroup"
    | "ungroup"
    | "dissolveGroup"
    | "regexClose";

// TODO: leader/keys can only be one key.
// TODO: leader/keys must be in allowable range defined in the regex
interface TabzConfig {
    leader: string;
    keys: Record<TabzAction, string>;
}

interface TabzConfigPayload {
    current: TabzConfig;
    defaults: TabzConfig;
}

interface TabzMessageMap {
    move: { delta: number };
    moveEdge: { edge: "start" | "end" };
    createGroup: {};
    joinGroup: {};
    ungroup: {};
    dissolveGroup: {};
    countMatches: { pattern: string };
    closeMatches: { pattern: string };
    getConfig: {};
    validateConfig: { config: TabzConfig };
    setConfig: { config: TabzConfig };
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
    | { ok: true; notice?: string; count?: number; config?: TabzConfigPayload }
    | { ok: false; notice: string };

// Tab whose id is guaranteed present (always true for queried tabs with the
// tabs permission, but chrome.tabs.Tab types id as optional).
type ResolvedTab = chrome.tabs.Tab & { id: number };
