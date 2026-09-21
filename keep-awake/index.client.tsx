import type { PluginClientContext } from "@getpaseo/plugin/client";
import { HeaderButtons } from "./client/header-buttons.js";
import { KeepAwakeIcon } from "./client/keep-awake-icon.js";
import { collectAllPages } from "./client/list-all.js";
import { KeepAwakeModePopover } from "./client/mode-popover.js";
import { setKeepAwakeMode } from "./client/mode.js";
import { MODE_PRESENTATION } from "./client/modes.js";
import { KeepAwakeSettingsScreen } from "./client/settings-screen.js";
import { KEEP_AWAKE_MODES } from "./shared/settings.js";

const REFRESH_DEBOUNCE_MS = 250;
const WORKSPACE_PAGE_LIMIT = 200;

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "keep-awake",
    title: "Settings",
    icon: "Coffee",
    Component: KeepAwakeSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "open-keep-awake-settings",
    title: "Keep awake settings",
    icon: "Coffee",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("keep-awake");
    },
  });

  for (const mode of KEEP_AWAKE_MODES) {
    const { label, icon } = MODE_PRESENTATION[mode];
    client.addCommandCenterItem({
      id: `set-keep-awake-${mode}`,
      title: `Keep awake: ${label.toLowerCase()}`,
      icon,
      keywords: ["caffeine", "sleep", "insomnia", "display", "awake"],
      context: "global",
      async onSelect({ rpc }) {
        if ((await setKeepAwakeMode(rpc, mode)) === null) {
          throw new Error("Could not change the keep-awake setting");
        }
      },
    });
  }

  const buttons = new HeaderButtons({
    add: (workspaceId) =>
      client.addHeaderButton({
        id: "keep-awake",
        workspaceId,
        button: {
          title: "Keep awake",
          icon: KeepAwakeIcon,
          behavior: {
            kind: "popover",
            Content: KeepAwakeModePopover,
          },
        },
      }),
  });

  let disposed = false;
  let stopListening: (() => void) | null = null;
  let releaseStream: (() => Promise<void>) | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;

  async function refresh(): Promise<void> {
    try {
      const first = await client.paseo.workspaces.list({ page: { limit: WORKSPACE_PAGE_LIMIT } });
      const entries = await collectAllPages(first, (cursor) =>
        client.paseo.workspaces.list({ page: { limit: WORKSPACE_PAGE_LIMIT, cursor } }),
      );
      if (!disposed) {
        buttons.reconcile(entries.map((workspace) => workspace.id));
      }
    } catch (error) {
      console.error("[keep-awake] could not list workspaces", error);
    }
  }

  function scheduleRefresh(): void {
    if (pending !== null || disposed) {
      return;
    }
    pending = setTimeout(() => {
      pending = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  void (async () => {
    try {
      const initial = await client.paseo.workspaces.list({
        subscribe: {},
        page: { limit: WORKSPACE_PAGE_LIMIT },
      });
      if (disposed) {
        await initial.subscription.release();
        return;
      }
      releaseStream = () => initial.subscription.release();
      const entries = await collectAllPages(initial, (cursor) =>
        client.paseo.workspaces.list({ page: { limit: WORKSPACE_PAGE_LIMIT, cursor } }),
      );
      if (disposed) {
        return;
      }
      buttons.reconcile(entries.map((workspace) => workspace.id));
      stopListening = client.paseo.workspaces.subscribe(scheduleRefresh);
    } catch (error) {
      console.error("[keep-awake] could not track workspaces", error);
    }
  })();

  return async () => {
    disposed = true;
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    stopListening?.();
    buttons.clear();
    await releaseStream?.();
  };
}
