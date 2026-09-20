export interface SuppressionOptions {
  keepDisplayAwake: boolean;
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
