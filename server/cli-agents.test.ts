import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunningAgentIds, resolveCliCommand } from "./cli-agents.js";

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

test("parseRunningAgentIds returns an empty array when nothing is running", () => {
  assert.deepEqual(parseRunningAgentIds(JSON.stringify([{ id: "a", status: "idle" }])), []);
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
