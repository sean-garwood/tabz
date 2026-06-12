import { expect, test } from "vitest";
import { createChromeMock, loadScript, windowOrder, tabById } from "./chrome-mock.js";

function setup(tabs, groups) {
  const { chrome, state } = createChromeMock({ tabs, groups });
  const exports = loadScript("background.js", { chrome }, [
    "handleMessage",
    "groupTitleFor",
    "groupColorFor",
    "GROUP_COLORS",
  ]);
  return {
    state,
    exports,
    handle: exports.handleMessage,
    sender: (id) => ({ tab: tabById(state, id) }),
  };
}

test("move shifts the tab by delta", async () => {
  const { state, handle, sender } = setup([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const res = await handle({ type: "move", delta: 1 }, sender(2));
  expect(res.ok).toBe(true);
  expect(windowOrder(state, 1)).toEqual([1, 3, 2]);
});

test("move clamps at the right edge", async () => {
  const { state, handle, sender } = setup([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await handle({ type: "move", delta: 99 }, sender(1));
  expect(windowOrder(state, 1)).toEqual([2, 3, 1]);
});

test("move clamps at the left edge", async () => {
  const { state, handle, sender } = setup([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await handle({ type: "move", delta: -5 }, sender(1));
  expect(windowOrder(state, 1)).toEqual([1, 2, 3]);
});

test("unpinned tab cannot move into the pinned region", async () => {
  const { state, handle, sender } = setup([
    { id: 1, pinned: true },
    { id: 2, pinned: true },
    { id: 3 },
    { id: 4 },
  ]);
  await handle({ type: "move", delta: -9 }, sender(3));
  expect(windowOrder(state, 1)).toEqual([1, 2, 3, 4]);
});

test("pinned tab stays inside the pinned region", async () => {
  const { state, handle, sender } = setup([
    { id: 1, pinned: true },
    { id: 2, pinned: true },
    { id: 3 },
    { id: 4 },
  ]);
  await handle({ type: "move", delta: 9 }, sender(1));
  expect(windowOrder(state, 1)).toEqual([2, 1, 3, 4]);
});

test("moveEdge start lands just after the pinned region", async () => {
  const { state, handle, sender } = setup([
    { id: 1, pinned: true },
    { id: 2, pinned: true },
    { id: 3 },
    { id: 4 },
  ]);
  await handle({ type: "moveEdge", edge: "start" }, sender(4));
  expect(windowOrder(state, 1)).toEqual([1, 2, 4, 3]);
});

test("moveEdge end moves to the last position", async () => {
  const { state, handle, sender } = setup([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await handle({ type: "moveEdge", edge: "end" }, sender(1));
  expect(windowOrder(state, 1)).toEqual([2, 3, 1]);
});

test("createGroup auto-names from the hostname and picks a palette color", async () => {
  const { state, handle, sender, exports } = setup([{ id: 1, url: "https://www.github.com/foo" }]);
  const res = await handle({ type: "createGroup" }, sender(1));
  expect(res.ok).toBe(true);
  expect(res.notice).toBe("Grouped: github.com");
  expect(tabById(state, 1).groupId).toBe(100);
  expect(state.groups[100].title).toBe("github.com");
  expect(exports.GROUP_COLORS).toContain(state.groups[100].color);
});

test("groupColorFor is deterministic", () => {
  const { exports } = setup([]);
  expect(exports.groupColorFor("github.com")).toBe(exports.groupColorFor("github.com"));
});

test("groupTitleFor falls back and strips www", () => {
  const { exports } = setup([]);
  expect(exports.groupTitleFor("https://www.github.com/x")).toBe("github.com");
  expect(exports.groupTitleFor("chrome://settings/")).toBe("settings");
  expect(exports.groupTitleFor("not a url")).toBe("tabs");
});

test("joinGroup prefers the left group on a distance tie", async () => {
  const { state, handle, sender } = setup(
    [{ id: 1, groupId: 5 }, { id: 2 }, { id: 3, groupId: 7 }],
    { 5: { title: "left" }, 7: { title: "right" } }
  );
  const res = await handle({ type: "joinGroup" }, sender(2));
  expect(res.notice).toBe("Joined: left");
  expect(tabById(state, 2).groupId).toBe(5);
});

test("joinGroup falls back to the nearest group on the right", async () => {
  const { state, handle, sender } = setup(
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, groupId: 7 }],
    { 7: { title: "right" } }
  );
  const res = await handle({ type: "joinGroup" }, sender(2));
  expect(res.notice).toBe("Joined: right");
  expect(tabById(state, 2).groupId).toBe(7);
});

test("joinGroup reports when no group exists", async () => {
  const { handle, sender } = setup([{ id: 1 }, { id: 2 }]);
  const res = await handle({ type: "joinGroup" }, sender(1));
  expect(res).toEqual({ ok: false, notice: "No group nearby" });
});

test("ungroup removes only the current tab", async () => {
  const { state, handle, sender } = setup([
    { id: 1, groupId: 5 },
    { id: 2, groupId: 5 },
  ]);
  const res = await handle({ type: "ungroup" }, sender(1));
  expect(res.ok).toBe(true);
  expect(tabById(state, 1).groupId).toBe(-1);
  expect(tabById(state, 2).groupId).toBe(5);
});

test("ungroup reports when the tab is not grouped", async () => {
  const { handle, sender } = setup([{ id: 1 }]);
  const res = await handle({ type: "ungroup" }, sender(1));
  expect(res).toEqual({ ok: false, notice: "Not in a group" });
});

test("dissolveGroup ungroups every member and nothing else", async () => {
  const { state, handle, sender } = setup([
    { id: 1, groupId: 5 },
    { id: 2, groupId: 5 },
    { id: 3, groupId: 9 },
  ]);
  const res = await handle({ type: "dissolveGroup" }, sender(1));
  expect(res.notice).toBe("Ungrouped 2 tabs");
  expect(tabById(state, 1).groupId).toBe(-1);
  expect(tabById(state, 2).groupId).toBe(-1);
  expect(tabById(state, 3).groupId).toBe(9);
});

const REGEX_FIXTURE = [
  { id: 1, url: "https://news.ycombinator.com", title: "HN" },
  { id: 2, url: "https://example.com", title: "Docs about NEWS" },
  { id: 3, url: "https://news.example.com", title: "pinned news", pinned: true },
  { id: 4, url: "https://news.other.com", title: "other window", windowId: 2 },
];

test("countMatches checks url and title, skips pinned and other windows", async () => {
  const { handle, sender } = setup(REGEX_FIXTURE);
  const res = await handle({ type: "countMatches", pattern: "news" }, sender(1));
  expect(res).toEqual({ ok: true, count: 2 });
});

test("countMatches rejects an invalid regex", async () => {
  const { handle, sender } = setup(REGEX_FIXTURE);
  const res = await handle({ type: "countMatches", pattern: "[" }, sender(1));
  expect(res).toEqual({ ok: false, notice: "Invalid regex" });
});

test("closeMatches removes exactly the matching tabs", async () => {
  const { state, handle, sender } = setup(REGEX_FIXTURE);
  const res = await handle({ type: "closeMatches", pattern: "news" }, sender(1));
  expect(res.notice).toBe("Closed 2 tabs");
  expect(state.removed.sort()).toEqual([1, 2]);
  expect(windowOrder(state, 1)).toEqual([3]);
  expect(windowOrder(state, 2)).toEqual([4]);
});

test("closeMatches with no matches removes nothing", async () => {
  const { state, handle, sender } = setup(REGEX_FIXTURE);
  const res = await handle({ type: "closeMatches", pattern: "zzzzz" }, sender(1));
  expect(res).toEqual({ ok: true, count: 0, notice: "No matches" });
  expect(state.removed).toEqual([]);
});

test("onMessage listener responds asynchronously and returns true", async () => {
  const { state } = setup([{ id: 1 }]);
  const res = await new Promise((resolve) => {
    const returned = state.listeners.message(
      { type: "ungroup" },
      { tab: tabById(state, 1) },
      resolve
    );
    expect(returned).toBe(true);
  });
  expect(res).toEqual({ ok: false, notice: "Not in a group" });
});

test("keyboard command acts on the active tab", async () => {
  const { state } = setup([{ id: 1, active: true }, { id: 2 }, { id: 3 }]);
  await state.listeners.command("move-right");
  expect(windowOrder(state, 1)).toEqual([2, 1, 3]);
});
