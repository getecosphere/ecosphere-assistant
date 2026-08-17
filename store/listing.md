# Chrome Web Store listing — Ecosphere Assistant

Everything you paste into the CWS developer dashboard for `getecosphere/ecosphere-assistant`.

## Metadata

- **Name:** Ecosphere Assistant
- **Short description:** Your Ecosphere estate in a sidebar: guided setup, build with AI, compose, and deploy — one window for the whole workflow.
- **Category:** Developer Tools
- **Language:** English
- **Homepage:** https://getecosphere.com/install
- **Privacy policy URL:** https://getecosphere.com/privacy
- **Support URL:** https://github.com/getecosphere/ecosphere-assistant

## Full description

> Ecosphere Assistant — one window for your whole Ecosphere estate, from first
> install to production.
>
> Your estate is what you build and run — the application you own. Beginner or
> expert, the assistant keeps it beside the page you're reading. Guided setup
> gets you started in minutes: it detects and installs what you need and
> connects your estate automatically. From there you build with an AI coding
> agent, run and share your estate locally, and deploy to production. When
> you're ready, compose reusable capabilities (LXS) into your estate — the
> powerful part, but never the first thing you need.
>
> Everything runs locally. The assistant talks to servers on your own machine;
> your code never leaves your computer.
>
> **What it does**
> - Guided first-run setup — installs OpenCode and the eco CLI for you, with
>   live progress in the side panel.
> - AI coding agent in a side panel — build and edit your estate while keeping
>   any page open.
> - Run locally (eco up), share, and deploy to production.
> - Compose reusable capabilities (LXS) into your estate when you need them.
> - Ask anything — questions about Ecosphere docs or your project, answered
>   right in the panel.
>
> **Getting started**
> 1. Install the extension.
> 2. Double-click `native/install.command` once to register the local helper
>    (macOS).
> 3. Click the extension icon — setup runs and your estate connects.
>
> Requirements: Chrome 114+, macOS, Node.js.
>
> Source: https://github.com/getecosphere/ecosphere-assistant

## Screenshots (1280x800)

| File | Caption |
|------|---------|
| `screenshots/01-connected-sidebar.png` | The assistant connected: pick a project folder and start coding. |
| `screenshots/02-first-run-wizard.png` | Guided setup — the assistant installs what you need with live progress. |
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
   helper at setup, or update `native/install.sh` before distributing.
