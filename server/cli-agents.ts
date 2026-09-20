import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export function resolveCliCommand(env: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const args = ["agent", "ls", "-g", "--json"];
  if (env.PASEO_HOME !== undefined && env.PASEO_HOME !== "") {
    args.push("--home", env.PASEO_HOME);
  }
  return { command: env.PASEO_CLI !== undefined && env.PASEO_CLI !== "" ? env.PASEO_CLI : "paseo", args };
}

export function parseRunningAgentIds(stdout: string): string[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(payload)) {
    return null;
  }
  const ids: string[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, status } = entry as { id?: unknown; status?: unknown };
    if (status === "running" && typeof id === "string" && id !== "") {
      ids.push(id);
    }
  }
  return ids;
}

export async function listRunningAgentIdsViaCli(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[] | null> {
  const { command, args } = resolveCliCommand(env);
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return parseRunningAgentIds(stdout);
  } catch (error) {
    console.error("[keep-awake] cli agent listing failed:", error);
    return null;
  }
}
