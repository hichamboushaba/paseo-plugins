import { settingsRpc } from "@getpaseo/plugin";
import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";
import { keepAwakeSettings, type KeepAwakeSettings } from "../shared/settings.js";

export type RpcCaller = PluginCommandCapabilities["rpc"];

const settingsIo = settingsRpc(keepAwakeSettings.id);

export async function readKeepAwake(
  rpc: RpcCaller,
): Promise<{ values: KeepAwakeSettings; revision: string } | null> {
  const result = await rpc(settingsIo.read, {});
  if (result.status !== "ready") {
    return null;
  }
  const parsed = keepAwakeSettings.schema.safeParse(result.values);
  if (!parsed.success) {
    return null;
  }
  return { values: parsed.data, revision: result.revision };
}

export async function toggleKeepAwake(rpc: RpcCaller): Promise<KeepAwakeSettings | null> {
  const current = await readKeepAwake(rpc);
  if (current === null) {
    return null;
  }
  const next: KeepAwakeSettings = { ...current.values, enabled: !current.values.enabled };
  const written = await rpc(settingsIo.write, { revision: current.revision, values: next });
  return written.status === "saved" ? next : null;
}
