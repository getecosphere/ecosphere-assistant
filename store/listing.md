# Chrome Web Store listing — OpenCode Assistant

Everything you paste into the CWS developer dashboard for `getecosphere/ecosphere-opencode-assistant`.

## Metadata

- **Name:** OpenCode Assistant
- **Short description:** An AI coding agent in a Chrome side panel — browse a page and code in the same window.
- **Category:** Developer Tools
- **Language:** English
- **Homepage:** https://getecosphere.com/install
- **Privacy policy URL:** https://getecosphere.com/privacy
- **Support URL:** https://github.com/getecosphere/ecosphere-opencode-assistant

## Full description

> Code while you browse.
>
> OpenCode Assistant puts an AI coding agent in a Chrome side panel, so you can
> work on a project and keep the page you're reading on screen — one window,
> no tab juggling.
>
> Everything runs locally. The extension talks to a local server on your
> machine; your code never leaves your computer.
>
> First-run setup is guided:
> - The extension detects whether OpenCode is installed.
> - If it's missing, it installs OpenCode for you and shows live progress.
> - Then you choose your project folder and it connects automatically.
>
> Requirements
> - Google Chrome 114 or newer.
> - macOS (the one-time native helper uses install.command). Node.js is
>   needed by the helper to register itself and to start the local server.
> - OpenCode (the extension installs it for you if missing).
>
> Getting started
> 1. Install the extension.
> 2. Open the extension folder and double-click native/install.command once to
>    register the local helper.
> 3. Click the extension icon — the side panel opens, installs OpenCode if
>    needed, and connects to your project folder.
>
> Source: https://github.com/getecosphere/ecosphere-opencode-assistant

## Screenshots (1280x800)

| File | Caption |
|------|---------|
| `screenshots/01-connected-sidebar.png` | The assistant connected: pick a project folder and start coding. |
| `screenshots/02-first-run-wizard.png` | Guided setup — the assistant installs OpenCode with live progress. |
| `screenshots/03-coding-conversation.png` | Ask anything about your project while you keep your page open. |

## Permission justification

- **sidePanel** — the extension is a Chrome side panel; this is the API it is built on.
- **nativeMessaging** — used to talk to a local helper that (a) checks whether
  OpenCode is installed, (b) runs the official OpenCode installer with streamed
  progress, and (c) starts the local `opencode serve` process. The helper never
  touches anything outside the user's own machine, and it only reads/writes the
  extension's own config files.
- **host_permissions `http://127.0.0.1:*/*`** — the side panel embeds the
  OpenCode web UI served by the user's own local server on loopback. Nothing is
  loaded from the internet.

## Privacy notes for reviewers

- No user data is collected, transmitted, or stored outside the user's machine.
- The extension only connects to `http://127.0.0.1` (loopback). All network
  requests in the embedded UI go to the local OpenCode server.
- No analytics, no ads, no remote code. All extension code ships in the package.
- The embedded UI is the user's own local OpenCode instance, loaded as content
  (not executed in the extension's privileged context).

## Notes / known review risks

1. The native messaging helper is required for full function. The extension
   still loads and shows a guided setup screen without it, so it degrades
   gracefully — state this in the "Getting started" section.
2. The store will assign a **different extension ID** than the development
   build. The helper (`native/install.command`) auto-detects the extension ID
   when the manifest carries a `key`, otherwise it prompts the user to paste
   the ID shown in `chrome://extensions`. Paste your own published ID into the
   helper at setup, or update `native/install.sh`/the repo copy before
   distributing.
