import assert from "node:assert/strict";
import { test } from "node:test";
import { substitutePid, tokenizeCommandLine } from "./command-line.js";

test("splits a plain command line on whitespace", () => {
  assert.deepEqual(tokenizeCommandLine("caffeinate -i -m"), { tokens: ["caffeinate", "-i", "-m"] });
});

test("keeps a double-quoted run together and drops the quotes", () => {
  assert.deepEqual(tokenizeCommandLine('systemd-inhibit --why="A Paseo agent is working"'), {
    tokens: ["systemd-inhibit", "--why=A Paseo agent is working"],
  });
});

test("keeps a single-quoted run together and drops the quotes", () => {
  assert.deepEqual(tokenizeCommandLine("systemd-inhibit --why='A Paseo agent is working'"), {
    tokens: ["systemd-inhibit", "--why=A Paseo agent is working"],
  });
});

test("a quoted empty string is still an (empty) token", () => {
  assert.deepEqual(tokenizeCommandLine('--foo=""'), { tokens: ["--foo="] });
  assert.deepEqual(tokenizeCommandLine('""'), { tokens: [""] });
});

test("one quote style can nest inside the other", () => {
  assert.deepEqual(tokenizeCommandLine(`--why='it is "quoted"'`), { tokens: ['--why=it is "quoted"'] });
  assert.deepEqual(tokenizeCommandLine(`--why="it's fine"`), { tokens: ["--why=it's fine"] });
});

test("adjacent quoted runs concatenate into a single token without a space between them", () => {
  assert.deepEqual(tokenizeCommandLine(`"foo"'bar'`), { tokens: ["foobar"] });
  assert.deepEqual(tokenizeCommandLine('"foo"bar'), { tokens: ["foobar"] });
});

test("reports an unbalanced double quote instead of guessing", () => {
  assert.deepEqual(tokenizeCommandLine('caffeinate --why="never closed'), { error: 'Unbalanced " quote' });
});

test("reports an unbalanced single quote instead of guessing", () => {
  assert.deepEqual(tokenizeCommandLine("caffeinate --why='never closed"), { error: "Unbalanced ' quote" });
});

test("blank or whitespace-only input tokenizes to nothing", () => {
  assert.deepEqual(tokenizeCommandLine(""), { tokens: [] });
  assert.deepEqual(tokenizeCommandLine("   \t  "), { tokens: [] });
});

// Backslash is a path separator on Windows, not an escape character.
test("leaves backslashes alone so Windows paths survive", () => {
  assert.deepEqual(tokenizeCommandLine("C:\\Windows\\System32\\cmd.exe /c pause"), {
    tokens: ["C:\\Windows\\System32\\cmd.exe", "/c", "pause"],
  });
});

test("substitutePid replaces the placeholder wherever it appears in a token", () => {
  assert.deepEqual(substitutePid(["caffeinate", "-w", "{pid}"], 4242), ["caffeinate", "-w", "4242"]);
  assert.deepEqual(substitutePid(["--pid={pid}"], 7), ["--pid=7"]);
});

test("substitutePid leaves tokens without the placeholder untouched", () => {
  assert.deepEqual(substitutePid(["caffeinate", "-i", "-m"], 4242), ["caffeinate", "-i", "-m"]);
});
