import type { PluginClientContext } from "@getpaseo/plugin/client";
import { KeepAwakeSettingsScreen } from "./client/settings-screen.js";

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
  return () => {};
}
