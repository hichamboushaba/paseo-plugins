# Changelog

Versions match the npm package and the `keep-awake/v<version>` tags.

## Unreleased

### Changed

- Requires Paseo 0.11.0 or later, up from 0.9.0-beta.2. The plugin now lists its screenshots for
  Paseo's plugin registry, and older Paseo versions reject that manifest field.

## 0.1.4 - 2026-10-29

### Fixed

- The plugin now loads in the Paseo mobile app. Before, it failed with "Invalid expression
  encountered".

## 0.1.3 - 2026-10-14

### Fixed

- On Linux, logging in to GNOME after the plugin started now also blocks GNOME's suspend, without
  reloading the plugin. The same happens when you log in again after a GNOME session ends.

## 0.1.2 - 2026-09-27

### Fixed

- On Linux, GNOME no longer suspends the host while agents work. GNOME ignores the logind idle lock
  the plugin used, so the plugin now also takes a GNOME suspend inhibitor.
- Installing from npm or Git no longer fails with "Could not resolve type dependency
  @getpaseo/client".

## 0.1.1 - 2026-09-27

### Added

- First release on npm. The plugin keeps the Paseo daemon's host awake while agents and their
  subagents work, and releases the hold a minute after the last one finishes.
- Three modes: While an agent is working (the default), Always, and Off. On macOS and Windows it can
  also keep the display awake.
