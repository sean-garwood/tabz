import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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
export function createChromeMock({ tabs = [], groups = {} } = {}) {
    const state = {
        tabs: [],
        groups: { ...groups },
        removed: [],
        nextGroupId: 100,
        focusedWindowId: 1,
        listeners: {},
    };

    const perWindowCount = {};
    let autoId = 1;
    for (const t of tabs) {
        const tab = { ...TAB_DEFAULTS, ...t };
        if (tab.id === undefined) tab.id = autoId;
        autoId = Math.max(autoId, tab.id) + 1;
        perWindowCount[tab.windowId] = (perWindowCount[tab.windowId] ?? -1) + 1;
        tab.index = perWindowCount[tab.windowId];
        state.tabs.push(tab);
    }

    function byId(id) {
        return state.tabs.find((t) => t.id === id);
    }

    function windowList(windowId) {
        return state.tabs
            .filter((t) => t.windowId === windowId)
            .sort((a, b) => a.index - b.index);
    }

    const chrome = {
        runtime: {
            id: "mock",
            onMessage: { addListener: (fn) => (state.listeners.message = fn) },
        },
        commands: {
            onCommand: { addListener: (fn) => (state.listeners.command = fn) },
        },
        tabs: {
            query: async (q = {}) =>
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
            move: async (tabId, { index }) => {
                const tab = byId(tabId);
                const list = windowList(tab.windowId).filter(
                    (t) => t.id !== tabId,
                );
                list.splice(Math.min(index, list.length), 0, tab);
                list.forEach((t, i) => (t.index = i));
                return { ...tab };
            },
            group: async ({ tabIds, groupId }) => {
                const gid = groupId ?? state.nextGroupId++;
                if (!(gid in state.groups))
                    state.groups[gid] = { title: "", color: "" };
                for (const id of [].concat(tabIds)) byId(id).groupId = gid;
                return gid;
            },
            ungroup: async (ids) => {
                for (const id of [].concat(ids)) byId(id).groupId = -1;
            },
            remove: async (ids) => {
                const list = [].concat(ids);
                state.removed.push(...list);
                const windows = new Set(list.map((id) => byId(id).windowId));
                state.tabs = state.tabs.filter((t) => !list.includes(t.id));
                for (const w of windows)
                    windowList(w).forEach((t, i) => (t.index = i));
            },
        },
        tabGroups: {
            get: async (id) => ({ id, ...state.groups[id] }),
            update: async (id, info) =>
                Object.assign(
                    (state.groups[id] = state.groups[id] || {}),
                    info,
                ),
        },
    };

    return { chrome, state };
}

// Evaluates an extension script in this realm, with each `sandbox` entry
// shadowing the corresponding global as a wrapper-function parameter, and
// returns the top-level bindings listed in `names`. The extension files are
// plain browser scripts with no module system, so this is the test-side
// bridge; it imposes nothing on the source files (any `function`, `const`,
// or `let` binding can be exported by name).
export function loadScript(file, sandbox, names) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    const factory = new Function(
        ...Object.keys(sandbox),
        `${code}\n;return { ${names.join(", ")} };`,
    );
    return factory(...Object.values(sandbox));
}

export function windowOrder(state, windowId) {
    return state.tabs
        .filter((t) => t.windowId === windowId)
        .sort((a, b) => a.index - b.index)
        .map((t) => t.id);
}

export function tabById(state, id) {
    return state.tabs.find((t) => t.id === id);
}
