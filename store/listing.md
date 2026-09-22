# Chrome Web Store listing — Ecosphere Assistant

Everything you paste into the CWS developer dashboard for `getecosphere/ecosphere-assistant`.

## Metadata

- **Name:** Ecosphere Assistant
- **Short description:** Your estate in a sidebar: guided setup, AI coding, compose your ecompose.yml, deploy — plus Ecosphere Projects for QA and Kanban.
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
> connects your estate automatically. Build with an AI coding agent, run and
> share your estate locally, and deploy to production.
>
> And because a great estate is composed, not just coded: when you need a
> capability, compose an LXS — reusable, versioned Linux Services that plug
> straight into your estate without rebuilding them. Powerful, and ready when
> you are.
>
> **Ecosphere Projects** — switch the side panel to the **Projects** tab and
> you're in the team workspace for QA and project management:
> - Register any project, assign a QA, and watch feedback land on a Kanban board.
> - One-click **Capture tab** — snapshot the page you're testing and attach it
>   to a QA task as a screenshot.
> - Owners can generate a project-scoped agent token so an AI agent reads and
>   closes tasks automatically.
>
> **Ecosphere Compose** — switch to the **Compose** tab to build and maintain
> your estate's `ecompose.yml` without hand-editing YAML:
> - Browse the live LXS registry and add a capability — reusable, versioned
>   services that plug into your estate.
> - Watch the estate assemble, and copy the exact `ecompose.yml` plus the
>   `eco` commands it produces.
> - No account needed to compose; sign in only when you want to host it.
>
> Everything runs locally except your team workspace and the composer. The
> assistant talks to servers on your own machine; your code never leaves your
> computer.
>
> **What it does**
> - Guided first-run setup — installs OpenCode and the eco CLI for you, with
>   live progress in the side panel.
> - AI coding agent in a side panel — build and edit your estate while keeping
>   any page open.
> - Run locally (eco up), share, and deploy to production.
> - Compose LXS — reusable, versioned capabilities that plug into your estate.
> - Ecosphere Compose — build and maintain your ecompose.yml from the live
>   registry, no YAML by hand.
> - Ecosphere Projects (project.getecosphere.com) — team QA, Kanban, and
>   one-click screen capture.
> - Ask anything — questions about Ecosphere docs or your project, answered
>   right in the panel.
>
> **Getting started**
> 1. Install the extension.
> 2. Double-click `native/install.command` once to register the local helper
>    (macOS).
> 3. Click the extension icon — setup runs and your estate connects.
> 4. Switch to the **Compose** tab to add capabilities and generate your
>    `ecompose.yml`.
> 5. Switch to the **Projects** tab, sign in at project.getecosphere.com, and
>    capture QA feedback right from the panel.
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
- **host_permissions `https://getecosphere.com/*`** — the **Compose** tab
  embeds the composer at getecosphere.com/compose (and the sign-in page used by
  guided setup). It reads the public LXS registry; it sends no user data.
- **host_permissions `https://project.getecosphere.com/*`** — the **Projects**
  tab embeds the user's team workspace (project management / QA).
- **host_permissions `https://*.jogjaitcamp.com/*` + `activeTab`** — used only
  when the user clicks **Capture tab** to snapshot the page they're testing
  (e.g. their estate on a jogjaitcamp.com subdomain) into a QA task.
- **tabs** — the extension reads the active tab only to capture screenshots the
  user explicitly requests and to reload it after a deploy.

## Privacy notes for reviewers

- No user data is collected, transmitted, or stored outside the user's machine.
- The extension only connects to `http://127.0.0.1` (loopback) for the coding
  workspace. The **Compose** tab loads the public composer at
  getecosphere.com/compose (no account, no user data). The **Projects** tab is
  the user's own team workspace at project.getecosphere.com (their account,
  their projects).
- No analytics, no ads, no remote code. All extension code ships in the package.
- The embedded UIs are loaded as content (not executed in the extension's
  privileged context). Screen capture only ever happens on an explicit user
  click and goes straight into the QA task the user is writing.

## Notes / known review risks

1. The native messaging helper is required for full function. The extension
   still loads and shows a guided setup screen without it, so it degrades
   gracefully — state this in the "Getting started" section.
2. The store will assign a **different extension ID** than the development
   build. The helper (`native/install.command`) auto-detects the extension ID
   when the manifest carries a `key`, otherwise it prompts the user to paste
   the ID shown in `chrome://extensions`. Paste your own published ID into the
   helper at setup, or update `native/install.sh` before distributing.
