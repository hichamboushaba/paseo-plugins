import assert from "node:assert/strict";
import { test } from "node:test";
import { readKeepAwake, toggleKeepAwake, type RpcCaller } from "./toggle.js";

type ReadResult =
  | { status: "ready"; revision: string; values: unknown }
  | { status: "invalid"; revision: string; error: string };
type WriteResult =
  | { status: "saved"; revision: string; values: unknown }
  | { status: "conflict"; error: string }
  | { status: "invalid"; error: string };

type Call = { name: string; input: unknown };

function fakeRpc(
  read: ReadResult,
  write: WriteResult = { status: "saved", revision: "r2", values: {} },
): { rpc: RpcCaller; calls: Call[] } {
  const calls: Call[] = [];
  const rpc = (async (contract: { name: string }, input: unknown) => {
    calls.push({ name: contract.name, input });
    return contract.name.endsWith(".read") ? read : write;
  }) as unknown as RpcCaller;
  return { rpc, calls };
}

const ready: ReadResult = {
  status: "ready",
  revision: "r1",
  values: { enabled: true, keepDisplayAwake: false },
};

test("readKeepAwake returns parsed values and the revision", async () => {
  const { rpc } = fakeRpc(ready);
  assert.deepEqual(await readKeepAwake(rpc), {
    values: { enabled: true, keepDisplayAwake: false },
    revision: "r1",
  });
});

test("readKeepAwake returns null when the document is invalid", async () => {
  const { rpc } = fakeRpc({ status: "invalid", revision: "r1", error: "bad" });
  assert.equal(await readKeepAwake(rpc), null);
});

test("readKeepAwake returns null when stored values fail the schema", async () => {
  const { rpc } = fakeRpc({ status: "ready", revision: "r1", values: { enabled: "yes" } });
  assert.equal(await readKeepAwake(rpc), null);
});

test("toggleKeepAwake flips enabled true to false and writes the read revision", async () => {
  const { rpc, calls } = fakeRpc(ready);
  assert.deepEqual(await toggleKeepAwake(rpc), { enabled: false, keepDisplayAwake: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.name, "settings.keep-awake.write");
  assert.deepEqual(calls[1]?.input, {
    revision: "r1",
    values: { enabled: false, keepDisplayAwake: false },
  });
});

test("toggleKeepAwake flips enabled false to true", async () => {
  const { rpc } = fakeRpc({
    status: "ready",
    revision: "r1",
    values: { enabled: false, keepDisplayAwake: false },
  });
  assert.deepEqual(await toggleKeepAwake(rpc), { enabled: true, keepDisplayAwake: false });
});

test("toggleKeepAwake preserves keepDisplayAwake", async () => {
  const { rpc } = fakeRpc({
    status: "ready",
    revision: "r1",
    values: { enabled: true, keepDisplayAwake: true },
  });
  assert.deepEqual(await toggleKeepAwake(rpc), { enabled: false, keepDisplayAwake: true });
});

test("toggleKeepAwake returns null on a write conflict and does not retry", async () => {
  const { rpc, calls } = fakeRpc(ready, { status: "conflict", error: "stale" });
  assert.equal(await toggleKeepAwake(rpc), null);
  assert.equal(calls.length, 2);
});

test("toggleKeepAwake returns null when the write is rejected as invalid", async () => {
  const { rpc } = fakeRpc(ready, { status: "invalid", error: "bad" });
  assert.equal(await toggleKeepAwake(rpc), null);
});

test("toggleKeepAwake returns null without writing when the read fails", async () => {
  const { rpc, calls } = fakeRpc({ status: "invalid", revision: "r1", error: "bad" });
  assert.equal(await toggleKeepAwake(rpc), null);
  assert.equal(calls.length, 1);
});
