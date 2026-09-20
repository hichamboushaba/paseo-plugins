import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SleepSuppressor } from "./server/suppressor.js";
import { HoldTracker } from "./server/tracker.js";
import { DEFAULT_SETTINGS, keepAwakeSettings, type KeepAwakeSettings } from "./shared/settings.js";
import { statusRpc } from "./shared/status.js";

const RECONCILE_INTERVAL_MS = 60_000;
const PAGE_LIMIT = 200;

export default function contribute(server: PluginServerContext) {
  const tracker = new HoldTracker();
  const suppressor = new SleepSuppressor();
  let settingsValues: KeepAwakeSettings = DEFAULT_SETTINGS;
  let paseo: PaseoApi | null = null;

  const apply = (): void => {
    suppressor.sync(settingsValues.enabled && tracker.holding, {
      keepDisplayAwake: settingsValues.keepDisplayAwake,
    });
  };

  const settings = server.registerSettings(keepAwakeSettings);

  void settings.read().then((state) => {
    if (state.status === "ready") {
      settingsValues = state.values;
      apply();
    }
  });

  const unsubscribe = settings.subscribe((state) => {
    if (state.status === "ready") {
      settingsValues = state.values;
      apply();
    }
  });

  server.on("agent.turn_started", (event, context) => {
    paseo = context.paseo;
    tracker.add(event.agent.id);
    apply();
    console.log(
      `[keep-awake] turn_started agent=${event.agent.id} ` +
        `holding=${tracker.holding} active=${suppressor.active} ids=${tracker.ids().join(",")}`,
    );
  });

  server.on("agent.turn_ended", (event, context) => {
    paseo = context.paseo;
    tracker.remove(event.agent.id);
    apply();
    console.log(
      `[keep-awake] turn_ended agent=${event.agent.id} ` +
        `holding=${tracker.holding} active=${suppressor.active} ids=${tracker.ids().join(",")}`,
    );
  });

  const reconcile = async (): Promise<void> => {
    if (!tracker.holding || paseo === null) {
      return;
    }
    const running = await listRunningAgentIds(paseo);
    if (running === null) {
      return;
    }
    const dropped = tracker.reconcile(running);
    if (dropped.length > 0) {
      console.log(`[keep-awake] released stale holds: ${dropped.join(", ")}`);
      apply();
    }
  };

  const timer = setInterval(() => {
    void reconcile().catch((error: unknown) => {
      console.error("[keep-awake] reconcile failed:", error);
    });
  }, RECONCILE_INTERVAL_MS);

  server.handle(statusRpc, () => ({
    platform: process.platform,
    supported: suppressor.supported,
    holding: suppressor.active,
    heldBy: tracker.ids(),
    command: suppressor.describe({ keepDisplayAwake: settingsValues.keepDisplayAwake }),
  }));

  console.log(
    `[keep-awake] ready on ${process.platform}; ` +
      `${suppressor.supported ? "supported" : "unsupported platform, holds will be skipped"}`,
  );

  return () => {
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
