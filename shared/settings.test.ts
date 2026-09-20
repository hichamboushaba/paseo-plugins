import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  keepAwakeSettings,
  migrateKeepAwakeSettings,
  shouldHold,
} from "./settings.js";

test("migrate maps an enabled v1 document onto auto", () => {
  assert.deepEqual(migrateKeepAwakeSettings({ enabled: true, keepDisplayAwake: false }, 1), {
    mode: "auto",
    keepDisplayAwake: false,
  });
});

test("migrate maps a disabled v1 document onto off and keeps the display choice", () => {
  assert.deepEqual(migrateKeepAwakeSettings({ enabled: false, keepDisplayAwake: true }, 1), {
    mode: "off",
    keepDisplayAwake: true,
  });
});

test("migrate treats a v1 document without enabled as auto, matching the old default", () => {
  assert.deepEqual(migrateKeepAwakeSettings({ keepDisplayAwake: false }, 1), {
    mode: "auto",
    keepDisplayAwake: false,
  });
});

test("migrate drops the retired enabled key", () => {
  const migrated = migrateKeepAwakeSettings({ enabled: true, keepDisplayAwake: false }, 1);
  assert.equal(Object.hasOwn(migrated as object, "enabled"), false);
});

test("migrate leaves a current document untouched", () => {
  const current = { mode: "always", keepDisplayAwake: true };
  assert.equal(migrateKeepAwakeSettings(current, 2), current);
});

test("migrate leaves a non-object document untouched for the schema to reject", () => {
  assert.equal(migrateKeepAwakeSettings(null, 1), null);
  assert.equal(migrateKeepAwakeSettings("nonsense", 1), "nonsense");
});

test("migrate leaves an array untouched instead of spreading it into a settings object", () => {
  const stored = [1, 2, 3];
  assert.equal(migrateKeepAwakeSettings(stored, 1), stored);
});

test("a migrated v1 document satisfies the current schema", () => {
  const migrated = migrateKeepAwakeSettings({ enabled: false, keepDisplayAwake: true }, 1);
  assert.deepEqual(keepAwakeSettings.schema.parse(migrated), {
    mode: "off",
    keepDisplayAwake: true,
    customCommand: "",
  });
});

test("the schema rejects a mode it does not know", () => {
  assert.equal(keepAwakeSettings.schema.safeParse({ mode: "sometimes" }).success, false);
});

test("a fresh document defaults to auto, preserving the previous behaviour", () => {
  assert.deepEqual(keepAwakeSettings.schema.parse({}), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.mode, "auto");
});

test("off never holds", () => {
  assert.equal(shouldHold("off", true), false);
  assert.equal(shouldHold("off", false), false);
});

test("auto holds only while an agent is running", () => {
  assert.equal(shouldHold("auto", true), true);
  assert.equal(shouldHold("auto", false), false);
});

test("always holds regardless of agent activity", () => {
  assert.equal(shouldHold("always", true), true);
  assert.equal(shouldHold("always", false), true);
});
