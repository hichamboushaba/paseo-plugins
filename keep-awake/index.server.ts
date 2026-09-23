import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listRunningAgentIdsViaCli } from "./server/cli-agents.js";
import { applySubagentUpdate } from "./server/subagents.js";
import { SleepSuppressor } from "./server/suppressor.js";
import { HoldTracker } from "./server/tracker.js";
import { DEFAULT_SETTINGS, keepAwakeSettings, shouldHold, type KeepAwakeSettings } from "./shared/settings.js";
import { statusRpc } from "./shared/status.js";

export const RECONCILE_INTERVAL_MS = 60_000;
export const RELEASE_GRACE_MS = 60_000;
const PAGE_LIMIT = 200;

export default function contribute(
  server: PluginServerContext,
  dependencies: { tracker?: HoldTracker; suppressor?: SleepSuppressor } = {},
) {
  const tracker = dependencies.tracker ?? new HoldTracker();
  // Separate from `tracker`: reconcile() replaces its contents with a fresh snapshot of running
  // agents on every tick, which would drop these push-only holds that only the subagent feed
  // maintains.
  const subagents = new HoldTracker();
  const suppressor = dependencies.suppressor ?? new SleepSuppressor();
  let settingsValues: KeepAwakeSettings = DEFAULT_SETTINGS;
  let paseo: PaseoApi | null = null;
  let disposed = false;

  const apply = (): void => {
    if (disposed) {
      return;
    }
    suppressor.sync(
      shouldHold(settingsValues.mode, tracker.holding || subagents.holding),
      { keepDisplayAwake: settingsValues.keepDisplayAwake, customCommand: settingsValues.customCommand },
      settingsValues.mode === "auto" ? RELEASE_GRACE_MS : 0,
    );
  };

  const settings = server.registerSettings(keepAwakeSettings);

  let sawSettingsUpdate = false;

  void settings
    .read()
    .then((state) => {
      if (sawSettingsUpdate || state.status !== "ready") {
        return;
      }
      settingsValues = state.values;
      apply();
    })
    .catch((error: unknown) => {
      console.error("[keep-awake] settings read failed:", error);
    });

  const unsubscribe = settings.subscribe((state) => {
    if (state.status !== "ready") {
      return;
    }
    sawSettingsUpdate = true;
    settingsValues = state.values;
    apply();
  });

  let reconcileEpoch = 0;
  let mutationEpoch = 0;

  async function reconcile(): Promise<void> {
    const epoch = ++reconcileEpoch;
    const mutationsAtStart = mutationEpoch;
    const running = paseo !== null
      ? await listRunningAgentIds(paseo)
      : await listRunningAgentIdsViaCli();
    if (disposed || running === null || epoch !== reconcileEpoch) {
      return;
    }
    // A turn_started/turn_ended handler may have mutated the tracker while we were awaiting the
    // snapshot above. That handler already applied its own change, so an add from a stale
    // snapshot is harmless (it only over-holds briefly), but a drop could release a hold for a
    // turn that started after the snapshot was taken -- skip drops whenever that race happened.
    const skipDrops = mutationEpoch !== mutationsAtStart;
    const { added, dropped } = tracker.reconcile(running, skipDrops);
    if (added.length > 0) {
      console.log(`[keep-awake] acquired missed holds: ${added.join(", ")}`);
    }
    if (dropped.length > 0) {
      console.log(`[keep-awake] released stale holds: ${dropped.join(", ")}`);
    }
    apply();
  }

  let feed: AbortController | null = null;

  // Subscribes to the daemon's subagent feed. Safe to call unconditionally: it is a no-op once
  // disposed, while a feed is already live, or before any handle has been captured. Called on
  // every captured handle and at the start of every reconcile tick, so a failed attempt is
  // retried the next time either happens.
  function ensureFeed(): void {
    if (disposed || feed !== null || paseo === null) {
      return;
    }
    const controller = new AbortController();
    // Set before subscribing: the observer's callbacks can fire synchronously, and they must see a
    // live feed rather than re-entering this guard.
    feed = controller;
    try {
      paseo.observeEvents(["agent.provider_subagents.update"], { signal: controller.signal }).subscribe({
        snapshot: () => {},
        update: (message) => {
          if (
            message.type !== "agent.provider_subagents.update" ||
            !applySubagentUpdate(subagents, message.payload)
          ) {
            return;
          }
          apply();
          console.log(
            `[keep-awake] subagent_update holding=${subagents.holding} active=${suppressor.active} ids=${subagents.ids().join(",")}`,
          );
        },
        error: (error) => {
          if (feed === controller) {
            feed = null;
          }
          console.error("[keep-awake] subagent feed failed:", error);
        },
      });
    } catch (error) {
      feed = null;
      console.error("[keep-awake] could not subscribe to subagent feed:", error);
    }
  }

  const capture = (context: { paseo: PaseoApi }): void => {
    const isFirst = paseo === null;
    paseo = context.paseo;
    ensureFeed();
    if (isFirst) {
      void reconcile().catch((error: unknown) => {
        console.error("[keep-awake] first reconcile failed:", error);
      });
    }
  };

  server.on("agent.turn_started", (event, context) => {
    capture(context);
    tracker.add(event.agent.id);
    mutationEpoch++;
    apply();
    console.log(
      `[keep-awake] turn_started agent=${event.agent.id} ` +
        `holding=${tracker.holding} active=${suppressor.active} ids=${tracker.ids().join(",")}`,
    );
  });

  server.on("agent.turn_ended", (event, context) => {
    capture(context);
    tracker.remove(event.agent.id);
    mutationEpoch++;
    apply();
    console.log(
      `[keep-awake] turn_ended agent=${event.agent.id} ` +
        `holding=${tracker.holding} active=${suppressor.active} ids=${tracker.ids().join(",")}`,
    );
  });

  // Neither permission event starts or ends a turn (see the README's permission-prompt
  // limitation), so these exist only to capture a handle sooner -- the subagent feed can then
  // start before the next turn event, which matters most right after a reload.
  server.on("agent.permission_requested", (_event, context) => capture(context));
  server.on("agent.permission_resolved", (_event, context) => capture(context));

  server.on("agent.created", (_event, context) => capture(context));
  server.on("agent.archived", (_event, context) => capture(context));
  server.on("workspace.created", (_event, context) => capture(context));
  server.on("workspace.archived", (_event, context) => capture(context));

  const timer = setInterval(() => {
    ensureFeed();
    void reconcile().catch((error: unknown) => {
      console.error("[keep-awake] reconcile failed:", error);
    });
  }, RECONCILE_INTERVAL_MS);

  void reconcile().catch((error: unknown) => {
    console.error("[keep-awake] startup reconcile failed:", error);
  });

  server.handle(statusRpc, (_input, context) => {
    capture(context);
    return {
      platform: process.platform,
      supported: suppressor.supported,
      holding: suppressor.active,
      heldBy: tracker.ids(),
      holdReason: describeHold(tracker.ids().length, subagents.ids().length, suppressor.releaseInMs),
      command: suppressor.describe({
        keepDisplayAwake: settingsValues.keepDisplayAwake,
        customCommand: settingsValues.customCommand,
      }),
      commandError: suppressor.commandError,
    };
  });

  console.log(
    `[keep-awake] ready on ${process.platform}; ` +
      `${suppressor.supported ? "supported" : "unsupported platform, holds will be skipped"}`,
  );

  return () => {
    disposed = true;
    clearInterval(timer);
    unsubscribe();
    // The daemon's plugin host disposes the PaseoApi handle before running plugin cleanup, so the
    // subscription itself is already gone -- aborting the signal we passed in is enough for the
    // library to release its own state; there is no handle left to call release() on.
    feed?.abort();
    feed = null;
    tracker.clear();
    subagents.clear();
    suppressor.stop();
  };
}

function describeHold(agents: number, subagents: number, releaseInMs: number | null): string | null {
  const parts: string[] = [];
  if (agents > 0) {
    parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
  }
  if (subagents > 0) {
    parts.push(`${subagents} subagent${subagents === 1 ? "" : "s"}`);
  }
  if (parts.length > 0) {
    return parts.join(", ");
  }
  return releaseInMs === null ? null : `releasing in ${Math.ceil(releaseInMs / 1000)} s`;
}

async function listRunningAgentIds(paseo: PaseoApi): Promise<string[] | null> {
  const ids: string[] = [];
  let cursor: string | undefined;
  try {
    for (;;) {
      const result = await paseo.agents.list({
        filter: { statuses: ["running"] },
        page: { limit: PAGE_LIMIT, cursor },
      });
      for (const entry of result.entries) {
        ids.push(entry.agent.id);
      }
      if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) {
        return ids;
      }
      cursor = result.pageInfo.nextCursor;
    }
  } catch (error) {
    console.error("[keep-awake] could not list running agents:", error);
    return null;
  }
}
