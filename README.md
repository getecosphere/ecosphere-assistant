# Ecosphere Assistant

A Chrome extension that puts your Ecosphere workspace in a side panel — from first install to production, all in one window. Guided setup, an AI coding agent, the LXS marketplace, and deployment controls, next to the page you're reading.

It detects what you need, installs it for you with live progress, and connects your project automatically. Everything runs locally; your code never leaves your machine.

## Install (3 steps)

1. **Load the extension** — open `chrome://extensions`, enable *Developer mode*, click *Load unpacked*, and choose this folder.
2. **Enable the helper** — in the `native/` folder, double-click `install.command`. This registers a small native helper and only needs to run once.
3. **Open the sidebar** — click the extension icon. It installs OpenCode if missing, asks for your project folder, and connects automatically.

See [getecosphere.com/install](https://getecosphere.com/install) for the guided version.

## How it works

- `sidepanel.*` — the Chrome side panel UI and a first-run wizard.
- `native/host.js` — a native messaging host that checks for OpenCode, runs the official installer (`curl https://opencode.ai/install | bash`) with streamed progress, and starts `opencode serve --port 4096` in your project folder.
- `native/install.command` / `install.sh` — one-time registration of the native host (macOS).
- The extension ID is pinned via the `key` in `manifest.json`, so the native host origin stays valid across reloads.
- `store/` — Chrome Web Store listing assets (screenshots, copy, store-ready zip).

## Uninstall

- Remove the extension from `chrome://extensions`.
- Run `native/uninstall.sh` to remove the helper registration.
- Stop the local server with `pkill -f "opencode serve"`.
