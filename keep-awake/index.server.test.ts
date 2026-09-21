import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import type { PaseoApi } from "@getpaseo/client";
import type {
  PluginServerContext,
  PluginSettings,
  PluginSettingsState,
  PluginHookContext,
  PluginHookAgent,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";
import { keepAwakeSettings } from "./shared/settings.js";
import { HoldTracker } from "./server/tracker.js";
import { SleepSuppressor, type SpawnFn } from "./server/suppressor.js";
import contribute from "./index.server.js";

// contribute() fires an unconditional startup reconcile synchronously, before a test ever gets a
// chance to capture a fake `paseo`, and that first call always goes through this CLI fallback.
// Pointing it at a nonexistent binary keeps every test in this file from ever touching a real
// `paseo` install or daemon. Node runs each `--test` file in its own process, so this is scoped
// to this file only.
process.env.PASEO_CLI = "/nonexistent/paseo-keep-awake-test-stub";

type SettingsState = PluginSettingsState<typeof keepAwakeSettings.schema>;
type AnyLifecycleHandler = (event: never, context: PluginHookContext) => void | Promise<void>;
type FakeListResult = { entries: { agent: { id: string } }[]; pageInfo: { hasMore: boolean; nextCursor: string | null } };

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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeAgent(id: string): PluginHookAgent {
  return { id, workspaceId: null, parentAgentId: null, provider: "test", cwd: "/tmp/keep-awake-test", title: null };
}

function fakePaseoWithRunning(ids: string[]): PaseoApi {
  const result: FakeListResult = {
    entries: ids.map((id) => ({ agent: { id } })),
    pageInfo: { hasMore: false, nextCursor: null },
  };
  return { agents: { list: () => Promise.resolve(result) } } as never as PaseoApi;
}

function fakePaseoWithDeferredList(): { paseo: PaseoApi; resolveList: (result: FakeListResult) => void } {
  let resolve: ((result: FakeListResult) => void) | undefined;
  const pending = new Promise<FakeListResult>((res) => {
    resolve = res;
  });
  const paseo = { agents: { list: () => pending } } as never as PaseoApi;
  return { paseo, resolveList: (result) => resolve?.(result) };
}

// Mirrors `recorder()`/`FakeChild`: a minimal fake of the plugin/server contract, providing just
// enough of `registerSettings`/`on` for `contribute()` to run, plus test-only hooks (`emit`,
// `resolveSettings`, `publishSettings`, `rejectSettings`) to drive it deterministically instead of going through a
// real daemon.
function createFakeContext() {
  const handlers = new Map<keyof PluginLifecycleEvents, AnyLifecycleHandler[]>();

  let resolveSettingsRead: ((state: SettingsState) => void) | undefined;
  let rejectSettingsRead: ((error: unknown) => void) | undefined;
  const settingsRead = new Promise<SettingsState>((resolve, reject) => {
    resolveSettingsRead = resolve;
    rejectSettingsRead = reject;
  });
  const settingsSubscribers: Array<(state: SettingsState) => void | Promise<void>> = [];

  const settings: PluginSettings<typeof keepAwakeSettings.schema> = {
    read: () => settingsRead,
    subscribe: (listener) => {
      settingsSubscribers.push(listener);
      return () => {
        const index = settingsSubscribers.indexOf(listener);
        if (index !== -1) {
          settingsSubscribers.splice(index, 1);
        }
      };
    },
  };

  const on: PluginServerContext["on"] = (name, handler) => {
    const list = handlers.get(name) ?? [];
    list.push(handler as AnyLifecycleHandler);
    handlers.set(name, list);
    return () => {
      handlers.set(
        name,
        (handlers.get(name) ?? []).filter((existing) => existing !== handler),
      );
    };
  };

  const context: PluginServerContext = {
    registerSettings: () => settings as never,
    handle: () => {},
    registerProvider: () => {},
    on,
    before: () => () => {},
  };

  function emit<Name extends keyof PluginLifecycleEvents>(
    name: Name,
    event: PluginLifecycleEvents[Name],
    paseo: PaseoApi,
  ): void {
    const hookContext: PluginHookContext = { paseo, signal: new AbortController().signal };
    for (const handler of handlers.get(name) ?? []) {
      void handler(event as never, hookContext);
    }
  }

  function resolveSettings(state: SettingsState): void {
    resolveSettingsRead?.(state);
  }

  function publishSettings(state: SettingsState): void {
    for (const listener of settingsSubscribers) {
      void listener(state);
    }
  }

  function rejectSettings(error: unknown): void {
    rejectSettingsRead?.(error);
  }

  return { context, emit, resolveSettings, publishSettings, rejectSettings };
}

test("a stale reconcile snapshot does not drop a hold added mid-flight", async () => {
  const { context, emit } = createFakeContext();
  const tracker = new HoldTracker();
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 999, spawnFn);
  const { paseo, resolveList } = fakePaseoWithDeferredList();

  const cleanup = contribute(context, { tracker, suppressor });
  try {
    // Capturing `paseo` for the first time kicks off a reconcile that awaits the snapshot below.
    emit("agent.created", { agent: fakeAgent("bootstrap") }, paseo);

    // While that reconcile is in flight, a turn starts for an agent the snapshot -- taken before
    // this turn began -- has no way to know about.
    emit("agent.turn_started", { agent: fakeAgent("a"), turnId: null }, paseo);
    assert.deepEqual(tracker.ids(), ["a"]);

    // The snapshot reflects the world as it was when the reconcile started: nothing running yet.
    resolveList({ entries: [], pageInfo: { hasMore: false, nextCursor: null } });
    await flushMicrotasks();

    assert.deepEqual(tracker.ids(), ["a"]);
    assert.equal(tracker.holding, true);
  } finally {
    cleanup();
  }
});

test("an unchanged reconcile still re-applies so a suppression child that died on its own is re-armed", async () => {
  const { context, emit } = createFakeContext();
  const tracker = new HoldTracker();
  tracker.add("a");
  const { children, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 999, spawnFn);

  // Pre-arm the suppressor as if an earlier apply() already started holding for "a", then let
  // that child die on its own -- e.g. the user ran `pkill caffeinate` in "always" mode.
  suppressor.sync(true, { keepDisplayAwake: false, customCommand: "" });
  assert.equal(children.length, 1);
  children[0]?.emit("exit", 0, null);
  assert.equal(suppressor.active, false);

  const paseo = fakePaseoWithRunning(["a"]);
  const cleanup = contribute(context, { tracker, suppressor });
  try {
    emit("agent.created", { agent: fakeAgent("bootstrap") }, paseo);
    await flushMicrotasks();

    assert.equal(suppressor.active, true);
    assert.equal(children.length, 2);
  } finally {
    cleanup();
  }
});

test("a reconcile still in flight when the plugin is disposed does not repopulate the tracker or spawn", async () => {
  const { context, emit } = createFakeContext();
  const tracker = new HoldTracker();
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 999, spawnFn);
  const { paseo, resolveList } = fakePaseoWithDeferredList();

  const cleanup = contribute(context, { tracker, suppressor });
  emit("agent.created", { agent: fakeAgent("bootstrap") }, paseo);

  cleanup();
  assert.deepEqual(tracker.ids(), []);

  // The snapshot the disposed reconcile was waiting on finally arrives, reporting an agent the
  // tracker never saw.
  resolveList({ entries: [{ agent: { id: "ghost" } }], pageInfo: { hasMore: false, nextCursor: null } });
  await flushMicrotasks();

  assert.deepEqual(tracker.ids(), []);
  assert.equal(calls.length, 0);
});

test("a pending settings read that resolves after cleanup does not spawn", async () => {
  const { context, resolveSettings } = createFakeContext();
  const tracker = new HoldTracker();
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 999, spawnFn);

  const cleanup = contribute(context, { tracker, suppressor });
  cleanup();

  // The startup settings read was still pending when cleanup() ran; simulate it resolving
  // afterwards with a mode that would definitely try to hold if apply() were still reachable.
  resolveSettings({ status: "ready", revision: "1", values: { mode: "always", keepDisplayAwake: false, customCommand: "" } });
  await flushMicrotasks();

  assert.equal(calls.length, 0);
  assert.equal(suppressor.active, false);
});

test("a settings update delivered via subscribe before read() resolves is not overwritten by the stale read", async () => {
  const { context, resolveSettings, publishSettings } = createFakeContext();
  const tracker = new HoldTracker();
  const { calls, spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 999, spawnFn);

  const cleanup = contribute(context, { tracker, suppressor });
  try {
    // subscribe() delivers a ready "always" state while the startup read() promise is still
    // pending.
    publishSettings({ status: "ready", revision: "2", values: { mode: "always", keepDisplayAwake: false, customCommand: "" } });
    assert.equal(suppressor.active, true);
    assert.equal(calls.length, 1);

    // The startup read() finally resolves with a stale "off" snapshot taken before the
    // subscription update above -- it must not clobber the newer value.
    resolveSettings({ status: "ready", revision: "1", values: { mode: "off", keepDisplayAwake: false, customCommand: "" } });
    await flushMicrotasks();

    assert.equal(suppressor.active, true);
    assert.equal(calls.length, 1);
  } finally {
    cleanup();
  }
});

test("a settings read that rejects is caught instead of killing the plugin subprocess", async () => {
  const { context, rejectSettings } = createFakeContext();
  const tracker = new HoldTracker();
  const { spawnFn } = recorder();
  const suppressor = new SleepSuppressor("darwin", 999, spawnFn);

  // read() is an RPC to the plugin host, so a transport error during load is plausible. Node's
  // default --unhandled-rejections=throw would terminate the subprocess, so cleanup() would never
  // run and a custom command without {pid} would be orphaned holding the host awake.
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);

  const cleanup = contribute(context, { tracker, suppressor });
  try {
    rejectSettings(new Error("relay disconnected"));
    await flushMicrotasks();
  } finally {
    cleanup();
    process.off("unhandledRejection", onRejection);
  }

  assert.deepEqual(rejections, []);
});
