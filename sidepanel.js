const frame = document.getElementById("frame");
const wizard = document.getElementById("wizard");
const overlay = document.getElementById("overlay");
const dot = document.getElementById("dot");
const statusEl = document.getElementById("status");
const portInput = document.getElementById("port");
const reloadBtn = document.getElementById("reload");

const HOST_NAME = "com.opencode.sidebar";
const DEFAULT_PORT = 4096;
const TIMEOUT_MS = 2500;

const STEP_HOST = "step-host";
const STEP_OPENCODE = "step-opencode";
const STEP_DIR = "step-dir";
const STEP_BUSY = "step-busy";

let hostPort = null;
let gotStatus = false;
let state = {
  opencodePath: null,
  opencodeVersion: null,
  defaultDirectory: "",
  dir: localStorage.getItem("ocDir") || "",
};

function getPort() {
  let p = parseInt(localStorage.getItem("ocPort") || String(DEFAULT_PORT), 10);
  if (!Number.isFinite(p) || p < 1 || p > 65535) p = DEFAULT_PORT;
  return p;
}

function setStatus(ok, label) {
  dot.className = "dot " + (ok ? "on" : "off");
  statusEl.textContent = label;
}

function showStep(id) {
  for (const s of [STEP_HOST, STEP_OPENCODE, STEP_DIR, STEP_BUSY]) {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  }
  wizard.classList.remove("hidden");
  overlay.classList.add("hidden");
}

function hideWizard() {
  wizard.classList.add("hidden");
}

function setDirError(text) {
  const el = document.getElementById("dir-error");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

function appendLog(line) {
  const el = document.getElementById("install-log");
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
}

function openPort() {
  try {
    hostPort = chrome.runtime.connectNative(HOST_NAME);
    hostPort.onMessage.addListener(onHostMessage);
    hostPort.onDisconnect.addListener(onHostDisconnect);
  } catch {
    showStep(STEP_HOST);
  }
}

function onHostDisconnect() {
  hostPort = null;
  if (!gotStatus) {
    setStatus(false, "Helper not found");
    showStep(STEP_HOST);
  }
}

function onHostMessage(msg) {
  if (msg.type === "status") {
    gotStatus = true;
    state.opencodePath = msg.opencodePath;
    state.opencodeVersion = msg.opencodeVersion;
    state.defaultDirectory = msg.defaultDirectory || "";
    if (!state.dir) {
      state.dir = state.defaultDirectory;
      localStorage.setItem("ocDir", state.dir);
    }
    if (!msg.opencodeInstalled) {
      setStatus(false, "OpenCode not installed");
      showStep(STEP_OPENCODE);
    } else if (state.dir) {
      startServer();
    } else {
      setStatus(false, "Choose a folder");
      showStep(STEP_DIR);
    }
  } else if (msg.type === "install-start") {
    document.getElementById("install-log").textContent = "";
    document.getElementById("install-oc").disabled = true;
    appendLog("Downloading and installing OpenCode\u2026");
  } else if (msg.type === "install-log") {
    appendLog(msg.line);
  } else if (msg.type === "install-done") {
    document.getElementById("install-oc").disabled = false;
    if (msg.ok) {
      appendLog("Done \u2713 OpenCode " + (msg.version || "") + " at " + msg.path);
      state.opencodePath = msg.path;
      state.opencodeVersion = msg.version;
      startServer();
    } else {
      appendLog("Install failed: " + (msg.error || "unknown error"));
    }
  } else if (msg.type === "start") {
    if (msg.ok) {
      connected();
    } else {
      setStatus(false, "Could not start server");
      setDirError(msg.error || "Failed to start the server.");
      showStep(STEP_DIR);
    }
  }
}

function startServer() {
  setStatus(false, "Starting server\u2026");
  showStep(STEP_BUSY);
  try {
    hostPort.postMessage({ type: "start", port: getPort(), directory: state.dir });
  } catch {
    showStep(STEP_HOST);
  }
}

function connected() {
  frame.src = `http://127.0.0.1:${getPort()}/`;
  hideWizard();
  setStatus(true, "Connected");
}

// --- event wiring ---

document.getElementById("recheck-host").addEventListener("click", () => {
  gotStatus = false;
  setStatus(false, "Checking\u2026");
  openPort();
});

document.getElementById("install-oc").addEventListener("click", () => {
  if (hostPort) hostPort.postMessage({ type: "install-opencode" });
});

document.getElementById("connect-btn").addEventListener("click", () => {
  const dir = document.getElementById("dir").value.trim();
  setDirError("");
  if (!dir) {
    setDirError("Enter the path to your project folder.");
    return;
  }
  state.dir = dir;
  localStorage.setItem("ocDir", dir);
  startServer();
});

document.getElementById("dir").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("connect-btn").click();
});

document.getElementById("ext-id").textContent = chrome.runtime.id;

portInput.value = getPort();
portInput.addEventListener("change", () => {
  const p = parseInt(portInput.value, 10);
  if (Number.isFinite(p) && p >= 1 && p <= 65535) {
    localStorage.setItem("ocPort", String(p));
    frame.src = "";
    startServer();
  }
});
reloadBtn.addEventListener("click", () => {
  if (gotStatus && state.dir) startServer();
  else {
    gotStatus = false;
    openPort();
  }
});
document.getElementById("retry").addEventListener("click", () => startServer());
document.getElementById("open-tab").addEventListener("click", () => {
  chrome.tabs.create({ url: `http://127.0.0.1:${getPort()}/` });
});

// --- boot ---

setStatus(false, "Checking\u2026");
showStep(STEP_BUSY);
openPort();
