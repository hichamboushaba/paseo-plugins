import assert from "node:assert/strict";
import { test } from "node:test";
import { HoldTracker } from "./tracker.js";

test("a fresh tracker holds nothing", () => {
  const tracker = new HoldTracker();
  assert.equal(tracker.holding, false);
  assert.deepEqual(tracker.ids(), []);
});

test("adding an agent starts holding", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  assert.equal(tracker.holding, true);
  assert.deepEqual(tracker.ids(), ["a"]);
});

test("adding the same agent twice is not a second hold", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.add("a");
  tracker.remove("a");
  assert.equal(tracker.holding, false);
});

test("holding continues while any other agent is still running", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.add("b");
  tracker.remove("a");
  assert.equal(tracker.holding, true);
  tracker.remove("b");
  assert.equal(tracker.holding, false);
});

test("removing an unknown agent is a no-op", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.remove("ghost");
  assert.equal(tracker.holding, true);
});

test("reconcile drops held agents the daemon no longer reports as running", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.add("b");
  const { dropped } = tracker.reconcile(["b"]);
  assert.deepEqual(dropped, ["a"]);
  assert.deepEqual(tracker.ids(), ["b"]);
});

test("reconcile returns an empty list when every hold is still running", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  assert.deepEqual(tracker.reconcile(["a", "unrelated"]).dropped, []);
  assert.equal(tracker.holding, true);
});

test("reconcile against nothing running releases every hold", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.add("b");
  assert.deepEqual(tracker.reconcile([]).dropped.sort(), ["a", "b"]);
  assert.equal(tracker.holding, false);
});

test("reconcile acquires holds for running agents it never saw", () => {
  const tracker = new HoldTracker();
  const { added, dropped } = tracker.reconcile(["a", "b"]);
  assert.deepEqual(added, ["a", "b"]);
  assert.deepEqual(dropped, []);
  assert.equal(tracker.holding, true);
  assert.deepEqual(tracker.ids().sort(), ["a", "b"]);
});

test("reconcile adds and drops in the same pass", () => {
  const tracker = new HoldTracker();
  tracker.add("stale");
  const { added, dropped } = tracker.reconcile(["fresh"]);
  assert.deepEqual(added, ["fresh"]);
  assert.deepEqual(dropped, ["stale"]);
  assert.deepEqual(tracker.ids(), ["fresh"]);
});

test("reconcile reports nothing when the tracker already matches", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  const { added, dropped } = tracker.reconcile(["a"]);
  assert.deepEqual(added, []);
  assert.deepEqual(dropped, []);
});

test("reconcile with no running agents drops everything", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.add("b");
  const { added, dropped } = tracker.reconcile([]);
  assert.deepEqual(added, []);
  assert.deepEqual(dropped.sort(), ["a", "b"]);
  assert.equal(tracker.holding, false);
});

test("clear releases every hold", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.clear();
  assert.equal(tracker.holding, false);
});
