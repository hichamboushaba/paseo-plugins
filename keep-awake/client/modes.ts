import type { KeepAwakeMode } from "../shared/settings.js";

interface ModePresentation {
  readonly label: string;
  readonly hint: string;
  readonly icon: string;
}

export const MODE_PRESENTATION: Record<KeepAwakeMode, ModePresentation> = {
  off: {
    label: "Off",
    hint: "Never hold the host awake.",
    icon: "Moon",
  },
  auto: {
    label: "While an agent is working",
    hint: "Hold from the first agent turn until the last one ends.",
    icon: "Coffee",
  },
  always: {
    label: "Always",
    hint: "Hold for as long as Paseo is running.",
    icon: "Zap",
  },
};
