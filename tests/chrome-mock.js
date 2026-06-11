"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TAB_DEFAULTS = { pinned: false, groupId: -1, url: "", title: "", windowId: 1, active: false };

// In-memory stand-in for the subset of the chrome.* API the extension uses.
// Tab indices are authoritative and kept contiguous per window, mirroring
// Chrome's remove-then-insert move semantics.
function createChromeMock({ tabs = [], groups = {} } = {}) {
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
    return state.tabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index);
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
              (q.windowId === undefined || t.windowId === q.windowId) &&
              (q.active === undefined || t.active === q.active) &&
              (q.lastFocusedWindow === undefined ||
                (t.windowId === state.focusedWindowId) === q.lastFocusedWindow)
          )
          .map((t) => ({ ...t })),
      move: async (tabId, { index }) => {
        const tab = byId(tabId);
        const list = windowList(tab.windowId).filter((t) => t.id !== tabId);
        list.splice(Math.min(index, list.length), 0, tab);
        list.forEach((t, i) => (t.index = i));
        return { ...tab };
      },
      group: async ({ tabIds, groupId }) => {
        const gid = groupId ?? state.nextGroupId++;
        if (!(gid in state.groups)) state.groups[gid] = { title: "", color: "" };
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
        for (const w of windows) windowList(w).forEach((t, i) => (t.index = i));
      },
    },
    tabGroups: {
      get: async (id) => ({ id, ...state.groups[id] }),
      update: async (id, info) => Object.assign((state.groups[id] = state.groups[id] || {}), info),
    },
  };

  return { chrome, state };
}

// Runs an extension script in a fresh VM context; top-level function
// declarations become properties of the returned context object. URL is not
// part of a bare VM realm, so pass ours in.
function loadScript(file, sandbox = {}) {
  const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const context = vm.createContext({ URL, ...sandbox });
  vm.runInContext(code, context, { filename: file });
  return context;
}

function evalIn(context, expr) {
  return vm.runInContext(expr, context);
}

function windowOrder(state, windowId) {
  return state.tabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => a.index - b.index)
    .map((t) => t.id);
}

function tabById(state, id) {
  return state.tabs.find((t) => t.id === id);
}

module.exports = { createChromeMock, loadScript, evalIn, windowOrder, tabById };
