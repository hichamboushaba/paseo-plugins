import assert from "node:assert/strict";
import { test } from "node:test";
import { HeaderButtons } from "./header-buttons.js";

function harness() {
  const added: string[] = [];
  const removed: string[] = [];
  const buttons = new HeaderButtons({
    add(workspaceId: string) {
      added.push(workspaceId);
      return {
        update() {},
        remove() {
          removed.push(workspaceId);
        },
      };
    },
  });
  return { buttons, added, removed };
}

test("reconcile adds one registration per workspace", () => {
  const { buttons, added } = harness();
  buttons.reconcile(["a", "b"]);
  assert.deepEqual(added, ["a", "b"]);
  assert.equal(buttons.size, 2);
});

test("reconcile is idempotent for an unchanged set", () => {
  const { buttons, added, removed } = harness();
  buttons.reconcile(["a", "b"]);
  buttons.reconcile(["a", "b"]);
  assert.deepEqual(added, ["a", "b"]);
  assert.deepEqual(removed, []);
});

test("reconcile removes registrations for workspaces that disappeared", () => {
  const { buttons, removed } = harness();
  buttons.reconcile(["a", "b"]);
  buttons.reconcile(["a"]);
  assert.deepEqual(removed, ["b"]);
  assert.equal(buttons.size, 1);
});

test("reconcile adds new workspaces without touching existing ones", () => {
  const { buttons, added, removed } = harness();
  buttons.reconcile(["a"]);
  buttons.reconcile(["a", "c"]);
  assert.deepEqual(added, ["a", "c"]);
  assert.deepEqual(removed, []);
});

test("reconcile to an empty set removes everything", () => {
  const { buttons, removed } = harness();
  buttons.reconcile(["a", "b"]);
  buttons.reconcile([]);
  assert.deepEqual(removed.sort(), ["a", "b"]);
  assert.equal(buttons.size, 0);
});

test("clear removes every registration and reconcile can re-add afterwards", () => {
  const { buttons, added, removed } = harness();
  buttons.reconcile(["a"]);
  buttons.clear();
  assert.deepEqual(removed, ["a"]);
  assert.equal(buttons.size, 0);
  buttons.reconcile(["a"]);
  assert.deepEqual(added, ["a", "a"]);
});
