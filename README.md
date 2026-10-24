# Ecosphere Assistant 2.0

Chrome side panel: your **/project dashboard** next to the page you are on, plus **a coding agent that sees that page**
(our own chat UI on the OpenCode server API — no OpenCode iframe). Everything runs on your machine.

- **Agent** — chat on `opencode serve`: steps, diffs, permission cards (once / always for this project / reject), Stop, `/` commands,
  `@` files, screenshot attach. **Page-aware**: the context card (tab URL → likely source file), the **element picker**
  (⌘⇧E / Ctrl⇧E, Esc cancels), console errors, reload-after-change.
- **QA** — this project's QA requests, capture the tab into one, **Work on it** (`eco pm qa take` → agent session → steps mirrored to
  /project → **Send to QA**). **Project** — hosting card, deploy of the local build (gated by plan). **Summarize session** → `eco pm report`.
  QA/Project show only when the project is linked to /project (`eco pm link`) or `prefs.pm` is on.
- **Compose** — LXS of `ecompose.yml` (+ `eco.lock` signing), add/remove through `eco`, `eco up dev`.
- **Sign-in = the eco CLI on this machine.** The extension never stores a key or token. Google sign-in is `eco login` (device login).

## Install

1. Install the extension (Chrome Web Store, or `chrome://extensions` → Developer mode → *Load unpacked* → this folder).
2. Open the panel: the checklist installs/detects the rest. The helper is one command (macOS and Linux, needs Node 18+):
   `curl -fsSL https://getecosphere.com/downloads/helper-install.sh | bash` — from a checkout: `native/install.sh`.
   Windows: not supported yet (WSL is on the roadmap).

## Architecture

```
side panel (UI, holds no secrets)
  ├─ native messaging ─▶ helper (native/lib.js: a FIXED allowlist of actions, validated args, argv only — no shell)
  │                        ├─ eco …           account, pm, deploy, lxs (the CLI's own login)
  │                        └─ opencode serve  one per project, 127.0.0.1, random port + per-launch password
  ├─ fetch 127.0.0.1:<port> ─▶ OpenCode API (sessions, prompt_async, /event SSE, permissions, abort)
  └─ chrome.scripting (on demand) ─▶ page: picker, console hook, toast
```

Permissions: `sidePanel nativeMessaging storage tabs activeTab scripting`; hosts only `127.0.0.1`, `localhost`, `getecosphere.com`.
`optional_host_permissions: <all_urls>` is asked at first use (per-site page access, and screenshots — `captureVisibleTab`
needs `activeTab` or `<all_urls>`). No content script.

**Workspace rules:** OpenCode only reads `AGENTS.md` up to the repo's git root, so the helper passes `AGENTS.md` files of parent
folders (up to `$HOME`) as extra `instructions` — e.g. a workspace index above many estate repos still applies.

## Layout

`manifest.json` · `background.js` · `sidepanel.html/css` · `js/` (app, bridge, oc, session, agent, page, qa, project, compose, onboarding, main) ·
`page/picker.js` (injected on demand) · `native/` (helper: `lib.js`, `host.js`, `install.sh`, `uninstall.sh`, `build-helper.sh`) ·
`store/` (listing, privacy, screenshots, `package.sh`) · `e2e/` (Playwright + fakes) · `docs/handover/` (the design brief).

## Tests

```
cd e2e && npm install && npx playwright install chromium
npx playwright test                  # loads the unpacked extension; FAKE eco + FAKE opencode, never a real account
node --test ../native/test ../js/test # helper (allowlist, Linux/macOS installer) and the event reducer
node make-icons.mjs                  # regenerate the LED icons
STORE=1 npx playwright test tests/94-store.spec.js   # regenerate the store screenshots (opt-in)
```

## Release

`store/package.sh` builds `store/ecosphere-assistant-cws.zip` and `helper-install.sh` (host it at
`https://getecosphere.com/downloads/helper-install.sh`). Not published until the owner says so.

## Uninstall

Remove the extension; run `native/uninstall.sh` (stops the OpenCode servers it started, removes the registration).
