import assert from "node:assert/strict";
import { test } from "node:test";
import { suppressionCommand, type SuppressionCommand, type SuppressionResolution } from "./command.js";

function spec(resolution: SuppressionResolution): SuppressionCommand {
  if (resolution.status !== "ok") {
    assert.fail(`expected a runnable command, got "${resolution.status}"`);
  }
  return resolution.spec;
}

test("darwin prevents idle and disk sleep and watches the plugin pid", () => {
  const resolved = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: "" }, 4242);
  assert.deepEqual(resolved, { status: "ok", spec: { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] } });
});

test("darwin adds the display assertion when asked", () => {
  const resolved = suppressionCommand("darwin", { keepDisplayAwake: true, customCommand: "" }, 4242);
  assert.deepEqual(resolved, {
    status: "ok",
    spec: { command: "caffeinate", args: ["-i", "-m", "-d", "-w", "4242"] },
  });
});

test("linux blocks idle and polls the plugin pid", () => {
  const linux = spec(suppressionCommand("linux", { keepDisplayAwake: false, customCommand: "" }, 4242));
  assert.equal(linux.command, "systemd-inhibit");
  assert.deepEqual(linux.args.slice(0, 4), [
    "--what=idle",
    "--who=paseo-keep-awake",
    "--why=A Paseo agent is working",
    "--mode=block",
  ]);
  assert.deepEqual(linux.args.slice(4, 6), ["sh", "-c"]);
  assert.match(linux.args[6] ?? "", /kill -0 4242/);
});

test("linux ignores keepDisplayAwake because systemd-inhibit has no display scope", () => {
  const off = suppressionCommand("linux", { keepDisplayAwake: false, customCommand: "" }, 7);
  const on = suppressionCommand("linux", { keepDisplayAwake: true, customCommand: "" }, 7);
  assert.deepEqual(off, on);
});

test("win32 requests the system flag and clears it on exit", () => {
  const win = spec(suppressionCommand("win32", { keepDisplayAwake: false, customCommand: "" }, 99));
  assert.equal(win.command, "powershell.exe");
  assert.deepEqual(win.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  const script = win.args[3] ?? "";
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.match(script, /Get-Process -Id 99/);
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483648\)/);
});

test("win32 adds the display flag when asked", () => {
  const win = spec(suppressionCommand("win32", { keepDisplayAwake: true, customCommand: "" }, 99));
  assert.match(win.args[3] ?? "", /SetThreadExecutionState\(\[uint32\]2147483651\)/);
});

test("unsupported platforms report unsupported instead of throwing", () => {
  const resolved = suppressionCommand("freebsd", { keepDisplayAwake: false, customCommand: "" }, 1);
  assert.deepEqual(resolved, { status: "unsupported" });
  assert.deepEqual(suppressionCommand("aix", { keepDisplayAwake: true, customCommand: "" }, 1), {
    status: "unsupported",
  });
});

test("a custom command substitutes {pid} with the watched process id", () => {
  const resolved = suppressionCommand(
    "darwin",
    { keepDisplayAwake: false, customCommand: "caffeinate -i -m -w {pid}" },
    4242,
  );
  assert.deepEqual(resolved, { status: "ok", spec: { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] } });
});

test("a custom command ignores keepDisplayAwake because it replaces the built-in command entirely", () => {
  const off = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: "echo hi" }, 4242);
  const on = suppressionCommand("darwin", { keepDisplayAwake: true, customCommand: "echo hi" }, 4242);
  assert.deepEqual(off, on);
});

test("a blank custom command falls back to the platform's built-in command", () => {
  const resolved = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: "   " }, 4242);
  assert.deepEqual(resolved, { status: "ok", spec: { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] } });
});

test("an untokenisable custom command reports why rather than falling back", () => {
  const resolved = suppressionCommand(
    "darwin",
    { keepDisplayAwake: false, customCommand: 'caffeinate --why="never closed' },
    4242,
  );
  assert.deepEqual(resolved, { status: "invalid", error: 'Unbalanced " quote' });
});

test("a custom command makes an unsupported platform work", () => {
  const resolved = suppressionCommand("freebsd", { keepDisplayAwake: false, customCommand: "echo hi" }, 1);
  assert.deepEqual(resolved, { status: "ok", spec: { command: "echo", args: ["hi"] } });
});

test("a custom command with a quoted empty first token names the missing program instead of spawning it", () => {
  const resolved = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: '"" -w {pid}' }, 4242);
  assert.deepEqual(resolved, { status: "invalid", error: "Command must start with a program name" });
});

// The platform is beside the point when the command the user typed cannot run: telling them the
// host is unsupported would hide the typo that is actually stopping the hold.
test("an invalid custom command reports invalid rather than unsupported on an unsupported platform", () => {
  const resolved = suppressionCommand("freebsd", { keepDisplayAwake: false, customCommand: '""' }, 1);
  assert.deepEqual(resolved, { status: "invalid", error: "Command must start with a program name" });
});

test("an empty argument is fine as long as the program name is not the empty one", () => {
  const custom = 'runner --label="" ""';
  const resolved = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: custom }, 4242);
  assert.deepEqual(resolved, { status: "ok", spec: { command: "runner", args: ["--label=", ""] } });
});
