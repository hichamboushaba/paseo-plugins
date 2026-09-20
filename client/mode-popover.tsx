import { type PluginButtonContentProps, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import {
  KEEP_AWAKE_MODES,
  keepAwakeSettings,
  type KeepAwakeSettings,
} from "../shared/settings.js";
import { MODE_PRESENTATION } from "./modes.js";

const CHECK_COLUMN = 18;

export function KeepAwakeModePopover({ theme, close }: PluginButtonContentProps) {
  const settings = useSettings(keepAwakeSettings);
  const ready = settings.status === "ready";
  const values = ready ? settings.values : null;

  const styles = useMemo(
    () => ({
      root: { minWidth: 260, gap: 2 },
      heading: { color: theme.colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 6,
      },
      rowPressed: { backgroundColor: theme.colors.surface2 },
      check: { width: CHECK_COLUMN, alignItems: "center" as const },
      label: { color: theme.colors.foreground },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
      divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
      error: {
        color: theme.colors.statusDanger,
        fontSize: 11,
        paddingHorizontal: 8,
        paddingTop: 4,
      },
    }),
    [theme],
  );

  const write = async (patch: Partial<KeepAwakeSettings>): Promise<boolean> => {
    if (settings.status !== "ready") {
      return false;
    }
    return settings.save({ ...settings.values, ...patch }, settings.revision);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Keep the host awake</Text>
      {KEEP_AWAKE_MODES.map((mode) => {
        const { label, hint, icon } = MODE_PRESENTATION[mode];
        const selected = values?.mode === mode;
        return (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            accessibilityHint={hint}
            disabled={!ready || settings.saving}
            onPress={() => {
              if (selected) {
                close();
                return;
              }
              void write({ mode }).then((saved) => {
                if (saved) {
                  close();
                }
              });
            }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.check}>
              {selected ? <Icon name="Check" size={14} color={theme.colors.accent} /> : null}
            </View>
            <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
            <View>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.hint}>{hint}</Text>
            </View>
          </Pressable>
        );
      })}
      <View style={styles.divider} />
      <SettingsSwitch
        label="Keep the display on too"
        value={values?.keepDisplayAwake ?? false}
        onValueChange={(next) => void write({ keepDisplayAwake: next })}
        disabled={!ready || settings.saving}
      />
      {settings.saveError === null ? null : (
        <Text style={styles.error}>{settings.saveError}</Text>
      )}
    </View>
  );
}
