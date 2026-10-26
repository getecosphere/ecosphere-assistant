# Chrome Web Store listing — Ecosphere Assistant 2.0

Everything the dashboard asks for. Copy is English; the six languages follow when the owner is satisfied with the English version
(`_locales/` + `js/locales/`, see `rules/extension-i18n.md`). Nothing here is published until the owner orders it.

## Store listing tab

- **Name:** Ecosphere Assistant
- **Summary (manifest `description`, ≤132):** Your /project dashboard and a coding agent that sees the page you are on, in Chrome's side panel. Everything runs on your machine.
- **Category:** Developer Tools · **Language:** English
- **Store icon:** `icons/icon128.png` (the P4 LED mark, 16 px transparent padding)
- **Screenshots** (1280×800, opaque JPEG, max 5, in this order), `store/screenshots/`:
  1. `00-brand.jpg` — brand slide (mark, name, tagline)
  2. `01-agent-sees-your-page.jpg` — pick an element, describe the change, reload
  3. `02-you-approve-every-step.jpg` — diffs and permission card
  4. `03-sessions-and-context.jpg` — blank sessions, the session list, the context meter
  5. `04-qa-requests.jpg` — QA requests from /project
- **Promo tiles:** `promo-small.jpg` (440×280, required), `promo-marquee.jpg` (1400×560)
- **Promo video:** the Web Store accepts a YouTube URL only. The film is the JS film at
  `https://getecosphere.com/static/assistant-film/index.html` (embedded on `/install`); record it with a screen recorder
  (full screen, sound on) and upload to YouTube if a store video is wanted.
- **Homepage URL:** https://getecosphere.com/install · **Support URL:** https://getecosphere.com/support
- **Privacy policy URL:** https://getecosphere.com/privacy (the extension section is current as of 25 Oct 2026; it must be **live** before submit)

### Detailed description

> A coding agent beside your page, and your Ecosphere project, in Chrome's side panel.
>
> **Works with OpenCode or Claude Code.** The agent in this panel is a coding agent on your own computer: OpenCode
> (opencode.ai, open source) or Claude Code (claude.com/claude-code), your choice in the menu. The extension is its interface
> in Chrome: without one of them the chat and the agent do not work. Setup installs OpenCode for you if you have neither. The
> AI model and its account, subscription or API key are the ones you set up in that agent; model costs are between you and
> that provider. Ecosphere Assistant is not made by or affiliated with the OpenCode project or Anthropic.
>
> **An agent that sees the page you are on.** Pick an element, describe the change, and the agent finds it in your source and
> edits it. Reload the tab to see it. You choose what it may see: the page address, the element, a screenshot, the console errors.
>
> **You approve every step.** File changes appear as diffs. Every command waits for you: allow once, always for this project,
> or reject. Or switch on YOLO for a project and let the agent run without asking. Rules from your workspace AGENTS.md are
> passed on to the agent.
>
> **Sessions that save tokens.** Start from a blank session, switch back to an old one, rename or fork it, with slash commands
> (/new, /sessions, /compact…); with OpenCode also undo, redo and share. A context meter explains how full the model's memory is and
> offers Compact when it fills up.
>
> **Your project dashboard.** Open QA requests waiting in /project and let the agent reproduce and fix them; steps and an
> end-of-session summary appear on the dashboard. Deploy the version you built on your machine (your source is never uploaded)
> and add signed LXS capabilities to your `ecompose.yml` without hand-editing YAML.
>
> **Private by design.** The agent and a small helper program run on your computer. "Signed in" means the `eco` CLI on your
> machine is signed in: the extension stores no key or token and reads a page only when you ask.
>
> **What you need**
> - OpenCode or Claude Code on your computer, with a model or subscription set up (OpenCode is installed during setup if you have neither)
> - The eco CLI and an Ecosphere account (for /project, QA and deploy)
> - The local helper (one install command shown on first open)
> - Chrome 116+, macOS or Linux, Node.js 18+ (Windows via WSL is planned)
>
> Setup is a short checklist on first open, with a welcome tour.

## Privacy practices tab (answers read from the code)

- **Single purpose:** a side-panel workspace for an Ecosphere project: a local coding agent that can see the active page, plus the project's QA, deploy and compose tools.
- **`sidePanel`:** the whole UI (the interface for OpenCode, the local coding agent the extension depends on). **`nativeMessaging`:** talks to the local helper that runs `eco` and `opencode` (a fixed list of actions, arguments as an array, no shell).
- **`storage`:** theme, last project, panel preferences, onboarding progress; never credentials or page content.
- **`tabs`:** read the active tab's address, title and favicon to pick the matching project and show the page context.
- **`activeTab` + `scripting`:** inject the element picker and the console hook into the tab, only after the user clicks pick or allow.
- **Host permissions `127.0.0.1`, `localhost`:** the local OpenCode server and local dev estates. **`https://getecosphere.com/*`:** opening the /project dashboard.
- **Optional `<all_urls>`:** asked at first use, per user action, for page access on the user's own sites and tab screenshots (`captureVisibleTab` needs it). Never required to install.
- **Remote code:** No (no `eval`, no `new Function`, no remote scripts; fonts are bundled). `store/package.sh` greps for it before it builds.
- **Data usage boxes:** *Website content* (the selected element, console errors, a screenshot) and *Authentication information* are handled **on the user's computer only**: the extension reads website content when the user asks and sends it to the OpenCode server on the user's own machine; it never reads, stores or sees a password, key or token. Nothing is sent to us. Tick: *Website content*. Leave the other boxes empty.
- **Certifications (all three apply):** not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending.

## Build and submit

1. `store/package.sh` → `store/ecosphere-assistant-cws.zip` (drops the dev `key`, never ships `native/key.pem` or generated config) and rebuilds `helper-install.sh`.
2. Regenerate graphics when the UI changed: `cd e2e && STORE=1 npx playwright test tests/94-store.spec.js` (writes `store/screenshots/*.jpg` and `store/panels/*.jpg`), `python3 store/make-icons.py` for the icons.
3. Upload the zip: https://chrome.google.com/webstore/devconsole → *New item*. Fill the Store listing and Privacy practices tabs from this file.
4. **After the first upload** copy the item's ID (dashboard → the item → *Package* shows it; it is the 32-letter string in the item URL) into `native/store-id`, run `native/build-helper.sh`, and host the new `helper-install.sh` so the helper accepts the store ID next to the dev ID.
5. Host `helper-install.sh` at `https://getecosphere.com/downloads/helper-install.sh` and deploy the /install page, the film and the privacy text. These steps wait for the owner's order (deploy policy).
6. When the item is public, replace the search link on `/install` (`chromewebstore.google.com/search/ecosphere%20assistant`) with the item URL.
