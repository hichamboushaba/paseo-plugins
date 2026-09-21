import { spawn, type ChildProcess } from "node:child_process";
import { suppressionCommand, type SuppressionCommand, type SuppressionOptions } from "./command.js";

export type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; windowsHide: boolean },
) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, options) => spawn(command, args, options);

function formatCommand(spec: SuppressionCommand): string {
  return [spec.command, ...spec.args].join(" ");
}

function sameCommand(a: SuppressionCommand, b: SuppressionCommand): boolean {
  return (
    a.command === b.command &&
    a.args.length === b.args.length &&
    a.args.every((arg, index) => arg === b.args[index])
  );
}

function sameOptions(a: SuppressionOptions, b: SuppressionOptions): boolean {
  return a.keepDisplayAwake === b.keepDisplayAwake && a.customCommand === b.customCommand;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  ) {}

  // "Supported" is a question about the host, so an invalid command must not be the thing that
  // answers it -- falling back to the built-in resolution keeps macOS reporting supported (the
  // platform is not what needs fixing; commandError carries the real problem) while a platform
  // with no built-in still reports unsupported, which is the half the user would otherwise lose.
  get supported(): boolean {
    const options = this.lastOptions ?? { keepDisplayAwake: false, customCommand: "" };
    if (suppressionCommand(this.platform, options, this.watchPid).status === "ok") {
      return true;
    }
    return suppressionCommand(this.platform, { ...options, customCommand: "" }, this.watchPid).status === "ok";
  }

  get active(): boolean {
    return this.child !== null;
  }

  get commandError(): string | null {
    return this.lastError;
  }

  describe(options: SuppressionOptions): string | null {
    const resolution = suppressionCommand(this.platform, options, this.watchPid);
    return resolution.status === "ok" ? formatCommand(resolution.spec) : null;
  }

  sync(shouldHold: boolean, options: SuppressionOptions): void {
    // An error describes the command that produced it, so changing the command retires it. Doing
    // this in stop() instead would erase the diagnostic the moment the last turn ended, which is
    // exactly when the user goes looking for it.
    if (this.lastOptions !== null && !sameOptions(this.lastOptions, options)) {
      this.lastError = null;
    }
    this.lastOptions = options;
    const resolution = suppressionCommand(this.platform, options, this.watchPid);
    if (resolution.status === "invalid") {
      // Checked before shouldHold because a command that cannot run is a property of the settings,
      // not of a hold attempt: the user fixes it between turns, which is exactly when a check that
      // ran only while holding would say nothing. Nothing spawns, so this repeats on every
      // reconcile until the command changes -- log it once; the status card shows it throughout.
      this.stop();
      if (this.lastError !== resolution.error) {
        console.error(`[keep-awake] ${resolution.error}`);
      }
      this.lastError = resolution.error;
      return;
    }
    if (!shouldHold) {
      this.stop();
      return;
    }
    const unchanged =
      resolution.status === "ok" &&
      this.activeCommand !== null &&
      sameCommand(resolution.spec, this.activeCommand);
    if (this.child !== null && unchanged) {
      return;
    }
    this.stop();
    if (resolution.status === "ok") {
      this.start(resolution.spec);
    }
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.activeCommand = null;
    child?.kill("SIGTERM");
  }

  private start(spec: SuppressionCommand): void {
    // sync() already retires an error whenever the command changes; this covers the other case --
    // re-arming the same command after it died on its own.
    this.lastError = null;
    let child: ChildProcess;
    try {
      child = this.spawnFn(spec.command, spec.args, { stdio: "ignore", windowsHide: true });
    } catch (error) {
      this.lastError = `${spec.command} failed to start: ${errorMessage(error)}`;
      console.error(`[keep-awake] ${this.lastError}`);
      return;
    }
    child.on("error", (error) => {
      console.error(`[keep-awake] ${spec.command} failed to start:`, error);
      const wasUnexpected = this.forget(child);
      if (wasUnexpected) {
        this.lastError = `${spec.command} failed to start: ${error.message}`;
      }
    });
    child.on("exit", (code, signal) => {
      // stop() nulls `this.child` before killing, so `forget` only reports true here when the child
      // exited on its own -- which always means the hold is broken, however long it lasted.
      if (!this.forget(child)) {
        return;
      }
      this.lastError = `${spec.command} exited on its own (code ${code ?? "null"}, signal ${signal ?? "null"})`;
      console.error(`[keep-awake] ${this.lastError}`);
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
