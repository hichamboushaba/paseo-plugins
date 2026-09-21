import { spawn, type ChildProcess } from "node:child_process";
import { suppressionCommand, type SuppressionCommand, type SuppressionOptions } from "./command.js";

export type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; windowsHide: boolean },
) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, options) => spawn(command, args, options);

const IMMEDIATE_EXIT_THRESHOLD_MS = 2_000;

function formatCommand(spec: SuppressionCommand): string {
  return [spec.command, ...spec.args].join(" ");
}

export class SleepSuppressor {
  private child: ChildProcess | null = null;
  private activeCommand: SuppressionCommand | null = null;
  private lastOptions: SuppressionOptions | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly watchPid: number = process.pid,
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly now: () => number = Date.now,
  ) {}

  get supported(): boolean {
    const options = this.lastOptions ?? { keepDisplayAwake: false, customCommand: "" };
    return suppressionCommand(this.platform, options, this.watchPid) !== null;
  }

  get active(): boolean {
    return this.child !== null;
  }

  get commandError(): string | null {
    return this.lastError;
  }

  describe(options: SuppressionOptions): string | null {
    const spec = suppressionCommand(this.platform, options, this.watchPid);
    return spec === null ? null : formatCommand(spec);
  }

  sync(shouldHold: boolean, options: SuppressionOptions): void {
    this.lastOptions = options;
    if (!shouldHold) {
      this.stop();
      return;
    }
    const spec = suppressionCommand(this.platform, options, this.watchPid);
    const unchanged =
      spec !== null && this.activeCommand !== null && formatCommand(spec) === formatCommand(this.activeCommand);
    if (this.child !== null && unchanged) {
      return;
    }
    this.stop();
    this.start(spec);
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.activeCommand = null;
    if (child === null) {
      return;
    }
    child.kill("SIGTERM");
  }

  private start(spec: SuppressionCommand | null): void {
    if (spec === null) {
      return;
    }
    this.lastError = null;
    const startedAt = this.now();
    const child = this.spawnFn(spec.command, spec.args, { stdio: "ignore", windowsHide: true });
    child.on("error", (error) => {
      console.error(`[keep-awake] ${spec.command} failed to start:`, error);
      this.forget(child);
    });
    child.on("exit", (code, signal) => {
      // stop() nulls `this.child` before killing, so `forget` only clears state here when the
      // child exited on its own -- exactly the case an immediate exit needs to detect.
      const wasUnexpected = this.forget(child);
      if (wasUnexpected && this.now() - startedAt < IMMEDIATE_EXIT_THRESHOLD_MS) {
        this.lastError = `${spec.command} exited immediately (code ${code ?? "null"}, signal ${signal ?? "null"})`;
        console.error(`[keep-awake] ${this.lastError}`);
      }
    });
    child.unref();
    this.child = child;
    this.activeCommand = spec;
  }

  private forget(child: ChildProcess): boolean {
    if (this.child !== child) {
      return false;
    }
    this.child = null;
    this.activeCommand = null;
    return true;
  }
}
