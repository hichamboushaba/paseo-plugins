import { type PluginButtonIconProps, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect } from "react";
import { keepAwakeSettings } from "../shared/settings.js";
import { MODE_PRESENTATION } from "./modes.js";

export function KeepAwakeIcon({ size, color }: PluginButtonIconProps) {
  const settings = useSettings(keepAwakeSettings);
  const mode = settings.status === "ready" ? settings.values.mode : "auto";
  const { reload } = settings;

  // useSettings is a replica query (staleTime: Infinity, refetchOnMount: false),
  // so a settings change pushed while no icon is mounted is invalidated but never
  // refetched, and a remounted icon would serve it stale forever. This icon does
  // unmount: HeaderButtons tears its button down whenever the workspace list
  // changes. Re-read once per mount to catch whatever was missed. The empty deps
  // are deliberate -- reload's identity changes with every query result.
  useEffect(() => {
    void reload().catch(() => undefined);
  }, []);

  return <Icon name={MODE_PRESENTATION[mode].icon} size={size} color={color} />;
}
