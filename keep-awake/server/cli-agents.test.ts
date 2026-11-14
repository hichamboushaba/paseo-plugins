import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunningAgentIds, resolveCliCommand, buildCliInvocation } from "./cli-agents.js";

test("resolveCliCommand prefers PASEO_CLI and passes PASEO_HOME through", () => {
  const { command, args } = resolveCliCommand({ PASEO_CLI: "/opt/paseo", PASEO_HOME: "/h" });
  assert.equal(command, "/opt/paseo");
  assert.deepEqual(args, ["agent", "ls", "-g", "--json", "--home", "/h"]);
});

test("resolveCliCommand falls back to the PATH binary when PASEO_CLI is unset", () => {
  const { command, args } = resolveCliCommand({});
  assert.equal(command, "paseo");
  assert.deepEqual(args, ["agent", "ls", "-g", "--json"]);
});

test("resolveCliCommand treats an empty PASEO_CLI or PASEO_HOME as unset", () => {
  const { command, args } = resolveCliCommand({ PASEO_CLI: "", PASEO_HOME: "" });
  assert.equal(command, "paseo");
  assert.deepEqual(args, ["agent", "ls", "-g", "--json"]);
});

test("parseRunningAgentIds returns only running agent ids", () => {
  const stdout = JSON.stringify([
    { id: "a", status: "running" },
    { id: "b", status: "idle" },
    { id: "c", status: "running" },
  ]);
  assert.deepEqual(parseRunningAgentIds(stdout), ["a", "c"]);
});

test("parseRunningAgentIds skips entries with a missing or non-string id", () => {
  const stdout = JSON.stringify([{ status: "running" }, { id: 7, status: "running" }]);
  assert.deepEqual(parseRunningAgentIds(stdout), []);
});

test("parseRunningAgentIds skips a running entry with an empty id", () => {
  assert.deepEqual(parseRunningAgentIds(JSON.stringify([{ id: "", status: "running" }])), []);
});

test("parseRunningAgentIds skips array entries that are not objects", () => {
  const stdout = JSON.stringify([null, "running", 3, { id: "a", status: "running" }]);
  assert.deepEqual(parseRunningAgentIds(stdout), ["a"]);
});

test("parseRunningAgentIds returns null for invalid JSON", () => {
  assert.equal(parseRunningAgentIds("not json"), null);
});

test("parseRunningAgentIds returns null when the payload is not an array", () => {
  assert.equal(parseRunningAgentIds(JSON.stringify({ agents: [] })), null);
});

test("buildCliInvocation wraps a bare PATH command in cmd.exe on win32", () => {
  const invocation = buildCliInvocation("paseo", ["agent", "ls", "-g", "--json"], "win32", "C:\\Windows\\system32\\cmd.exe");
  assert.equal(invocation.command, "C:\\Windows\\system32\\cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/v:off",
    "/s",
    "/c",
    '""paseo" "agent" "ls" "-g" "--json""',
  ]);
  assert.equal(invocation.windowsVerbatimArguments, true);
});

test("buildCliInvocation wraps an explicit .cmd shim in cmd.exe on win32", () => {
  const invocation = buildCliInvocation(
    "C:\\Users\\me\\AppData\\Roaming\\npm\\paseo.cmd",
    ["agent", "ls", "-g", "--json"],
    "win32",
    "",
  );
  assert.equal(invocation.command, "cmd.exe");
  assert.match(invocation.args[4], /^""C:\\Users\\me\\AppData\\Roaming\\npm\\paseo\.cmd" "agent" "ls" "-g" "--json""$/);
  assert.equal(invocation.windowsVerbatimArguments, true);
});

test("buildCliInvocation spawns a .exe directly on win32", () => {
  const invocation = buildCliInvocation("C:\\Program Files\\paseo.exe", ["agent"], "win32");
  assert.equal(invocation.command, "C:\\Program Files\\paseo.exe");
  assert.deepEqual(invocation.args, ["agent"]);
  assert.equal(invocation.windowsVerbatimArguments, false);
});

test("buildCliInvocation keeps non-Windows invocations direct", () => {
  const invocation = buildCliInvocation("paseo", ["agent", "ls"], "linux");
  assert.equal(invocation.command, "paseo");
  assert.deepEqual(invocation.args, ["agent", "ls"]);
  assert.equal(invocation.windowsVerbatimArguments, false);
});

test("buildCliInvocation falls back to cmd.exe when ComSpec is empty on win32", () => {
  const invocation = buildCliInvocation("paseo", [], "win32", "");
  assert.equal(invocation.command, "cmd.exe");
});

test("buildCliInvocation rejects shell metacharacters in a win32 shim invocation", () => {
  assert.throws(() => buildCliInvocation('C:\\evil"paseo.cmd', [], "win32"), /Unsafe character/);
  assert.throws(() => buildCliInvocation("paseo", ["--home", "C:\\evil%PATH%"], "win32"), /Unsafe character/);
  assert.throws(() => buildCliInvocation("paseo", ["a\rb"], "win32"), /Unsafe character/);
});

test("buildCliInvocation allows metacharacters in direct non-Windows invocations", () => {
  const invocation = buildCliInvocation('/opt/paseo"weird', ['--home', '/h%x'], "linux");
  assert.equal(invocation.command, '/opt/paseo"weird');
  assert.deepEqual(invocation.args, ["--home", "/h%x"]);
});
