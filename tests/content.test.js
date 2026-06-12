import { expect, test, beforeEach } from "vitest";
import { loadScript } from "./chrome-mock.js";

// No chrome in the sandbox, so the script's install() guard keeps it from
// wiring up any DOM listeners.
const { createSequenceParser, isEditableTarget } = loadScript(
    "content.js",
    {},
    ["createSequenceParser", "isEditableTarget"],
);

function makeParser() {
    let t = 1000;
    const parser = createSequenceParser(() => t);
    return { parser, tick: (ms) => (t += ms) };
}

function feedAll(parser, keys) {
    return keys.map((k) => parser.feed(k));
}

let parser, tick;
beforeEach(() => {
    ({ parser, tick } = makeParser());
});

test("sw moves left by one", () => {
    const results = feedAll(parser, ["s", "w"]);
    expect(results[0]).toEqual({ handled: true });
    expect(results[1]).toEqual({
        handled: true,
        command: { type: "move", delta: -1 },
    });
});

test("count before the leader: 3se moves right by three", () => {
    const results = feedAll(parser, ["3", "s", "e"]);
    expect(results[0].handled).toBe(false);
    expect(results[2].command).toEqual({ type: "move", delta: 3 });
});

test("count after the leader: s3e moves right by three", () => {
    const results = feedAll(parser, ["s", "3", "e"]);
    expect(results[1].handled).toBe(true);
    expect(results[2].command).toEqual({ type: "move", delta: 3 });
});

test("zero extends a count in progress: 2s0w moves left by twenty", () => {
    const results = feedAll(parser, ["2", "s", "0", "w"]);
    expect(results[3].command).toEqual({ type: "move", delta: -20 });
});

test("bare s0 moves to the start and s$ to the end", () => {
    expect(feedAll(parser, ["s", "0"])[1].command).toEqual({
        type: "moveEdge",
        edge: "start",
    });
    expect(feedAll(parser, ["s", "$"])[1].command).toEqual({
        type: "moveEdge",
        edge: "end",
    });
});

test("counts are capped", () => {
    const results = feedAll(parser, ["1", "2", "3", "s", "w"]);
    expect(results[4].command).toEqual({ type: "move", delta: -99 });
});

test("group and prompt sequences", () => {
    expect(feedAll(parser, ["s", "c"])[1].command).toEqual({
        type: "createGroup",
    });
    expect(feedAll(parser, ["s", "a"])[1].command).toEqual({
        type: "joinGroup",
    });
    expect(feedAll(parser, ["s", "q"])[1].command).toEqual({ type: "ungroup" });
    expect(feedAll(parser, ["s", "Q"])[1].command).toEqual({
        type: "dissolveGroup",
    });
    expect(feedAll(parser, ["s", "s"])[1].command).toEqual({ type: "prompt" });
});

test("an unknown continuation cancels and passes the key through", () => {
    const results = feedAll(parser, ["s", "x", "w"]);
    expect(results[1]).toEqual({ handled: false });
    expect(results[2]).toEqual({ handled: false });
});

test("a pending sequence times out", () => {
    parser.feed("s");
    tick(3000);
    expect(parser.feed("w")).toEqual({ handled: false });
});

test("Escape cancels a pending sequence and is suppressed", () => {
    parser.feed("s");
    expect(parser.feed("Escape")).toEqual({ handled: true });
    expect(parser.feed("w")).toEqual({ handled: false });
});

test("Escape while idle clears a pending count and passes through", () => {
    parser.feed("3");
    expect(parser.feed("Escape")).toEqual({ handled: false });
    const results = feedAll(parser, ["s", "e"]);
    expect(results[1].command).toEqual({ type: "move", delta: 1 });
});

test("isEditableTarget recognizes inputs and contenteditable", () => {
    const evt = (el) => ({ composedPath: () => [el], target: el });
    expect(isEditableTarget(evt({ nodeType: 1, tagName: "INPUT" }))).toBe(true);
    expect(isEditableTarget(evt({ nodeType: 1, tagName: "TEXTAREA" }))).toBe(
        true,
    );
    expect(
        isEditableTarget(
            evt({ nodeType: 1, tagName: "DIV", isContentEditable: true }),
        ),
    ).toBe(true);
    expect(isEditableTarget(evt({ nodeType: 1, tagName: "DIV" }))).toBe(false);
    expect(
        isEditableTarget({ target: { nodeType: 1, tagName: "INPUT" } }),
    ).toBe(true);
    expect(isEditableTarget({ target: null })).toBe(false);
});
