# Ecosphere Assistant 2.0

Chrome side panel: your **/project dashboard** next to the page you are on, plus **a coding agent that sees that page**
(our own chat UI on the OpenCode server API — no OpenCode iframe). Everything runs on your machine.

- **Startup** shows a green progress bar and what it is checking (helper, sign-in, projects, tab); the setup checklist only appears when something is really missing, with its own bar (n of 4 steps).
- **Replies** are rendered as Markdown (headings, lists, code, tables, links; never raw HTML) and typed in with a soft fade; the view is not chased, a new question goes to the top and you scroll. **Steps** (menu): *intention* (default: what a call is for, e.g. "Reading web/src/app.ts"; bare commands are hidden), *quiet* (nothing), *verbose* (every command).
- **Agent** — chat on `opencode serve`: steps, diffs, permission cards (once / always for this project / reject), Stop, `/` commands,
  `@` files, screenshot attach. **Work folder**: the panel never assumes the estate is where you work. If there are folders above it (below your home folder) it asks once "Where do you work from?" (e.g. `~/ar-rahman` rather than `~/ar-rahman/estates/shop`); OpenCode then runs in that folder, so its sessions and its `AGENTS.md` are the ones you already use there (menu → Work folder moves it to any folder in your home: browse, go up, pick). Other projects under the same folder follow the choice. **Sessions** (same as OpenCode): `+ New` starts blank (nothing is created until the first
  message), the title button lists, searches, switches, renames, forks and deletes sessions of this project, a `ctx 52k` chip shows
  what the model re-reads each turn (with a Compact button past 100k). Slash commands run in the panel: `/new` `/clear`,
  `/sessions` `/resume`, `/compact` `/summarize`, `/undo` `/redo`, `/rename <title>`, `/fork`; the project's own OpenCode
  commands (`/init`, `/review`, …) are listed too. `/share` asks first (it publishes the whole session at a public link), shows the link with Copy / Remove, and `/unshare` removes it. **Page-aware**: the context card (tab URL → likely source file), the **element picker**
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
`store/listing.md` has every dashboard answer and the submit steps; after the first upload put the store ID in `native/store-id`
so the helper trusts it. Graphics: `store/make-icons.py` and `STORE=1 npx playwright test tests/94-store.spec.js` (from `e2e/`).

## Uninstall

Remove the extension; run `native/uninstall.sh` (stops the OpenCode servers it started, removes the registration).
