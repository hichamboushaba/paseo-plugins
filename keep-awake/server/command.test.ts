import assert from "node:assert/strict";
import { test } from "node:test";
import { suppressionCommand } from "./command.js";

test("darwin prevents idle and disk sleep and watches the plugin pid", () => {
  const spec = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: "" }, 4242);
  assert.deepEqual(spec, { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] });
});

test("darwin adds the display assertion when asked", () => {
  const spec = suppressionCommand("darwin", { keepDisplayAwake: true, customCommand: "" }, 4242);
  assert.deepEqual(spec, { command: "caffeinate", args: ["-i", "-m", "-d", "-w", "4242"] });
});

test("linux blocks idle and polls the plugin pid", () => {
  const spec = suppressionCommand("linux", { keepDisplayAwake: false, customCommand: "" }, 4242);
  assert.equal(spec?.command, "systemd-inhibit");
  assert.deepEqual(spec?.args.slice(0, 4), [
    "--what=idle",
    "--who=paseo-keep-awake",
    "--why=A Paseo agent is working",
    "--mode=block",
  ]);
  assert.deepEqual(spec?.args.slice(4, 6), ["sh", "-c"]);
  assert.match(spec?.args[6] ?? "", /kill -0 4242/);
});

test("linux ignores keepDisplayAwake because systemd-inhibit has no display scope", () => {
  const off = suppressionCommand("linux", { keepDisplayAwake: false, customCommand: "" }, 7);
  const on = suppressionCommand("linux", { keepDisplayAwake: true, customCommand: "" }, 7);
  assert.deepEqual(off, on);
});

test("win32 requests the system flag and clears it on exit", () => {
  const spec = suppressionCommand("win32", { keepDisplayAwake: false, customCommand: "" }, 99);
  assert.equal(spec?.command, "powershell.exe");
  assert.deepEqual(spec?.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  const script = spec?.args[3] ?? "";
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.match(script, /Get-Process -Id 99/);
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483648\)/);
});

test("win32 adds the display flag when asked", () => {
  const spec = suppressionCommand("win32", { keepDisplayAwake: true, customCommand: "" }, 99);
  assert.match(spec?.args[3] ?? "", /SetThreadExecutionState\(\[uint32\]2147483651\)/);
});

test("unsupported platforms return null instead of throwing", () => {
  assert.equal(suppressionCommand("freebsd", { keepDisplayAwake: false, customCommand: "" }, 1), null);
  assert.equal(suppressionCommand("aix", { keepDisplayAwake: true, customCommand: "" }, 1), null);
});

test("a custom command substitutes {pid} with the watched process id", () => {
  const spec = suppressionCommand(
    "darwin",
    { keepDisplayAwake: false, customCommand: "caffeinate -i -m -w {pid}" },
    4242,
  );
  assert.deepEqual(spec, { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] });
});

test("a custom command ignores keepDisplayAwake because it replaces the built-in command entirely", () => {
  const off = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: "echo hi" }, 4242);
  const on = suppressionCommand("darwin", { keepDisplayAwake: true, customCommand: "echo hi" }, 4242);
  assert.deepEqual(off, on);
});

test("a blank custom command falls back to the platform's built-in command", () => {
  const spec = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: "   " }, 4242);
  assert.deepEqual(spec, { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] });
});

test("an untokenisable custom command yields null instead of falling back", () => {
  const spec = suppressionCommand(
    "darwin",
    { keepDisplayAwake: false, customCommand: 'caffeinate --why="never closed' },
    4242,
  );
  assert.equal(spec, null);
});

test("a custom command makes an unsupported platform work", () => {
  const spec = suppressionCommand("freebsd", { keepDisplayAwake: false, customCommand: "echo hi" }, 1);
  assert.deepEqual(spec, { command: "echo", args: ["hi"] });
});

test("a custom command with a quoted empty first token yields null instead of an empty spawn target", () => {
  const spec = suppressionCommand("darwin", { keepDisplayAwake: false, customCommand: '"" -w {pid}' }, 4242);
  assert.equal(spec, null);
});
