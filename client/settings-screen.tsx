import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { keepAwakeSettings, type KeepAwakeSettings as KeepAwakeValues } from "../shared/settings.js";
import { statusRpc } from "../shared/status.js";

type Status = {
  platform: string;
  supported: boolean;
  holding: boolean;
  heldBy: string[];
  command: string | null;
};

export function KeepAwakeSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(keepAwakeSettings);
  const readStatus = useRpc(statusRpc);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void readStatus({})
        .then((next) => {
          if (!cancelled) {
            setStatus(next);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus(null);
          }
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [readStatus]);

  const styles = useMemo(
    () => ({
      screen: { gap: layout.compact ? 12 : 16 },
      label: { color: theme.colors.foregroundMuted },
      detail: { color: theme.colors.foreground },
      mono: { color: theme.colors.foregroundMuted, fontSize: 12 },
      warning: { color: theme.colors.foreground },
    }),
    [theme, layout.compact],
  );

  const ready = settings.status === "ready";
  const values = ready ? settings.values : null;

  const update = (patch: Partial<KeepAwakeValues>) => {
    if (settings.status !== "ready") {
      return;
    }
    void settings.save({ ...settings.values, ...patch }, settings.revision);
  };

  return (
    <View style={styles.screen}>
      <SettingsSection title="Keep awake">
        <SettingsCard>
          <SettingsSwitch
            label="Hold the host awake while agents work"
            hint="Starts a sleep assertion when any agent begins a turn and releases it when the last turn ends."
            value={values?.enabled ?? true}
            onValueChange={(next) => update({ enabled: next })}
            disabled={!ready || settings.saving}
          />
          <SettingsSwitch
            label="Keep the display on too"
            hint="macOS and Windows only. On Linux, idle inhibition already defers the screen blank on most desktops."
            value={values?.keepDisplayAwake ?? false}
            onValueChange={(next) => update({ keepDisplayAwake: next })}
            disabled={!ready || settings.saving}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Status">
        <SettingsCard>
          <SettingsRow label="Host platform">
            <Text style={styles.detail}>{status?.platform ?? "…"}</Text>
          </SettingsRow>
          <SettingsRow label="Currently holding">
            <Text style={styles.detail}>
              {status === null
                ? "…"
                : status.holding
                  ? `Yes — ${status.heldBy.length} agent${status.heldBy.length === 1 ? "" : "s"}`
                  : "No"}
            </Text>
          </SettingsRow>
          {status !== null && !status.supported ? (
            <SettingsRow label="Unsupported platform">
              <Text style={styles.warning}>
                No sleep-suppression command is available for {status.platform}. The plugin runs but never holds.
              </Text>
            </SettingsRow>
          ) : null}
          {status?.command != null ? (
            <SettingsRow label="Command">
              <Text style={styles.mono}>{status.command}</Text>
            </SettingsRow>
          ) : null}
        </SettingsCard>
      </SettingsSection>

      {settings.saveError !== null ? (
        <Text style={styles.label}>Could not save: {settings.saveError}</Text>
      ) : null}
    </View>
  );
}
