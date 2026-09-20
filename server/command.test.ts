import assert from "node:assert/strict";
import { test } from "node:test";
import { suppressionCommand } from "./command.js";

test("darwin prevents idle and disk sleep and watches the plugin pid", () => {
  const spec = suppressionCommand("darwin", { keepDisplayAwake: false }, 4242);
  assert.deepEqual(spec, { command: "caffeinate", args: ["-i", "-m", "-w", "4242"] });
});

test("darwin adds the display assertion when asked", () => {
  const spec = suppressionCommand("darwin", { keepDisplayAwake: true }, 4242);
  assert.deepEqual(spec, { command: "caffeinate", args: ["-i", "-m", "-d", "-w", "4242"] });
});

test("linux blocks idle and polls the plugin pid", () => {
  const spec = suppressionCommand("linux", { keepDisplayAwake: false }, 4242);
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
  const off = suppressionCommand("linux", { keepDisplayAwake: false }, 7);
  const on = suppressionCommand("linux", { keepDisplayAwake: true }, 7);
  assert.deepEqual(off, on);
});

test("win32 requests the system flag and clears it on exit", () => {
  const spec = suppressionCommand("win32", { keepDisplayAwake: false }, 99);
  assert.equal(spec?.command, "powershell.exe");
  assert.deepEqual(spec?.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  const script = spec?.args[3] ?? "";
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.match(script, /Get-Process -Id 99/);
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483648\)/);
});

test("win32 adds the display flag when asked", () => {
  const spec = suppressionCommand("win32", { keepDisplayAwake: true }, 99);
  assert.match(spec?.args[3] ?? "", /SetThreadExecutionState\(\[uint32\]2147483651\)/);
});

test("unsupported platforms return null instead of throwing", () => {
  assert.equal(suppressionCommand("freebsd", { keepDisplayAwake: false }, 1), null);
  assert.equal(suppressionCommand("aix", { keepDisplayAwake: true }, 1), null);
});
