import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listRunningAgentIdsViaCli } from "./server/cli-agents.js";
import { SleepSuppressor } from "./server/suppressor.js";
import { HoldTracker } from "./server/tracker.js";
import {
  DEFAULT_SETTINGS,
  keepAwakeSettings,
  shouldHold,
  type KeepAwakeSettings,
} from "./shared/settings.js";
import { statusRpc } from "./shared/status.js";

const RECONCILE_INTERVAL_MS = 60_000;
const PAGE_LIMIT = 200;

export default function contribute(
  server: PluginServerContext,
  dependencies: { tracker?: HoldTracker; suppressor?: SleepSuppressor } = {},
) {
  const tracker = dependencies.tracker ?? new HoldTracker();
  const suppressor = dependencies.suppressor ?? new SleepSuppressor();
  let settingsValues: KeepAwakeSettings = DEFAULT_SETTINGS;
  let paseo: PaseoApi | null = null;
  let disposed = false;

  const apply = (): void => {
    if (disposed) {
      return;
    }
    suppressor.sync(shouldHold(settingsValues.mode, tracker.holding), {
      keepDisplayAwake: settingsValues.keepDisplayAwake,
      customCommand: settingsValues.customCommand,
    });
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

  const capture = (context: { paseo: PaseoApi }): void => {
    const isFirst = paseo === null;
    paseo = context.paseo;
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

  server.on("agent.created", (_event, context) => capture(context));
  server.on("agent.archived", (_event, context) => capture(context));
  server.on("workspace.created", (_event, context) => capture(context));
  server.on("workspace.archived", (_event, context) => capture(context));

  const timer = setInterval(() => {
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
    tracker.clear();
    suppressor.stop();
  };
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
