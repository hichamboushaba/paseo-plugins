import { type PluginButtonIconProps, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect } from "react";
import { keepAwakeSettings } from "../shared/settings.js";

export function KeepAwakeIcon({ size, color, theme }: PluginButtonIconProps) {
  const settings = useSettings(keepAwakeSettings);
  const enabled = settings.status === "ready" ? settings.values.enabled : true;
  const { reload } = settings;

  // The host replaces this icon with a spinner while onPress runs, so a settings
  // change pushed during the press arrives while the query has no observers and
  // is never refetched. Re-read once per mount to pick up what was missed.
  useEffect(() => {
    void reload().catch(() => undefined);
  }, []);

  return (
    <Icon
      name={enabled ? "Coffee" : "Moon"}
      size={size}
      color={enabled ? color : theme.colors.foregroundMuted}
    />
  );
}
