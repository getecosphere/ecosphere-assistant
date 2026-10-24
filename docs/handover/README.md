# Ecosphere Assistant 2.0 — handover for the CLI agent

Owner decision, 2026-10-24. Rebuild the Chrome extension (`~/ar-rahman/ecosphere-assistant`, today v1.8.0) as
**the /project dashboard in a side panel, plus a coding agent that sees the page you are on**. Chosen
direction: **B (cockpit tabs) as the frame + D (page-aware: pick an element, see the change on the page)**,
with **E's session summary** as an action in the Agent tab and **F** as the onboarding. A and C are
reference only.

Do not commit, push, publish to the Chrome Web Store or deploy until the owner says so.

Read first:

- `design/*.dc.html` — the source of truth. `<x-dc>` = markup, `<script type="text/x-dc">` = states,
  sample data, copy and interactions. Files: `Cockpit` (B), `PageAware` (D), `Session` (E),
  `Onboarding` (F), `Main` (A), `Queue` (C), `PixelE` (logo). `common` look: Manrope + DM Mono, tokens
  identical to `estates/getecosphere/docs/revamp/project/README.md` §7.
- `screens/NN-*.png` — rendered states of the chosen direction (numbered in flow order).
- `~/ar-rahman/estates/getecosphere/docs/revamp/project/README.md` — the /project brief. The QA,
  sessions, live log and `eco pm` CLI defined there (§4) are what this extension consumes.
- `~/ar-rahman/estates/getecosphere/docs/revamp/google-only-signin.md` — sign-in is Google only.
- `~/ar-rahman/.agents/rules/brand.md` → "Ecosphere logo = P4 LED" (app shell: mark only; the LED
  animates only while work is running).

## 1. Today (v1.8.0) — what to keep, what is broken

Keep: MV3 side panel; the pinned extension key; the native-messaging helper (`native/host.js`) that
installs/starts OpenCode and runs `eco`; the Compose bridge (composer posts intents, helper runs `eco lxs
add/remove`, `eco up dev`); tab capture.

Broken or wrong (fix all):

1. **Sign-in is dead**: `sidepanel.js` posts username/password to `/auth-api/auth/login`; auth 4.4.0
   refuses passwords. The session token is also kept in `chrome.storage`.
2. **Projects tab** iframes `project.getecosphere.com`, which is being retired for `/project`.
3. **Workspace tab** iframes OpenCode's own web UI: foreign look, no Ecosphere context, exposed port input.
4. **Deploy button ignores gates** (early access / plan) and searches the disk by hostname.
5. **Helper is macOS-only** (`zsh -lc`, `source ~/.zshrc`, `.command` installer).
6. **`estate-detect.js` runs on `<all_urls>`** — heavy permission for the Web Store and privacy.
7. Visual: old dark/indigo look, store screenshots still say "OpenCode Assistant".

## 2. Architecture

```
side panel (UI, holds no secrets)
  ├─ native messaging ──▶ helper (allowlisted actions only)
  │                         ├─ eco …           (account, pm, deploy, compose; uses the CLI's own keychain)
  │                         └─ opencode serve  (start/stop/health, per project folder, 127.0.0.1)
  ├─ fetch 127.0.0.1:<port> ─▶ OpenCode server API (sessions, prompts, SSE events, permissions, abort)
  └─ chrome.scripting (on demand) ─▶ page: element picker, page context, console errors, reload
```

1. **The helper is the only bridge to Ecosphere.** Every account/pm/deploy action is an `eco` command
   run by the helper (`eco whoami --json`, `eco login`, `eco pm qa --json`, `eco pm qa take`, `eco pm qa
   step|done`, `eco pm log`, `eco pm report`, `eco deploy`, `eco serve`…). Add `--json` output to the
   commands that lack it. The extension never stores an API key or session token. Signed in = the eco CLI
   on this machine is signed in.
2. **Allowlist.** The helper accepts a fixed set of actions with validated arguments (no free-form shell).
   Resolve `eco`/`opencode` by absolute path (config, then login-shell `PATH` probe once, cached); no
   `source ~/.zshrc`. Linux + macOS. Windows via WSL is roadmap (say so in the UI, don't fake it).
3. **OpenCode via its HTTP API**, not its web UI. Verify the endpoints against the installed version
   (`opencode serve` publishes its OpenAPI document; or use the official JS SDK) — do not guess. Needed:
   create/list sessions, send a prompt with parts (text, file/image attachments), stream events (message
   parts, tool calls, file edits/diffs, permission requests, session idle/error), answer permissions
   (once / always / reject), abort, current model/agent.
4. **Permissions minimized.** Drop the `<all_urls>` content script. Use `activeTab` + `scripting` on
   demand, `optional_host_permissions` requested at first use per estate domain (for capture and page
   context), and always-on only for `http://127.0.0.1/*`, `http://localhost/*`, `https://getecosphere.com/*`.
   Keep `nativeMessaging`, `sidePanel`, `storage`, `tabs`. Remove `downloads` if no longer needed, and the
   `jogjaitcamp.com` and `project.getecosphere.com` hosts.
5. **Project = estate.** The project switcher lists estates the helper finds (folders with `ecompose.yml`
   under the roots the user approved, plus `eco` estates of the account). The active tab picks the matching
   project automatically: `<meta name="ecosphere-estate">` on estate sites, or `localhost:<port>` of a
   running `eco up dev`.

## 3. UI spec (direction B + D)

Panel width is whatever Chrome gives (min ~320 px); design at 400 px, no horizontal scroll.

**Header** (`screens/01`): LED mark (animated while the agent runs) · project switcher (name + hosting chip
serve/deploy) · status text (siap / bekerja / perlu izin) · **element-picker button** (from D) · avatar
menu: Dock kanan / Dock kiri (`screens/07`), open /project, folder, model, theme, sign out.
Dock: Chrome owns the side-panel side — the toggle explains it and opens
`chrome://settings/appearance`; remember the user's choice only to show the right state.

**Tabs:** Agen · QA (badge = waiting count) · Proyek · Compose.

**Agen** (`01`–`03`, `08`–`10`):
- status strip (LED, "Agen sedang bekerja · n langkah", chip) + thin progress bar;
- **page-context card** (D, collapsible): tab URL → source file guess, selected element
  (`selector · size · file:line` once the agent locates it), console errors (count, expandable);
- stream: user message (with context chips), agent text, **step rows** (tool + argument + meta),
  **diff cards** per file (+/−, first lines), **permission card** (once / always for this project / reject),
  **done card** (results + "Reload tab" + "Kirim ke QA #n →" when the run came from a QA);
- composer: context chips (✓ halaman, + screenshot, + elemen, + console · n error), textarea
  (Enter sends, Shift+Enter newline, `/` commands, `@` files), Stop while running, model/agent label;
- **"Ringkas sesi"** action (from E, `screens/11`): agent drafts headline + results from the session;
  user edits, unticks, sends → `eco pm report` → banner in /project Ringkasan.

**Element picker** (`08`–`10`): toggled from the header (shortcut ⌘⇧E / Ctrl⇧E, Esc cancels). Overlay on
the page highlights the hovered element with a label (`tag.class · w×h`); click selects it, adds the
"elemen" chip, and sends selector, outerHTML (trimmed), computed key styles, rect and a cropped screenshot as
context. After a run that changed the page, "Reload tab" reloads it and a small toast confirms.

**QA** (`04`): list for this project (status chip, severity, wait clock, "Kerjakan"); **Tangkap tab jadi QA**:
captured screenshot with a box you draw, title, severity p0–p2, URL + browser auto-attached → creates the
QA in /project. **Kerjakan** = `eco pm qa take` → opens an Agent session prefilled with the report and
screenshots → each step mirrors to /project (`eco pm qa step`, `eco pm log`) → done → `eco pm qa done`
with the result list → reporter verifies in /project.

**Proyek** (`05`): hosting card (domain, release, plan, services), **Deploy versi lokal** with confirm
("n files changed since release-X · built on your machine, source not sent") and live log, Rollback;
gates as in the /project brief §5 (free/serve → locked card; early access → waitlist). Last session report
card; event list; "Buka /project ↗".

**Compose** (`06`): the existing bridge, restyled: LXS list from `ecompose.yml` (name, version, signed),
search + suggestions, `eco up dev`. Keep loading the hosted composer only if it can be embedded in the new
look; otherwise render natively from `eco` JSON.

**Onboarding** (F, `12`–`14`), one checklist that resumes where it stopped:
1. Masuk — "Pakai akun eco CLI di mesin ini" when `eco whoami` succeeds; else "Masuk dengan Google" =
   `eco login` (device login opens a tab, show the device code).
2. Helper — detect; else download per OS with one-line instructions.
3. OpenCode — detect version; else install with streamed log.
4. Pilih proyek — detected estate folders, the one matching the active tab marked.
5. Hubungkan ke /project — `eco pm link` (token in the CLI keychain).

States everywhere: loading (LED), empty, offline helper, OpenCode down (restart button), not signed in,
early-access gate, errors with a retry. Light + dark (tokens), focus rings, keyboard reachable, 4.5:1.

## 4. Phases (each ends with its e2e green)

1. **Foundation**: new panel shell (header, tabs, menu/dock, tokens, LED), helper v2 (allowlist, Linux +
   macOS, `eco` JSON actions), onboarding F with CLI-based sign-in, permission cleanup, Projects iframe removed.
2. **Agent on the OpenCode API**: sessions, streaming parts → steps/diffs, permissions, abort, attachments.
3. **Page-aware**: picker, page-context card, console capture, screenshot attach, reload after changes.
4. **QA + Proyek + session summary** via `eco pm` — depends on /project phase 4 (QA, sessions, `eco pm`).
   Until that ships, hide these behind a flag; never fake data in the real build.
5. **Store**: new screenshots from the real build, listing copy, privacy text, version 2.0.0, package script.

## 5. E2E (required) — `ecosphere-assistant/e2e`, Playwright

- Load the unpacked extension in Chromium (`launchPersistentContext` with `--load-extension` and
  `--disable-extensions-except`); open the side-panel page directly (`chrome-extension://<id>/sidepanel.html`)
  next to a test page.
- **Fakes, never the real account:** register a test native-messaging host manifest for the test profile
  that runs the real helper with `PATH` pointing to a **fake `eco`** (scripted JSON responses + call log)
  and a **fake OpenCode server** (local HTTP + SSE implementing exactly the endpoints the panel uses,
  replaying recorded event streams). Refuse to run if a real `~/.eco` key would be used.
- Scenarios: onboarding (CLI already signed in / Google device login / no helper / no OpenCode / pick
  project); send a prompt and render steps, diffs, a permission (once / always / reject) and done; Stop;
  picker → element chip → run → reload toast; console-error chip; QA capture → create (fake eco receives the
  right args); Kerjakan → steps mirrored (`eco pm qa step` calls) → done; Ringkas sesi → `eco pm report` args;
  deploy confirm + log + early-access gate; project auto-switch from the active tab; dock menu opens
  `chrome://settings/appearance`; helper offline and OpenCode-down states; keyboard-only run; axe a11y;
  visual snapshots next to `screens/`.
- Helper unit tests: allowlist rejects unknown actions and shell metacharacters; path resolution; Linux.

Report at the end of each phase: what passed, screenshots of the real panel next to the design screens, and
any deviation from the design with the reason.
