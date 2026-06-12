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

// Leader and keys are single characters from the bindable set; that constraint
// lives in the service worker's config schema (CONFIG_SCHEMA in background.ts)
// because the values arrive at runtime from JSON and user input, where the
// type system cannot enforce it.
interface TabzConfig {
    leader: string;
    keys: Record<TabzAction, string>;
}

interface TabzConfigPayload {
    current: TabzConfig;
    defaults: TabzConfig;
    // Stored values the schema rejected and replaced with defaults.
    warnings: string[];
}

// Tab and group operations executed by the service worker.
interface TabzTabMessageMap {
    move: { delta: number };
    moveEdge: { edge: "start" | "end" };
    createGroup: {};
    joinGroup: {};
    ungroup: {};
    dissolveGroup: {};
    countMatches: { pattern: string };
    closeMatches: { pattern: string };
}

// Config plumbing between the options page / content script and the worker.
interface TabzConfigMessageMap {
    getConfig: {};
    validateConfig: { config: TabzConfig };
    setConfig: { config: TabzConfig };
}

interface TabzMessageMap extends TabzTabMessageMap, TabzConfigMessageMap {}

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

// Success payload per message type; mirrors TabzMessageMap so a response can
// be discriminated by the message that produced it.
interface TabzResponseDataMap {
    move: {};
    moveEdge: {};
    createGroup: {};
    joinGroup: {};
    ungroup: {};
    dissolveGroup: {};
    countMatches: { count: number };
    closeMatches: { count: number };
    getConfig: { config: TabzConfigPayload };
    validateConfig: {};
    setConfig: {};
}

type TabzResponseFor<K extends TabzMessageType> =
    | ({ ok: true; notice?: string } & TabzResponseDataMap[K])
    | { ok: false; notice: string };

type TabzResponse = TabzResponseFor<TabzMessageType>;

// Signature of the shared messaging helper (src/messaging.ts), declared here
// so classic scripts can reference it without imports.
type TabzSendFn = <K extends TabzMessageType>(
    msg: { type: K } & TabzMessageMap[K],
) => Promise<TabzResponseFor<K>>;

// Tab whose id is guaranteed present (always true for queried tabs with the
// tabs permission, but chrome.tabs.Tab types id as optional).
type ResolvedTab = chrome.tabs.Tab & { id: number };
