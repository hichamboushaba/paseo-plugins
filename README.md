# paseo-keep-awake

Keeps the daemon host awake while any Paseo agent has a live turn running, and releases the hold as soon as every turn ends.

## How it works

The server half of the plugin listens for the `agent.turn_started` and `agent.turn_ended` lifecycle hooks and maintains a set of agent IDs that currently have a live turn, keyed by `event.agent.id`. It is not keyed by `turnId`: that value is provider-reported, can be `null`, and can repeat after a session reopens, so it is not a usable key.

Whenever that set changes, an idempotent `sync()` call spawns or kills a single platform-native sleep-suppression child process:

- macOS: `caffeinate`
- Linux: `systemd-inhibit`
- Windows: PowerShell `SetThreadExecutionState`

That child process also watches the plugin's own process ID, so it exits on its own if the plugin ever dies without cleaning up after itself.

Paseo's lifecycle events are explicitly best-effort with no replay, so events can in principle be missed in either direction: a `turn_ended` can be dropped (leaking a hold), or a `turn_started` can be missed because the plugin was not running yet to see it (leaving an agent's turn unheld). To recover from both, a 60-second reconcile timer re-reads the set of currently running agents from the Paseo SDK (`paseo.agents.list`) and reconciles in both directions: it drops any held agent ID the daemon no longer reports as running, and it also acquires a hold for any running agent ID it never saw a `turn_started` for. A failed SDK call during reconcile is treated as "unknown," never as "nothing is running" — a transient error can never release the machine, since that would be exactly the failure mode this plugin exists to prevent.

Calling `paseo.agents.list` at all requires a `PaseoApi` handle, and `PluginServerContext` has no synchronous way to obtain one at startup. The plugin captures a handle opportunistically from the context of every lifecycle hook it registers (`agent.turn_started`, `agent.turn_ended`, `agent.created`, `agent.archived`, `workspace.created`, `workspace.archived`) and from the status RPC handler. The first time a handle is captured since (re)load, the plugin runs one immediate reconcile pass, which is how it recovers a hold that was already missing before any of those events happened to arrive.

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

## Settings

Open **Settings → Plugins → keep-awake** in the Paseo app.

- **Hold the host awake while agents work** — on by default. Starts a sleep assertion as soon as any agent begins a turn and releases it when the last turn ends. When off, the plugin still tracks turns but never spawns a suppression process.
- **Keep the display on too** — macOS and Windows only. Also keeps the display itself from sleeping while a hold is active, not just the system. On Linux, idle inhibition already defers the screen blank on most desktops, so this option has no separate effect there.

The same screen shows live status: the host platform, whether a hold is currently active and how many agents hold it, and the exact command the plugin would run (or is running).

## Platform support

| Daemon platform | Mechanism | Display option | Tested |
| --- | --- | --- | --- |
| macOS | `caffeinate -i -m [-d] -w <plugin pid>` | Supported (`-d`) | Yes, on macOS 26 / Paseo 0.9.0-beta.2 |
| Linux | `systemd-inhibit --what=idle --mode=block` | Not a separate option; idle inhibition defers screen blank on most desktops | No — argv-level unit tests only |
| Windows | PowerShell `SetThreadExecutionState` | Supported (`ES_DISPLAY_REQUIRED`) | No — argv-level unit tests only |

The Linux and Windows code paths were written against their documented APIs and are covered by argv-level unit tests only. Neither has ever been run against a real Linux or Windows daemon host.

Any daemon platform other than `darwin`, `linux`, or `win32` is unsupported: the plugin loads and tracks turns, but never spawns a suppression process.

## Limitations

- **No hold while an agent waits on a permission request.** An agent blocked on an approval prompt is not working, and nothing is lost if the host sleeps and resumes while it waits.
- **Lid close still sleeps the machine.** `caffeinate` assertions do not survive clamshell sleep on Apple Silicon, and no plugin can change that.
- **This only prevents sleep — it cannot wake a host that is already asleep.** If the machine sleeps anyway, the plugin cannot undo it.
- **No per-workspace or per-provider hold filters.** A hold is global to the host: any agent's live turn, anywhere, keeps the whole machine awake.
- **`systemd-inhibit` requires systemd.** Linux desktops without systemd have no supported suppression mechanism; the plugin degrades to "unsupported" there.
- **A reload during an already-running turn can leave the host unheld for the rest of that turn.** `PluginServerContext` has no synchronous way to obtain a `PaseoApi` at startup, so a freshly (re)loaded plugin cannot query or reconcile anything until some lifecycle hook or the status RPC happens to fire and hand it one. An agent whose turn was already in progress before the reload never emits a fresh `turn_started`, so it supplies nothing on its own — recovery depends entirely on some *other* agent, workspace, or status-RPC activity happening on the daemon in the meantime. If nothing else happens, the gap lasts as long as whatever turn was already running.

  Measured on a live daemon with a single long-running turn and no other Paseo activity: the reload completed at 16:19:53.418, no lifecycle event of any kind reached the plugin again until that same turn ended at 17:23:59.984 (`acquired missed holds` never logged in between), and the hold only resumed at 17:24:28.804 when an ordinary new `turn_started` fired for that same agent — a gap of roughly 65 minutes with no sleep suppression active at all. This is a real, currently-open gap, not a theoretical one: a workflow that depends on a single long-running unattended agent surviving a plugin reload is unprotected for however long that turn happens to run.

## Development

```bash
npm install
npm run typecheck
npm test
```

Both must exit 0 before every install or reload.
