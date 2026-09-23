import assert from "node:assert/strict";
import { test } from "node:test";
import { applySubagentUpdate, type SubagentUpdate } from "./subagents.js";
import { HoldTracker } from "./tracker.js";

const now = () => new Date(Date.now()).toISOString();
const stale = () => new Date(Date.now() - 6 * 60_000).toISOString();

test("applySubagentUpdate", () => {
  const cases: { name: string; preheld?: string; update: SubagentUpdate; expected: boolean }[] = [
    {
      name: "a running upsert adds",
      update: { kind: "upsert", subagent: { id: "s1", parentAgentId: "p1", status: "running", updatedAt: now() } },
      expected: true,
    },
    {
      name: "a repeated running upsert is not a second add",
      preheld: "p1/s1",
      update: { kind: "upsert", subagent: { id: "s1", parentAgentId: "p1", status: "running", updatedAt: now() } },
      expected: false,
    },
    {
      name: "a completed upsert removes",
      preheld: "p1/s1",
      update: { kind: "upsert", subagent: { id: "s1", parentAgentId: "p1", status: "completed", updatedAt: now() } },
      expected: true,
    },
    {
      name: "a failed upsert removes",
      preheld: "p1/s1",
      update: { kind: "upsert", subagent: { id: "s1", parentAgentId: "p1", status: "failed", updatedAt: now() } },
      expected: true,
    },
    {
      name: "a canceled upsert removes",
      preheld: "p1/s1",
      update: { kind: "upsert", subagent: { id: "s1", parentAgentId: "p1", status: "canceled", updatedAt: now() } },
      expected: true,
    },
    {
      name: "a remove kind removes",
      preheld: "p1/s1",
      update: { kind: "remove", parentAgentId: "p1", subagentId: "s1" },
      expected: true,
    },
    {
      name: "a timeline update changes nothing",
      update: { kind: "timeline" },
      expected: false,
    },
    {
      name: "a stale running upsert is ignored",
      update: { kind: "upsert", subagent: { id: "s1", parentAgentId: "p1", status: "running", updatedAt: stale() } },
      expected: false,
    },
  ];

  for (const { name, preheld, update, expected } of cases) {
    const holds = new HoldTracker();
    if (preheld !== undefined) {
      holds.add(preheld);
    }
    assert.equal(applySubagentUpdate(holds, update), expected, name);
  }
});
