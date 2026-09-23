import { spawn, type ChildProcess } from "node:child_process";
import { suppressionCommand, type SuppressionCommand, type SuppressionOptions } from "./command.js";

export type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; windowsHide: boolean },
) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, options) => spawn(command, args, options);

// Overlap window for a make-before-break command change: long enough that PowerShell start-up plus
// `Add-Type` on Windows -- which alone can exceed 2s -- has finished before the old child is killed.
export const HANDOVER_MS = 10_000;

function sameOptions(a: SuppressionOptions, b: SuppressionOptions): boolean {
  return a.keepDisplayAwake === b.keepDisplayAwake && a.customCommand === b.customCommand;
}

function sameCommand(a: SuppressionCommand, b: SuppressionCommand): boolean {
  return (
    a.command === b.command &&
    a.args.length === b.args.length &&
    a.args.every((arg, index) => arg === b.args[index])
  );
}

export class SleepSuppressor {
  private child: ChildProcess | null = null;
  private activeCommand: SuppressionCommand | null = null;
  private lastOptions: SuppressionOptions | null = null;
  private lastError: string | null = null;
  // Children superseded by a command change, still alive during their overlap window.
  private readonly retiring = new Set<ChildProcess>();
  // A pending stop() scheduled by sync()'s releaseDelayMs instead of run at once.
  private releaseTimer: NodeJS.Timeout | null = null;
  private releaseAt: number | null = null;

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

  // Milliseconds left before a deferred release fires, or `null` when none is pending.
  get releaseInMs(): number | null {
    return this.releaseAt === null ? null : Math.max(0, this.releaseAt - Date.now());
  }

  describe(options: SuppressionOptions): string | null {
    const resolution = suppressionCommand(this.platform, options, this.watchPid);
    return resolution.status === "ok" ? [resolution.spec.command, ...resolution.spec.args].join(" ") : null;
  }

  sync(shouldHold: boolean, options: SuppressionOptions, releaseDelayMs = 0): void {
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
    if (resolution.status === "unsupported") {
      this.stop();
      return;
    }
    if (!shouldHold) {
      if (releaseDelayMs > 0 && this.child !== null) {
        this.deferStop(releaseDelayMs);
      } else {
        this.stop();
      }
      return;
    }
    this.cancelDeferredStop();
    const unchanged = this.activeCommand !== null && sameCommand(resolution.spec, this.activeCommand);
    if (this.child !== null && unchanged) {
      return;
    }
    if (this.child === null) {
      this.start(resolution.spec);
      return;
    }
    // The command changed while a hold is already active: make-before-break. Killing the old child
    // first would create a zero-assertion instant before the new one is confirmed running -- the
    // same gap that let macOS commit to idle sleep during a hand-off between agent turns. Detach the
    // old child without killing it, start the replacement, then retire the old one after an overlap.
    const outgoing = this.child;
    this.child = null;
    this.activeCommand = null;
    this.start(resolution.spec);
    if (this.child !== null) {
      this.retire(outgoing);
    } else {
      // The replacement failed to spawn synchronously -- nothing is watching the old command
      // anymore, so there is nothing left to overlap with. Drop it immediately.
      outgoing.kill("SIGTERM");
    }
  }

  stop(): void {
    this.cancelDeferredStop();
    const child = this.child;
    this.child = null;
    this.activeCommand = null;
    child?.kill("SIGTERM");
    for (const retiringChild of this.retiring) {
      retiringChild.kill("SIGTERM");
    }
    this.retiring.clear();
  }

  // A hand-off between agent turns can leave no live work for a few milliseconds -- long enough for
  // macOS to commit to idle sleep on that gap once the display is off. Deferring the kill instead of
  // calling stop() at once absorbs hand-offs without keeping a genuinely idle host awake for long.
  private deferStop(ms: number): void {
    if (this.releaseAt !== null) {
      // Never extend a release already in flight: repeated idle syncs must not keep pushing the
      // deadline out.
      return;
    }
    this.releaseAt = Date.now() + ms;
    console.log(`[keep-awake] no work left; releasing in ${Math.round(ms / 1000)}s unless work resumes`);
    this.releaseTimer = setTimeout(() => {
      console.log("[keep-awake] release delay elapsed");
      this.stop();
    }, ms);
    this.releaseTimer.unref();
  }

  private cancelDeferredStop(): void {
    if (this.releaseTimer === null) {
      return;
    }
    clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    this.releaseAt = null;
  }

  private retire(child: ChildProcess): void {
    this.retiring.add(child);
    const timer = setTimeout(() => {
      this.retiring.delete(child);
      child.kill("SIGTERM");
    }, HANDOVER_MS);
    timer.unref();
  }

  private start(spec: SuppressionCommand): void {
    // sync() already retires an error whenever the command changes; this covers the other case --
    // re-arming the same command after it died on its own.
    this.lastError = null;
    let child: ChildProcess;
    try {
      child = this.spawnFn(spec.command, spec.args, { stdio: "ignore", windowsHide: true });
    } catch (error) {
      this.lastError = `${spec.command} failed to start: ${error instanceof Error ? error.message : String(error)}`;
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
