import type { HoldTracker } from "./tracker.js";

// Structural subset of the `agent.provider_subagents.update` event payload (see
// `ProviderSubagentUpdateMessageSchema` in `@getpaseo/protocol/messages`). `@getpaseo/protocol` is
// only a transitive dependency of `@getpaseo/client`, so this is kept local rather than imported;
// `tsc` still checks the SDK's real payload against it wherever this is used.
export type SubagentUpdate =
  | { kind: "upsert"; subagent: { id: string; parentAgentId: string; status: string; updatedAt: string } }
  | { kind: "timeline" }
  | { kind: "remove"; parentAgentId: string; subagentId: string };

// History replay re-announces a subagent whose finish was never recorded as "running", stamped
// with its original (stale) transcript timestamp. Live updates are always stamped with the
// current time, well under this.
const STALE_RUNNING_MS = 5 * 60_000;

export function applySubagentUpdate(holds: HoldTracker, update: SubagentUpdate): boolean {
  if (update.kind === "remove") {
    return holds.remove(`${update.parentAgentId}/${update.subagentId}`);
  }
  if (update.kind !== "upsert") {
    return false;
  }
  const { id, parentAgentId, status, updatedAt } = update.subagent;
  const key = `${parentAgentId}/${id}`;
  if (status !== "running") {
    return holds.remove(key);
  }
  return Date.now() - Date.parse(updatedAt) > STALE_RUNNING_MS ? false : holds.add(key);
}
