import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface MockTab {
    id: number;
    index: number;
    pinned: boolean;
    groupId: number;
    url: string;
    title: string;
    windowId: number;
    active: boolean;
}

export type MockTabInit = Partial<MockTab>;

export interface MockGroup {
    title?: string;
    color?: string;
}

export interface MockState {
    tabs: MockTab[];
    groups: Record<number, MockGroup>;
    removed: number[];
    nextGroupId: number;
    focusedWindowId: number;
    stored: Record<string, unknown>;
    listeners: {
        message?: (
            msg: TabzMessage,
            sender: { tab?: MockTab } | null,
            sendResponse: (res: TabzResponse) => void,
        ) => boolean;
        command?: (command: string) => unknown;
    };
}

interface MockQuery {
    windowId?: number;
    active?: boolean;
    lastFocusedWindow?: boolean;
}

const TAB_DEFAULTS = {
    pinned: false,
    groupId: -1,
    url: "",
    title: "",
    windowId: 1,
    active: false,
};

// In-memory stand-in for the subset of the chrome.* API the extension uses.
// Tab indices are authoritative and kept contiguous per window, mirroring
// Chrome's remove-then-insert move semantics.
export function createChromeMock({
    tabs = [],
    groups = {},
    stored = {},
}: {
    tabs?: MockTabInit[];
    groups?: Record<number, MockGroup>;
    stored?: Record<string, unknown>;
} = {}) {
    const state: MockState = {
        tabs: [],
        groups: { ...groups },
        removed: [],
        nextGroupId: 100,
        focusedWindowId: 1,
        stored: { ...stored },
        listeners: {},
    };

    const perWindowCount: Record<number, number> = {};
    let autoId = 1;
    for (const t of tabs) {
        const tab = { ...TAB_DEFAULTS, index: 0, id: t.id ?? autoId, ...t };
        autoId = Math.max(autoId, tab.id) + 1;
        perWindowCount[tab.windowId] = (perWindowCount[tab.windowId] ?? -1) + 1;
        tab.index = perWindowCount[tab.windowId];
        state.tabs.push(tab);
    }

    function byId(id: number): MockTab {
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`Mock tab ${id} not found`);
        return tab;
    }

    function windowList(windowId: number): MockTab[] {
        return state.tabs
            .filter((t) => t.windowId === windowId)
            .sort((a, b) => a.index - b.index);
    }

    const chrome = {
        runtime: {
            id: "mock",
            getURL: (path: string) => `chrome-extension://mock/${path}`,
            onMessage: {
                addListener: (
                    fn: NonNullable<MockState["listeners"]["message"]>,
                ) => (state.listeners.message = fn),
            },
        },
        commands: {
            onCommand: {
                addListener: (
                    fn: NonNullable<MockState["listeners"]["command"]>,
                ) => (state.listeners.command = fn),
            },
        },
        tabs: {
            query: async (q: MockQuery = {}) =>
                state.tabs
                    .filter(
                        (t) =>
                            (q.windowId === undefined ||
                                t.windowId === q.windowId) &&
                            (q.active === undefined || t.active === q.active) &&
                            (q.lastFocusedWindow === undefined ||
                                (t.windowId === state.focusedWindowId) ===
                                    q.lastFocusedWindow),
                    )
                    .map((t) => ({ ...t })),
            move: async (tabId: number, { index }: { index: number }) => {
                const tab = byId(tabId);
                const list = windowList(tab.windowId).filter(
                    (t) => t.id !== tabId,
                );
                list.splice(Math.min(index, list.length), 0, tab);
                list.forEach((t, i) => (t.index = i));
                return { ...tab };
            },
            group: async ({
                tabIds,
                groupId,
            }: {
                tabIds: number | number[];
                groupId?: number;
            }) => {
                const gid = groupId ?? state.nextGroupId++;
                if (!(gid in state.groups))
                    state.groups[gid] = { title: "", color: "" };
                for (const id of Array<number>().concat(tabIds))
                    byId(id).groupId = gid;
                return gid;
            },
            ungroup: async (ids: number | number[]) => {
                for (const id of Array<number>().concat(ids))
                    byId(id).groupId = -1;
            },
            remove: async (ids: number | number[]) => {
                const list = Array<number>().concat(ids);
                state.removed.push(...list);
                const windows = new Set(list.map((id) => byId(id).windowId));
                state.tabs = state.tabs.filter((t) => !list.includes(t.id));
                for (const w of windows)
                    windowList(w).forEach((t, i) => (t.index = i));
            },
        },
        tabGroups: {
            get: async (id: number) => ({ id, ...state.groups[id] }),
            update: async (id: number, info: MockGroup) =>
                Object.assign(
                    (state.groups[id] = state.groups[id] || {}),
                    info,
                ),
        },
        storage: {
            sync: {
                get: async (key: string) =>
                    key in state.stored ? { [key]: state.stored[key] } : {},
                set: async (items: Record<string, unknown>) => {
                    Object.assign(state.stored, items);
                },
            },
            onChanged: { addListener: () => {} },
        },
    };

    return { chrome, state };
}

// Serves packaged extension files from the repo root, standing in for the
// service worker's fetch of chrome.runtime.getURL resources.
export function fetchMock(url: string) {
    const file = url.replace("chrome-extension://mock/", "");
    return Promise.resolve({
        json: async () =>
            JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")),
    });
}

export function defaultConfig(): TabzConfig {
    return JSON.parse(
        fs.readFileSync(path.join(ROOT, "config.json"), "utf8"),
    ) as TabzConfig;
}

// Evaluates a compiled extension script in this realm, with each `sandbox`
// entry shadowing the corresponding global as a wrapper-function parameter,
// and returns the top-level bindings listed in `names`. The compiled files
// are plain browser scripts with no module system, so this is the test-side
// bridge; it imposes nothing on the source files (any `function`, `const`,
// or `let` binding can be exported by name).
export function loadScript<T>(
    file: string,
    sandbox: Record<string, unknown>,
    names: string[],
): T {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    const factory = new Function(
        ...Object.keys(sandbox),
        `${code}\n;return { ${names.join(", ")} };`,
    );
    return factory(...Object.values(sandbox)) as T;
}

export function windowOrder(state: MockState, windowId: number): number[] {
    return state.tabs
        .filter((t) => t.windowId === windowId)
        .sort((a, b) => a.index - b.index)
        .map((t) => t.id);
}

export function tabById(state: MockState, id: number): MockTab {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab) throw new Error(`Tab ${id} not found in mock state`);
    return tab;
}
