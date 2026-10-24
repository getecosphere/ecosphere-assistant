# Privacy — Ecosphere Assistant (text for getecosphere.com/privacy, extension section)

Ecosphere Assistant runs on your computer. It has no server of its own and sends us nothing.

- **Sign-in:** the extension never sees your password, API key or session token. "Signed in" means the `eco` CLI on your machine is signed in; sign-in is done by `eco login` in your browser (Google).
- **What it reads:** the address and title of the active tab (to pick the project and show context). Only when you click *pick element*, *allow this site*, or *capture*, it reads the selected element (HTML, a few computed styles, a cropped screenshot), the page's console errors, or a screenshot of the visible tab.
- **Where that goes:** to the OpenCode server running on your own computer (127.0.0.1, protected by a random per-launch password). OpenCode may send your prompt and this context to the AI model provider you configured in OpenCode; that is governed by your agreement with that provider, not by us.
- **QA and reports:** a QA request you create, a progress step, or a session summary is sent by the `eco` CLI to your project on getecosphere.com. Nothing is posted without your click; secrets are redacted from step/log lines.
- **Stored in the browser:** theme, last project, panel preferences and onboarding progress (`chrome.storage.local`). No credentials, no page content.
- **Stored on your machine by the helper:** the list of project folders you approved and the per-launch OpenCode server details, in `~/.ecosphere-assistant/` (owner-only permissions).
- **Remove everything:** remove the extension and run `native/uninstall.sh`.
