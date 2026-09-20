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
  const dropped = tracker.reconcile(["b"]);
  assert.deepEqual(dropped, ["a"]);
  assert.deepEqual(tracker.ids(), ["b"]);
});

test("reconcile returns an empty list when every hold is still running", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  assert.deepEqual(tracker.reconcile(["a", "unrelated"]), []);
  assert.equal(tracker.holding, true);
});

test("reconcile against nothing running releases every hold", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.add("b");
  assert.deepEqual(tracker.reconcile([]).sort(), ["a", "b"]);
  assert.equal(tracker.holding, false);
});

test("clear releases every hold", () => {
  const tracker = new HoldTracker();
  tracker.add("a");
  tracker.clear();
  assert.equal(tracker.holding, false);
});
