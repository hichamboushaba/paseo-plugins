import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 16 * 1024 * 1024;
const UNSAFE_SHELL_CHARS = /["%\r\n]/;

// On Windows, `paseo` on PATH resolves to a `.cmd` shim (npm's `paseo.cmd`). Node's
// `execFile` cannot spawn `.cmd`/`.bat` shims directly (spawn EINVAL), so route the
// invocation through `cmd.exe /c` with fully quoted arguments and verbatim args.
// Commands with a non-shim extension (e.g. `paseo.exe`) are spawned directly.
export function buildCliInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = process.env.ComSpec,
): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  const useCmdShim =
    platform === "win32" && (!/\.[^\\/.]+$/.test(command) || /\.(?:cmd|bat)$/i.test(command));
  if (useCmdShim && [command, ...args].some((arg) => UNSAFE_SHELL_CHARS.test(arg))) {
    throw new Error(`Unsafe character in Paseo CLI command or arguments: ${command}`);
  }
  if (!useCmdShim) {
    return { command, args, windowsVerbatimArguments: false };
  }
  return {
    command: comSpec && comSpec !== "" ? comSpec : "cmd.exe",
    args: ["/d", "/v:off", "/s", "/c", `"${[command, ...args].map((arg) => `"${arg}"`).join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

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
    const invocation = buildCliInvocation(command, args);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    return parseRunningAgentIds(stdout);
  } catch (error) {
    console.error("[keep-awake] cli agent listing failed:", error);
    return null;
  }
}
