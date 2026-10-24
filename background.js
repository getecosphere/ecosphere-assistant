chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error(e));

// Ctrl/Cmd+Shift+E: open the panel for this window and ask it to start the element picker.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "pick-element" || !tab) return;
  chrome.sidePanel
    .open({ windowId: tab.windowId })
    .catch(() => {})
    .finally(() => setTimeout(() => chrome.runtime.sendMessage({ type: "cmd:pick" }).catch(() => {}), 350));
});
