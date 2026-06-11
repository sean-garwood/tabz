"use strict";

const { test } = require("node:test");
// Non-strict assert: deepEqual must not compare prototypes, because the
// objects under test are created inside another VM realm.
const assert = require("node:assert");
const { loadScript } = require("./chrome-mock.js");

// No chrome global in the sandbox, so the script defines its functions
// without wiring up any DOM listeners.
const ctx = loadScript("content.js", {});

function makeParser() {
  let t = 1000;
  const parser = ctx.createSequenceParser(() => t);
  return { parser, tick: (ms) => (t += ms) };
}

function feedAll(parser, keys) {
  return keys.map((k) => parser.feed(k));
}

test("sw moves left by one", () => {
  const { parser } = makeParser();
  const results = feedAll(parser, ["s", "w"]);
  assert.deepEqual(results[0], { handled: true });
  assert.deepEqual(results[1], { handled: true, command: { type: "move", delta: -1 } });
});

test("count before the leader: 3se moves right by three", () => {
  const { parser } = makeParser();
  const results = feedAll(parser, ["3", "s", "e"]);
  assert.equal(results[0].handled, false);
  assert.deepEqual(results[2].command, { type: "move", delta: 3 });
});

test("count after the leader: s3e moves right by three", () => {
  const { parser } = makeParser();
  const results = feedAll(parser, ["s", "3", "e"]);
  assert.equal(results[1].handled, true);
  assert.deepEqual(results[2].command, { type: "move", delta: 3 });
});

test("zero extends a count in progress: 2s0w moves left by twenty", () => {
  const { parser } = makeParser();
  const results = feedAll(parser, ["2", "s", "0", "w"]);
  assert.deepEqual(results[3].command, { type: "move", delta: -20 });
});

test("bare s0 moves to the start and s$ to the end", () => {
  const { parser } = makeParser();
  assert.deepEqual(feedAll(parser, ["s", "0"])[1].command, { type: "moveEdge", edge: "start" });
  assert.deepEqual(feedAll(parser, ["s", "$"])[1].command, { type: "moveEdge", edge: "end" });
});

test("counts are capped", () => {
  const { parser } = makeParser();
  const results = feedAll(parser, ["1", "2", "3", "s", "w"]);
  assert.deepEqual(results[4].command, { type: "move", delta: -99 });
});

test("group and prompt sequences", () => {
  const { parser } = makeParser();
  assert.deepEqual(feedAll(parser, ["s", "c"])[1].command, { type: "createGroup" });
  assert.deepEqual(feedAll(parser, ["s", "a"])[1].command, { type: "joinGroup" });
  assert.deepEqual(feedAll(parser, ["s", "q"])[1].command, { type: "ungroup" });
  assert.deepEqual(feedAll(parser, ["s", "Q"])[1].command, { type: "dissolveGroup" });
  assert.deepEqual(feedAll(parser, ["s", "s"])[1].command, { type: "prompt" });
});

test("an unknown continuation cancels and passes the key through", () => {
  const { parser } = makeParser();
  const results = feedAll(parser, ["s", "x", "w"]);
  assert.deepEqual(results[1], { handled: false });
  assert.deepEqual(results[2], { handled: false });
});

test("a pending sequence times out", () => {
  const { parser, tick } = makeParser();
  parser.feed("s");
  tick(3000);
  assert.deepEqual(parser.feed("w"), { handled: false });
});

test("Escape cancels a pending sequence and is suppressed", () => {
  const { parser } = makeParser();
  parser.feed("s");
  assert.deepEqual(parser.feed("Escape"), { handled: true });
  assert.deepEqual(parser.feed("w"), { handled: false });
});

test("Escape while idle clears a pending count and passes through", () => {
  const { parser } = makeParser();
  parser.feed("3");
  assert.deepEqual(parser.feed("Escape"), { handled: false });
  const results = feedAll(parser, ["s", "e"]);
  assert.deepEqual(results[1].command, { type: "move", delta: 1 });
});

test("isEditableTarget recognizes inputs and contenteditable", () => {
  const evt = (el) => ({ composedPath: () => [el], target: el });
  assert.equal(ctx.isEditableTarget(evt({ nodeType: 1, tagName: "INPUT" })), true);
  assert.equal(ctx.isEditableTarget(evt({ nodeType: 1, tagName: "TEXTAREA" })), true);
  assert.equal(
    ctx.isEditableTarget(evt({ nodeType: 1, tagName: "DIV", isContentEditable: true })),
    true
  );
  assert.equal(ctx.isEditableTarget(evt({ nodeType: 1, tagName: "DIV" })), false);
  assert.equal(ctx.isEditableTarget({ target: { nodeType: 1, tagName: "INPUT" } }), true);
  assert.equal(ctx.isEditableTarget({ target: null }), false);
});
