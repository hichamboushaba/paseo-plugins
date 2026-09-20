import { spawn, type ChildProcess } from "node:child_process";
import { suppressionCommand, type SuppressionOptions } from "./command.js";

export type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; windowsHide: boolean },
) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, options) => spawn(command, args, options);

export class SleepSuppressor {
  private child: ChildProcess | null = null;
  private activeOptions: SuppressionOptions | null = null;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly watchPid: number = process.pid,
    private readonly spawnFn: SpawnFn = defaultSpawn,
  ) {}

  get supported(): boolean {
    return suppressionCommand(this.platform, { keepDisplayAwake: false }, this.watchPid) !== null;
  }

  get active(): boolean {
    return this.child !== null;
  }

  describe(options: SuppressionOptions): string | null {
    const spec = suppressionCommand(this.platform, options, this.watchPid);
    return spec === null ? null : [spec.command, ...spec.args].join(" ");
  }

  sync(shouldHold: boolean, options: SuppressionOptions): void {
    if (!shouldHold) {
      this.stop();
      return;
    }
    if (this.child !== null && this.activeOptions?.keepDisplayAwake === options.keepDisplayAwake) {
      return;
    }
    this.stop();
    this.start(options);
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.activeOptions = null;
    if (child === null) {
      return;
    }
    child.kill("SIGTERM");
  }

  private start(options: SuppressionOptions): void {
    const spec = suppressionCommand(this.platform, options, this.watchPid);
    if (spec === null) {
      return;
    }
    const child = this.spawnFn(spec.command, spec.args, { stdio: "ignore", windowsHide: true });
    child.on("error", (error) => {
      console.error(`[keep-awake] ${spec.command} failed to start:`, error);
      this.forget(child);
    });
    child.on("exit", () => {
      this.forget(child);
    });
    child.unref();
    this.child = child;
    this.activeOptions = options;
  }

  private forget(child: ChildProcess): void {
    if (this.child === child) {
      this.child = null;
      this.activeOptions = null;
    }
  }
}
