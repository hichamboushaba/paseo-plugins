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
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "caffeinate");
  assert.equal(suppressor.active, true);
});

test("sync(false) kills the child", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  suppressor.sync(false, { keepDisplayAwake: false, customCommand: "" });
  assert.equal(children[0]?.killed, true);
  assert.equal(suppressor.active, false);
});

test("sync(false) on an idle suppressor does nothing", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(false, { keepDisplayAwake: false, customCommand: "" });
  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
});

test("changing options restarts the child with the new command", () => {
  const { calls, children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  suppressor.sync(true, { keepDisplayAwake: true, customCommand: "" });
  assert.equal(calls.length, 2);
  assert.equal(children[0]?.killed, true);
  assert.ok(calls[1]?.args.includes("-d"));
});

test("changing the custom command respawns even though keepDisplayAwake is unchanged", () => {
  const { calls, children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo one" });
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo two" });
  assert.equal(calls.length, 2);
  assert.equal(children[0]?.killed, true);
  assert.deepEqual(calls[1], { command: "echo", args: ["two"] });
});

test("an unchanged custom command does not respawn", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo hi" });
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo hi" });
  assert.equal(calls.length, 1);
});

test("a child that exits on its own clears the active state", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  children[0]?.emit("exit", 0, null);
  assert.equal(suppressor.active, false);
});

test("a spawn error clears the active state instead of throwing", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  children[0]?.emit("error", new Error("ENOENT"));
  assert.equal(suppressor.active, false);
  assert.match(suppressor.commandError ?? "", /ENOENT/);
});

test("an unsupported platform never spawns and reports unsupported", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("freebsd", 100, spawnFn);
  assert.equal(suppressor.supported, false);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
  assert.equal(suppressor.describe({ keepDisplayAwake: false, customCommand: "" }), null);
});

test("describe renders the command that would run", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  assert.equal(suppressor.describe({ keepDisplayAwake: false, customCommand: "" }), "caffeinate -i -m -w 100");
});

test("a custom command reports an unsupported platform as supported without holding", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("freebsd", 100, spawnFn);
  suppressor.sync(false, { keepDisplayAwake: false, customCommand: "echo hi" });
  assert.equal(suppressor.supported, true);
  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
});

test("a child that exits on its own records a command error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo hi" });
  children[0]?.emit("exit", 0, null);
  assert.equal(suppressor.active, false);
  assert.match(suppressor.commandError ?? "", /echo exited on its own/);
});

test("a deliberate stop is not recorded as a command error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo hi" });
  suppressor.sync(false, { keepDisplayAwake: false, customCommand: "echo hi" });
  children[0]?.emit("exit", 0, "SIGTERM");
  assert.equal(suppressor.commandError, null);
});

test("a deliberate stop racing a spawn error is not recorded as a command error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  suppressor.sync(false, { keepDisplayAwake: false, customCommand: "" });
  children[0]?.emit("error", new Error("ENOENT"));
  assert.equal(suppressor.commandError, null);
});

test("a superseded child's exit does not record an error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo one" });
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo two" });
  children[0]?.emit("exit", 0, null);
  assert.equal(suppressor.commandError, null);
  assert.equal(suppressor.active, true);
});

test("a synchronous spawn throw is recorded rather than propagated", () => {
  const throwingSpawnFn: SpawnFn = () => {
    throw new Error("ERR_INVALID_ARG_VALUE");
  };
  const suppressor = new SleepSuppressor("darwin", 100, throwingSpawnFn);
  assert.doesNotThrow(() => {
    suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  });
  assert.equal(suppressor.active, false);
  assert.match(suppressor.commandError ?? "", /ERR_INVALID_ARG_VALUE/);
});

test("structurally different argv that formats to the same string still respawns", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: 'runner "--label keep awake"' });
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: 'runner --label "keep awake"' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.args, ["--label", "keep awake"]);
});

test("clearing the command on an unsupported platform clears a stale error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("freebsd", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo hi" });
  children[0]?.emit("error", new Error("ENOENT"));
  assert.match(suppressor.commandError ?? "", /ENOENT/);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  assert.equal(suppressor.commandError, null);
});

test("changing the command retires the previous command's error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "echo hi" });
  children[0]?.emit("exit", 0, null);
  assert.match(suppressor.commandError ?? "", /exited on its own/);
  // The turn has ended, so the user's fix is applied while no hold is wanted and start() never
  // runs -- the status card would otherwise show the new command beside the old command's error.
  suppressor.sync(false, { keepDisplayAwake: false, customCommand: "caffeinate -i -m -w {pid}" });
  assert.equal(suppressor.commandError, null);
});

test("an unchanged command keeps its error after the hold is released", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  const options = { keepDisplayAwake: false, customCommand: "echo hi" };
  suppressor.sync(true, options);
  children[0]?.emit("exit", 0, null);
  suppressor.sync(false, options);
  assert.match(suppressor.commandError ?? "", /exited on its own/);
});

test("re-arming the same command after it died clears the previous error", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  const options = { keepDisplayAwake: false, customCommand: "echo hi" };
  suppressor.sync(true, options);
  children[0]?.emit("exit", 0, null);
  // Same options, so sync()'s change detection does not clear it -- start() must.
  suppressor.sync(true, options);
  assert.equal(suppressor.commandError, null);
  assert.equal(suppressor.active, true);
});

function captureErrors(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

test("an invalid command records why instead of misreporting the platform", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  captureErrors(() => suppressor.sync(true, { keepDisplayAwake: false, customCommand: '"" -w {pid}' }));
  assert.equal(suppressor.commandError, "Command must start with a program name");
  // darwin has a perfectly good built-in command, so the platform is not what needs fixing.
  assert.equal(suppressor.supported, true);
  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
});

test("describe renders nothing for an invalid command because nothing would run", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  assert.equal(suppressor.describe({ keepDisplayAwake: false, customCommand: '""' }), null);
});

// The user asked for a command that cannot run, so continuing to hold with the previous one would
// claim a hold they did not configure. Dropping it is honest; the error says why.
test("applying an invalid command releases the hold the previous command was keeping", () => {
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "caffeinate -i -m -w {pid}" });
  assert.equal(suppressor.active, true);
  captureErrors(() => suppressor.sync(true, { keepDisplayAwake: false, customCommand: '""' }));
  assert.equal(children[0]?.signals.at(-1), "SIGTERM");
  assert.equal(suppressor.active, false);
  assert.equal(suppressor.commandError, "Command must start with a program name");
});

test("correcting an invalid command spawns it and retires the error", () => {
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  captureErrors(() => suppressor.sync(true, { keepDisplayAwake: false, customCommand: '""' }));
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "caffeinate -i -m -w {pid}" });
  assert.equal(suppressor.commandError, null);
  assert.deepEqual(calls[0], { command: "caffeinate", args: ["-i", "-m", "-w", "100"] });
  assert.equal(suppressor.active, true);
});

// An invalid command spawns nothing, so every reconcile tick re-resolves it. Without the guard
// that is a log line a minute, pushing real history out of the plugin's finite log tail.
test("an unchanged invalid command is logged once, not on every sync", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  const options = { keepDisplayAwake: false, customCommand: '""' };
  const lines = captureErrors(() => {
    suppressor.sync(true, options);
    suppressor.sync(true, options);
    suppressor.sync(true, options);
  });
  assert.deepEqual(lines, ["[keep-awake] Command must start with a program name"]);
});

// The user fixes a command between turns, so a check that only ran while holding would say nothing
// at the moment they are looking at the card.
test("an invalid command is reported even when nothing wants to hold", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  captureErrors(() => suppressor.sync(false, { keepDisplayAwake: false, customCommand: '""' }));
  assert.equal(suppressor.commandError, "Command must start with a program name");
});

// An invalid command must not answer a question about the host: freebsd has no built-in, and
// hiding that behind the command error would let the user "fix" the command into still no hold.
test("an invalid command leaves an unsupported platform reporting unsupported", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("freebsd", 100, spawnFn);
  captureErrors(() => suppressor.sync(true, { keepDisplayAwake: false, customCommand: '""' }));
  assert.equal(suppressor.supported, false);
  assert.equal(suppressor.commandError, "Command must start with a program name");
});

test("an invalid command leaves a platform with a built-in reporting supported", () => {
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 100, spawnFn);
  captureErrors(() => suppressor.sync(true, { keepDisplayAwake: false, customCommand: '""' }));
  assert.equal(suppressor.supported, true);
});
