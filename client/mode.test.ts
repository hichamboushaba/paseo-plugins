import assert from "node:assert/strict";
import { test } from "node:test";
import { readKeepAwake, setKeepAwakeMode, type RpcCaller } from "./mode.js";

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
  values: { mode: "auto", keepDisplayAwake: false },
};

test("readKeepAwake returns parsed values and the revision", async () => {
  const { rpc } = fakeRpc(ready);
  assert.deepEqual(await readKeepAwake(rpc), {
    values: { mode: "auto", keepDisplayAwake: false },
    revision: "r1",
  });
});

test("readKeepAwake returns null when the document is invalid", async () => {
  const { rpc } = fakeRpc({ status: "invalid", revision: "r1", error: "bad" });
  assert.equal(await readKeepAwake(rpc), null);
});

test("readKeepAwake returns null when stored values fail the schema", async () => {
  const { rpc } = fakeRpc({ status: "ready", revision: "r1", values: { mode: "sometimes" } });
  assert.equal(await readKeepAwake(rpc), null);
});

test("setKeepAwakeMode writes the new mode against the read revision", async () => {
  const { rpc, calls } = fakeRpc(ready);
  assert.deepEqual(await setKeepAwakeMode(rpc, "always"), {
    mode: "always",
    keepDisplayAwake: false,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.name, "settings.keep-awake.write");
  assert.deepEqual(calls[1]?.input, {
    revision: "r1",
    values: { mode: "always", keepDisplayAwake: false },
  });
});

test("setKeepAwakeMode preserves keepDisplayAwake", async () => {
  const { rpc } = fakeRpc({
    status: "ready",
    revision: "r1",
    values: { mode: "auto", keepDisplayAwake: true },
  });
  assert.deepEqual(await setKeepAwakeMode(rpc, "off"), { mode: "off", keepDisplayAwake: true });
});

test("setKeepAwakeMode does not write when the mode is already set", async () => {
  const { rpc, calls } = fakeRpc(ready);
  assert.deepEqual(await setKeepAwakeMode(rpc, "auto"), { mode: "auto", keepDisplayAwake: false });
  assert.equal(calls.length, 1);
});

test("setKeepAwakeMode returns null on a write conflict and does not retry", async () => {
  const { rpc, calls } = fakeRpc(ready, { status: "conflict", error: "stale" });
  assert.equal(await setKeepAwakeMode(rpc, "off"), null);
  assert.equal(calls.length, 2);
});

test("setKeepAwakeMode returns null when the write is rejected as invalid", async () => {
  const { rpc } = fakeRpc(ready, { status: "invalid", error: "bad" });
  assert.equal(await setKeepAwakeMode(rpc, "off"), null);
});

test("setKeepAwakeMode returns null without writing when the read fails", async () => {
  const { rpc, calls } = fakeRpc({ status: "invalid", revision: "r1", error: "bad" });
  assert.equal(await setKeepAwakeMode(rpc, "off"), null);
  assert.equal(calls.length, 1);
});
