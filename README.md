# paseo-plugins

Plugins for [Paseo](https://paseo.sh). Each top-level directory is a self-contained
plugin with its own `paseo-plugin.json`, dependencies, and tests.

| Plugin | What it does |
| --- | --- |
| [keep-awake](keep-awake) | Keeps the daemon host awake while any agent has a live turn running. |

## Installing a plugin from this checkout

Point Paseo at the plugin's directory, not at the repository root:

```bash
paseo plugin install ./keep-awake
```

## Working on a plugin

Dependencies and test scripts are per-plugin, so run them from inside the
plugin directory:

```bash
cd keep-awake
npm install
npm run typecheck && npm test
```
