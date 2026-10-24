# Chrome Web Store listing — Ecosphere Assistant 2.0

## Metadata

- **Name:** Ecosphere Assistant
- **Short description (manifest, ≤132):** Your /project dashboard and a coding agent that sees the page you are on, in Chrome's side panel. Everything runs on your machine.
- **Category:** Developer Tools · **Language:** English
- **Homepage:** https://getecosphere.com/install · **Privacy policy URL:** https://getecosphere.com/privacy
- **Support URL:** https://github.com/getecosphere/ecosphere-assistant
- **Screenshots (1280×800, `store/screenshots/*.jpg`, in order):** 01 agent-sees-your-page, 02 you-approve-every-step, 03 qa-from-the-tab, 04 deploy-your-local-build, 05 compose-capabilities. Demo data only.

## Full description

> A coding agent beside your page — and your Ecosphere project, in Chrome's side panel.
>
> **Agent that sees the page you are on.** Pick an element on the page, describe the change, and the agent finds it in your
> source, edits it, and you reload the tab to see it. The panel shows every step, every diff, and asks before it runs anything
> (allow once, always for this project, or reject).
>
> **QA to fix, in one flow.** Turn the active tab into a QA request (mark the problem on a screenshot), or open a waiting
> request and let the agent reproduce and fix it; progress is mirrored to your /project dashboard and you send it back for
> verification. End a session with an executive summary that appears in /project.
>
> **Project and Compose.** See your hosting, deploy the version you built on your machine (source is never uploaded), and
> add signed LXS capabilities to your `ecompose.yml` without hand-editing YAML.
>
> **Private by design.** The agent and the helper run on your computer. Signing in means the `eco` CLI on your machine is
> signed in; the extension stores no key or token. It only reads a page when you ask (pick an element, capture, console errors).
>
> Setup is a short checklist the first time you open the panel. Requirements: Chrome 116+, macOS or Linux, Node.js 18+
> (Windows via WSL is on the roadmap). Source: https://github.com/getecosphere/ecosphere-assistant

## Privacy practices tab (answers read from the code)

- **Single purpose:** a side-panel workspace for an Ecosphere project: a local coding agent that can see the active page, plus the project's QA, deploy and compose tools.
- **`sidePanel`:** the whole UI. **`nativeMessaging`:** talks to the local helper that runs `eco` and `opencode` (fixed list of actions, no shell). **`storage`:** theme, last project, onboarding progress; never credentials.
- **`tabs`:** read the active tab URL/title to pick the matching project and show the page context. **`activeTab` + `scripting`:** inject the element picker and console hook into the tab, only after the user clicks pick/allow.
- **Host permissions `127.0.0.1`, `localhost`:** the local OpenCode server and local dev estates. **`https://getecosphere.com/*`:** opening /project. **Optional `<all_urls>`:** requested at first use, per user action, for page access on the user's own sites and tab screenshots (`captureVisibleTab` requires it).
- **Remote code:** No (no `eval`, no `new Function`, no remote scripts; fonts are bundled).
- **Data collected:** none sent to us. Page content (selected element, console errors, screenshots) is sent only to the user's own local OpenCode server, and from there to the model provider the user configured in OpenCode.
- **Not sold / not used for unrelated purposes / no creditworthiness use:** all three certifications apply.
