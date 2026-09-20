import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const keepAwakeSettings = defineSettings({
  id: "keep-awake",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    keepDisplayAwake: z.boolean().default(false),
  }),
});

export type KeepAwakeSettings = z.output<typeof keepAwakeSettings.schema>;

export const DEFAULT_SETTINGS: KeepAwakeSettings = {
  enabled: true,
  keepDisplayAwake: false,
};
