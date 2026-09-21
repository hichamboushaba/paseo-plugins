import { substitutePid, tokenizeCommandLine } from "../shared/command-line.js";

export interface SuppressionOptions {
  keepDisplayAwake: boolean;
  customCommand: string;
}

export interface SuppressionCommand {
  command: string;
  args: string[];
}

const WHY = "A Paseo agent is working";
const WHO = "paseo-keep-awake";

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

export function suppressionCommand(
  platform: NodeJS.Platform,
  options: SuppressionOptions,
  watchPid: number,
): SuppressionCommand | null {
  const custom = customSuppressionCommand(options.customCommand, watchPid);
  if (custom !== undefined) {
    return custom;
  }
  switch (platform) {
    case "darwin": {
      const args = ["-i", "-m"];
      if (options.keepDisplayAwake) {
        args.push("-d");
      }
      args.push("-w", String(watchPid));
      return { command: "caffeinate", args };
    }
    case "linux":
      return {
        command: "systemd-inhibit",
        args: [
          "--what=idle",
          `--who=${WHO}`,
          `--why=${WHY}`,
          "--mode=block",
          "sh",
          "-c",
          `while kill -0 ${watchPid} 2>/dev/null; do sleep 5; done`,
        ],
      };
    case "win32":
      return {
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", windowsScript(options, watchPid)],
      };
    default:
      return null;
  }
}

// A blank command means "no override" and falls through to the platform switch above
// (signalled by `undefined`). A non-blank command that fails to tokenise is a user error, not
// a reason to silently fall back to the built-in one (signalled by `null`, same as an
// unsupported platform).
function customSuppressionCommand(
  customCommand: string,
  watchPid: number,
): SuppressionCommand | null | undefined {
  const tokenized = tokenizeCommandLine(customCommand);
  if ("error" in tokenized) {
    return null;
  }
  if (tokenized.tokens.length === 0) {
    return undefined;
  }
  const [command, ...args] = substitutePid(tokenized.tokens, watchPid);
  if (command === "") {
    // A quoted empty first token (e.g. `"" -w {pid}`) tokenises but isn't spawnable — Node's
    // spawn() throws synchronously for an empty command, so treat it the same as `null` rather
    // than let that exception escape sync()/apply() and crash the plugin.
    return null;
  }
  return { command, args };
}

function windowsScript(options: SuppressionOptions, watchPid: number): string {
  const hold =
    (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | (options.keepDisplayAwake ? ES_DISPLAY_REQUIRED : 0)) >>> 0;
  const release = ES_CONTINUOUS >>> 0;
  const signature =
    '[DllImport("kernel32.dll", SetLastError=true)] public static extern uint SetThreadExecutionState(uint esFlags);';
  return [
    `$signature = '${signature}';`,
    "$power = Add-Type -MemberDefinition $signature -Name KeepAwake -Namespace Paseo -PassThru;",
    `$null = $power::SetThreadExecutionState([uint32]${hold});`,
    `while (Get-Process -Id ${watchPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 };`,
    `$null = $power::SetThreadExecutionState([uint32]${release});`,
  ].join(" ");
}
