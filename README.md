# paseo-plugins

Plugins for [Paseo](https://paseo.sh). Each top-level directory is a self-contained
plugin with its own `paseo-plugin.json`, dependencies, and tests.

| Plugin | What it does |
| --- | --- |
| [keep-awake](keep-awake) | Keeps the daemon host awake while agents and their subagents are working. |

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

## Releasing a plugin

Each plugin is published to npm on its own. Bump the plugin's `package.json` version, push
`main`, then push a `<plugin>/v<version>` tag, for example `keep-awake/v0.1.2`. The tag triggers
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which verifies the tag against
`package.json`, runs the plugin's checks, and publishes it with npm provenance.
