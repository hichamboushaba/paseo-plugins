# paseo-keep-awake

Keeps the daemon host awake while any Paseo agent has a live turn running, and releases the hold as soon as every turn ends. The hold is tri-state: never, only while an agent is working, or always.

## How it works

The server half of the plugin listens for the `agent.turn_started` and `agent.turn_ended` lifecycle hooks and maintains a set of agent IDs that currently have a live turn, keyed by `event.agent.id`. It is not keyed by `turnId`: that value is provider-reported, can be `null`, and can repeat after a session reopens, so it is not a usable key.

Whenever that set changes, an idempotent `sync()` call spawns or kills a single platform-native sleep-suppression child process:

- macOS: `caffeinate`
- Linux: `systemd-inhibit`
- Windows: PowerShell `SetThreadExecutionState`

That child process also watches the plugin's own process ID, so it exits on its own if the plugin ever dies without cleaning up after itself.

Paseo's lifecycle events are explicitly best-effort with no replay, so events can in principle be missed in either direction: a `turn_ended` can be dropped (leaking a hold), or a `turn_started` can be missed because the plugin was not running yet to see it (leaving an agent's turn unheld). To recover from both, a 60-second reconcile timer re-reads the set of currently running agents from the Paseo SDK (`paseo.agents.list`) and reconciles in both directions: it drops any held agent ID the daemon no longer reports as running, and it also acquires a hold for any running agent ID it never saw a `turn_started` for. A failed SDK call during reconcile is treated as "unknown," never as "nothing is running" — a transient error can never release the machine, since that would be exactly the failure mode this plugin exists to prevent.

Calling `paseo.agents.list` at all requires a `PaseoApi` handle, and `PluginServerContext` has no synchronous way to obtain one at startup. The plugin captures a handle opportunistically from the context of every lifecycle hook it registers (`agent.turn_started`, `agent.turn_ended`, `agent.created`, `agent.archived`, `workspace.created`, `workspace.archived`) and from the status RPC handler.

That alone is not enough after a reload. An agent whose turn began before the reload never emits a second `turn_started`, so on a daemon running a single agent no hook fires at all and the plugin stays blind for the rest of that turn. So reconcile does not depend on having a handle: when none has been captured yet it shells out to the Paseo CLI instead, running `paseo agent ls -g --json` and filtering for `status === "running"`. The binary path and daemon home come from the `PASEO_CLI` and `PASEO_HOME` environment variables that Paseo gives every plugin subprocess. One reconcile runs immediately at load rather than waiting for the first timer tick, so a reload recovers its holds in well under a second. The in-process SDK is still preferred whenever a handle is available, since it needs no subprocess.

Trusting `agents.list` to *start* a hold, not just end one, means the host can stay awake up to one reconcile interval (60 seconds) longer than strictly needed if a "running" status is ever stale-true after an agent has actually stopped. That is the deliberately safe direction: staying awake a little longer than necessary is a nuisance, sleeping while an agent is mid-turn loses work.

## Install

```bash
paseo plugin install /path/to/paseo-keep-awake
paseo plugin ls keep-awake
```

After a local change:

```bash
paseo plugin reload keep-awake
```

## Usage

- **Header button** — every workspace gets a "Keep awake" button in its header, before the built-in actions. Its icon reflects the current mode: a moon when off, a coffee cup while holding only for working agents, a lightning bolt while always holding. Pressing it opens a popover with all three modes and the display option, rather than cycling through them — with three states, a cycling press makes the user guess where they will land, and the popover also carries the hint text for each mode.
- **Command Center (⌘K)** — four items are registered: "Keep awake settings" opens the settings screen, and "Keep awake: off", "Keep awake: while an agent is working", and "Keep awake: always" each set that mode directly. Three explicit items beat one cycling item in a search palette, where the user types the state they want rather than watching a button change.

The popover is rendered by the plugin, so it reads the live setting through `useSettings` and has no second copy of the state to keep in sync. That matters: the button's `label` is a plain non-reactive string on the registration, so anything shown outside the icon would have to be hand-synced on every change.

## Settings

Open **Settings → Plugins → keep-awake** in the Paseo app.

- **Hold the host awake** — three modes, defaulting to **While an agent is working**:
  - **Off** — never holds. The plugin still tracks turns, but never spawns a suppression process.
  - **While an agent is working** — starts a sleep assertion as soon as any agent begins a turn and releases it when the last turn ends.
  - **Always** — holds for as long as Paseo is running, regardless of agent activity.
- **Keep the display on too** — macOS and Windows only. Also keeps the display itself from sleeping while a hold is active, not just the system. On Linux, idle inhibition already defers the screen blank on most desktops, so this option has no separate effect there.
- **Command** — an optional custom command that replaces the built-in per-platform command entirely, rather than layering on top of it. Any built-in command satisfies three properties, and a custom one must too: it must block for as long as the hold should last rather than forking and returning immediately, it must exit when sent `SIGTERM` (`sync()` and `stop()` release a hold by killing the child), and it should self-terminate if the plugin's own process ever dies without cleaning up after itself first. Include the literal placeholder `{pid}` anywhere in the command and it is substituted with the plugin's own process ID before spawning — for example, `caffeinate -i -m -w {pid}` — which is how the built-in macOS command already satisfies that third property; the placeholder is optional, but omitting it means the command has no way to notice the plugin is gone. The command line is tokenized by the plugin itself, honoring single and double quotes, and the resulting argv is spawned directly rather than through a shell, so a `SIGTERM` reaches the real process instead of a shell wrapper that might not forward it. Typing is local until you press **Apply**; leaving the field blank and applying (or pressing **Reset**) restores the built-in command for the current platform. If a custom command exits unexpectedly within two seconds of starting, the status card below reports it as a command error instead of silently showing no hold — this catches fire-and-forget commands (`xset s off`, `caffeine`) that return immediately rather than blocking. Because the custom command fully replaces the built-in one, **Keep the display on too** is disabled while a custom command is set: there is no built-in command left for that flag to modify.

Settings are stored at version 2. A version 1 document (which stored a boolean `enabled`) is migrated on read: `enabled: true` — including a missing value, which used to default to true — becomes `auto`, and `enabled: false` becomes `off`. So an existing install keeps behaving exactly as it did before the upgrade.

The same screen shows live status: the host platform, whether a hold is currently active and how many agents hold it, and the exact command the plugin would run (or is running).

## Platform support

| Daemon platform | Mechanism | Display option | Tested |
| --- | --- | --- | --- |
| macOS | `caffeinate -i -m [-d] -w <plugin pid>` | Supported (`-d`) | Yes, on macOS 26 / Paseo 0.9.0-beta.2 |
| Linux | `systemd-inhibit --what=idle --mode=block` | Not a separate option; idle inhibition defers screen blank on most desktops | No — argv-level unit tests only |
| Windows | PowerShell `SetThreadExecutionState` | Supported (`ES_DISPLAY_REQUIRED`) | No — argv-level unit tests only |

The Linux and Windows code paths were written against their documented APIs and are covered by argv-level unit tests only. Neither has ever been run against a real Linux or Windows daemon host.

Any daemon platform other than `darwin`, `linux`, or `win32` is unsupported: the plugin loads and tracks turns, but never spawns a suppression process.

A custom command (see **Command** under [Settings](#settings)) replaces the built-in mechanism outright, on any platform — including one not in this table, or a Linux desktop without systemd. The status RPC's `supported` flag reflects this: it is true whenever the plugin has *any* command it could run, built-in or user-supplied, so a valid custom command makes an otherwise-unsupported host report as supported.

## Limitations

- **No hold while an agent waits on a permission request.** An agent blocked on an approval prompt is not working, and nothing is lost if the host sleeps and resumes while it waits.
- **Lid close still sleeps the machine.** `caffeinate` assertions do not survive clamshell sleep on Apple Silicon, and no plugin can change that.
- **This only prevents sleep — it cannot wake a host that is already asleep.** If the machine sleeps anyway, the plugin cannot undo it.
- **No per-workspace or per-provider hold filters.** A hold is global to the host: any agent's live turn, anywhere, keeps the whole machine awake.
- **`systemd-inhibit` requires systemd.** Linux desktops without systemd have no supported suppression mechanism; the plugin degrades to "unsupported" there.
- **A reloaded plugin recovers its holds at startup by asking the Paseo CLI.** `PluginServerContext` has no synchronous way to obtain a `PaseoApi` at startup, so immediately after a (re)load there is no in-process handle to query yet. Rather than waiting on some lifecycle hook or the status RPC to hand it one, the plugin runs one reconcile pass immediately at startup, and that pass falls back to shelling out to the Paseo CLI (`paseo agent ls -g --json`, using the `PASEO_CLI` and `PASEO_HOME` values the plugin subprocess is given) whenever no `PaseoApi` is available yet. The in-process SDK path is still preferred the moment a hook or RPC call supplies one — the CLI is only the seed path for the instant right after a reload.

  This closes a gap that was previously measured at roughly 65 minutes: a reload at 16:19:53.418 during a still-running turn left the host unheld until that turn happened to end at 17:23:59.984, because no lifecycle event of any kind reached the plugin in between. With the CLI fallback in place, reproducing the same scenario — reload during an already-running turn, with no new `turn_started` for it — now recovers the hold within about a third of a second of the plugin reporting ready: reload logged at 19:32:54.613, `[keep-awake] ready on darwin; supported` at 19:32:55.014, `[keep-awake] acquired missed holds: <agent id>` at 19:32:55.339, with that agent's last `turn_started` over five minutes in the past and no lifecycle event in between.

  **Caveat:** the fallback depends on the plugin subprocess being able to run a `paseo` binary. If `PASEO_CLI` is unset and no `paseo` executable is on the subprocess's `PATH`, the CLI call fails, startup reconcile treats that as "could not determine" — never as "nothing is running," so it still can't wrongly release the machine — and the old gap returns until some other lifecycle hook or the status RPC happens to supply a `PaseoApi`.

## Development

```bash
npm install
npm run typecheck
npm test
```

Both must exit 0 before every install or reload.
