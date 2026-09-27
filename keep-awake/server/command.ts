import { parseCommandLine, substitutePid } from "../shared/command-line.js";

export interface SuppressionOptions {
  keepDisplayAwake: boolean;
  customCommand: string;
}

export interface SuppressionCommand {
  command: string;
  args: string[];
}

// Resolving a command has three outcomes, and collapsing any two of them points the user at the
// wrong fix: "invalid" is their command to correct, "unsupported" is the host's to live with.
export type SuppressionResolution =
  | { status: "ok"; spec: SuppressionCommand }
  | { status: "invalid"; error: string }
  | { status: "unsupported" };

const WHY = "A Paseo agent is working";
const WHO = "paseo-keep-awake";

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

export function suppressionCommand(
  platform: NodeJS.Platform,
  options: SuppressionOptions,
  watchPid: number,
): SuppressionResolution {
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
      return { status: "ok", spec: { command: "caffeinate", args } };
    }
    case "linux":
      return { status: "ok", spec: { command: "sh", args: ["-c", linuxScript(watchPid)] } };
    case "win32":
      return {
        status: "ok",
        spec: {
          command: "powershell.exe",
          args: ["-NoProfile", "-NonInteractive", "-Command", windowsScript(options, watchPid)],
        },
      };
    default:
      return { status: "unsupported" };
  }
}

// A blank command means "no override" and falls through to the platform switch above (signalled by
// `undefined`). A non-blank one resolves here either way: a command the user typed but that cannot
// be spawned is theirs to fix, not a reason to silently fall back to the built-in one.
function customSuppressionCommand(
  customCommand: string,
  watchPid: number,
): SuppressionResolution | undefined {
  const parsed = parseCommandLine(customCommand);
  if ("error" in parsed) {
    return { status: "invalid", error: parsed.error };
  }
  if (parsed.tokens.length === 0) {
    return undefined;
  }
  const [command, ...args] = substitutePid(parsed.tokens, watchPid);
  return { status: "ok", spec: { command, args } };
}

// Two best-effort locks, each held until the plugin exits. GNOME's power daemon honors only
// gnome-session inhibitors and ignores logind locks, while logind's idle lock is what logind's own
// IdleAction and KDE honor, and the only one an ordinary user can take headless. Either may be
// unavailable; the hold lasts while at least one of them runs.
function linuxScript(watchPid: number): string {
  const untilPluginExits = `tail --pid=${watchPid} -f /dev/null`;
  return [
    // A daemon started over SSH or as a service may lack the address of the user's session bus.
    `: "\${DBUS_SESSION_BUS_ADDRESS:=unix:path=/run/user/$(id -u)/bus}"`,
    "export DBUS_SESSION_BUS_ADDRESS",
    `systemd-inhibit --what=idle --who=${shellQuote(WHO)} --why=${shellQuote(WHY)} --mode=block ${untilPluginExits} &`,
    `gnome-session-inhibit --inhibit suspend --app-id ${shellQuote(WHO)} --reason ${shellQuote(WHY)} ${untilPluginExits} &`,
    "wait",
  ].join("\n");
}

// Single-quotes a value for the script above, so a quote inside it can't end the argument early.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
