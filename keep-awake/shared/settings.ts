import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const KEEP_AWAKE_MODES = ["off", "auto", "always"] as const;

export type KeepAwakeMode = (typeof KEEP_AWAKE_MODES)[number];

// Version 1 stored `enabled: boolean`, where true meant "hold while agents work"
// and a missing value defaulted to true.
export function migrateKeepAwakeSettings(values: unknown, fromVersion: number): unknown {
  if (fromVersion >= 2 || typeof values !== "object" || values === null || Array.isArray(values)) {
    return values;
  }
  const { enabled, ...rest } = values as Record<string, unknown>;
  return { ...rest, mode: enabled === false ? "off" : "auto" };
}

export const keepAwakeSettings = defineSettings({
  id: "keep-awake",
  scope: "host",
  version: 2,
  schema: z.object({
    mode: z.enum(KEEP_AWAKE_MODES).default("auto"),
    keepDisplayAwake: z.boolean().default(false),
    customCommand: z.string().default(""),
  }),
  migrate: migrateKeepAwakeSettings,
});

export type KeepAwakeSettings = z.output<typeof keepAwakeSettings.schema>;

export const DEFAULT_SETTINGS: KeepAwakeSettings = {
  mode: "auto",
  keepDisplayAwake: false,
  customCommand: "",
};

export function shouldHold(mode: KeepAwakeMode, agentRunning: boolean): boolean {
  return mode === "always" || (mode === "auto" && agentRunning);
}
