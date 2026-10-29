Keep Awake stops the computer running the Paseo daemon from sleeping while agents work, and releases the hold a minute after the last agent or subagent finishes. It prevents sleep but can't wake a machine that is already asleep.

Each workspace header gets a button that opens three modes: **While an agent is working** (the default), **Always** and **Off**. The mode applies to the whole host and is shared by every client. The Command Center offers the same choices, and the plugin's settings screen shows whether a hold is active, how many agents and subagents need it, and the command in use.

On macOS and Windows you can also keep the display on, which is off by default. On Linux the plugin needs systemd and keeps only the system awake: it takes a systemd idle lock and, in a GNOME session, a GNOME suspend inhibitor, including for a GNOME login that starts after the plugin. On other platforms, or on a Linux host without systemd, set a custom command. It replaces the built-in hold, runs directly without a shell, must keep running for as long as the hold should last, and inherits the daemon's environment.

The plugin watches agent and subagent activity on the daemon, keeps its options in host-scoped settings, and runs local power-management commands: `caffeinate` on macOS, `systemd-inhibit`, `gnome-session-inhibit` and `gdbus` on Linux, and PowerShell on Windows. Right after a reload it may also run the local Paseo command line to list running agents. It doesn't contact any external service, and no account is needed.

Limits:

- Closing a MacBook lid still puts Apple Silicon Macs to sleep, because `caffeinate` can't override lid-close sleep.
- A pending permission prompt doesn't end a turn, so the host stays awake while the prompt waits.
- Background shell commands, schedules and heartbeats aren't visible to the plugin. Use **Always** if you rely on them to run unattended.
- Subagents are covered only for providers that report them to Paseo.
- The hold is host-wide; there are no per-workspace or per-provider filters.
- On Linux, GNOME's auto-suspend at the login screen, with nobody signed in, can't be held, and XFCE and Cinnamon auto-suspend isn't held yet.

Requires Paseo 0.11.0 or later.
