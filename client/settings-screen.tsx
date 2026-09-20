import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { tokenizeCommandLine } from "../shared/command-line.js";
import {
  KEEP_AWAKE_MODES,
  keepAwakeSettings,
  type KeepAwakeMode,
  type KeepAwakeSettings as KeepAwakeValues,
} from "../shared/settings.js";
import { statusRpc } from "../shared/status.js";
import { MODE_PRESENTATION } from "./modes.js";

type Status = {
  platform: string;
  supported: boolean;
  holding: boolean;
  heldBy: string[];
  command: string | null;
  commandError: string | null;
};

export function KeepAwakeSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(keepAwakeSettings);
  const readStatus = useRpc(statusRpc);
  const [status, setStatus] = useState<Status | null>(null);
  const [draftCommand, setDraftCommand] = useState<string | null>(null);
  const commandInputRef = useRef<SettingsInputHandle>(null);

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

  const modeOptions = useMemo(
    () => KEEP_AWAKE_MODES.map((mode) => ({ label: MODE_PRESENTATION[mode].label, value: mode })),
    [],
  );

  const styles = useMemo(
    () => ({
      screen: { gap: layout.compact ? 12 : 16 },
      label: { color: theme.colors.foregroundMuted },
      detail: { color: theme.colors.foreground },
      mono: { color: theme.colors.foregroundMuted, fontSize: 12 },
      warning: { color: theme.colors.foreground },
      commandError: { color: theme.colors.statusDanger },
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

  const savedCommand = values?.customCommand ?? "";

  useEffect(() => {
    // SettingsInput only reads initialValue at mount, so the field still shows the empty
    // string it mounted with unless we push the just-loaded value in imperatively once. This
    // intentionally depends only on `ready` — it must run once on the loading-to-ready
    // transition, not on every later savedCommand change from typing or Apply.
    if (ready) {
      commandInputRef.current?.replaceText(savedCommand);
    }
  }, [ready]);

  const hasCustomCommand = savedCommand !== "";
  const effectiveDraft = draftCommand ?? savedCommand;
  const tokenized = tokenizeCommandLine(effectiveDraft);
  const tokenizeError = "error" in tokenized ? tokenized.error : null;
  const isDirty = effectiveDraft !== savedCommand;

  const applyCommand = () => {
    if (tokenizeError !== null) {
      return;
    }
    update({ customCommand: effectiveDraft });
  };

  const resetCommand = () => {
    update({ customCommand: "" });
    setDraftCommand("");
    commandInputRef.current?.replaceText("");
  };

  return (
    <View style={styles.screen}>
      <SettingsSection title="Keep awake">
        <SettingsCard>
          <SettingsSelect<KeepAwakeMode>
            label="Hold the host awake"
            hint="Choose when the plugin should stop the host from going to sleep."
            value={values?.mode ?? "auto"}
            options={modeOptions}
            onValueChange={(next) => update({ mode: next })}
            disabled={!ready || settings.saving}
          />
          <SettingsSwitch
            label="Keep the display on too"
            hint={
              hasCustomCommand
                ? "Disabled because a custom command is set below — it fully replaces the built-in command."
                : "macOS and Windows only. On Linux, idle inhibition already defers the screen blank on most desktops."
            }
            value={values?.keepDisplayAwake ?? false}
            onValueChange={(next) => update({ keepDisplayAwake: next })}
            disabled={!ready || settings.saving || hasCustomCommand}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Command">
        <SettingsCard>
          <SettingsInput
            ref={commandInputRef}
            label="Custom command"
            hint={
              'Replaces the built-in command on every platform. It must block until released and exit on ' +
              'SIGTERM. Use "{pid}" so it can watch this plugin\'s process and exit on its own if the plugin dies.'
            }
            placeholder="e.g. caffeinate -i -m -w {pid}"
            initialValue={savedCommand}
            onChangeText={setDraftCommand}
            error={tokenizeError}
            disabled={!ready || settings.saving}
          />
          <SettingsAction
            label="Apply the command above"
            actionLabel="Apply"
            onPress={applyCommand}
            disabled={!ready || settings.saving || !isDirty || tokenizeError !== null}
          />
          <SettingsAction
            label="Reset to the built-in command"
            actionLabel="Reset"
            onPress={resetCommand}
            disabled={!ready || settings.saving || (savedCommand === "" && effectiveDraft === "")}
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
          {status?.commandError != null ? (
            <SettingsRow label="Command error">
              <Text style={styles.commandError}>{status.commandError}</Text>
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
