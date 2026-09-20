import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { SleepSuppressor, type SpawnFn } from "./suppressor.js";

class FakeChild extends EventEmitter {
  killed = false;
  signals: string[] = [];
  kill(signal?: string): boolean {
    this.killed = true;
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }
  unref(): void {}
}

function recorder() {
  const calls: { command: string; args: string[] }[] = [];
  const children: FakeChild[] = [];
  const spawnFn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    const child = new FakeChild();
    children.push(child);
    return child as never;
  };
  return { calls, children, spawnFn };
}

test("sync(true) spawns the platform command once", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false });
  suppressor.sync(true, { keepDisplayAwake: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "caffeinate");
  assert.equal(suppressor.active, true);
});

test("sync(false) kills the child", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false });
  suppressor.sync(false, { keepDisplayAwake: false });
  assert.equal(children[0]?.killed, true);
  assert.equal(suppressor.active, false);
});

test("sync(false) on an idle suppressor does nothing", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(false, { keepDisplayAwake: false });
  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
});

test("changing options restarts the child with the new command", () => {
  const { calls, children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false });
  suppressor.sync(true, { keepDisplayAwake: true });
  assert.equal(calls.length, 2);
  assert.equal(children[0]?.killed, true);
  assert.ok(calls[1]?.args.includes("-d"));
});

test("a child that exits on its own clears the active state", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false });
  children[0]?.emit("exit", 0, null);
  assert.equal(suppressor.active, false);
});

test("a spawn error clears the active state instead of throwing", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false });
  children[0]?.emit("error", new Error("ENOENT"));
  assert.equal(suppressor.active, false);
});

test("an unsupported platform never spawns and reports unsupported", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("freebsd", 100, spawnFn);
  assert.equal(suppressor.supported, false);
  suppressor.sync(true, { keepDisplayAwake: false });
  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
  assert.equal(suppressor.describe({ keepDisplayAwake: false }), null);
});

test("describe renders the command that would run", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  assert.equal(suppressor.describe({ keepDisplayAwake: false }), "caffeinate -i -m -w 100");
});
