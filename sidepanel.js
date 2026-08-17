const frame = document.getElementById("frame");
const wizard = document.getElementById("wizard");
const loginEl = document.getElementById("login");
const overlay = document.getElementById("overlay");
const dot = document.getElementById("dot");
const statusEl = document.getElementById("status");
const portInput = document.getElementById("port");
const reloadBtn = document.getElementById("reload");
const whoEl = document.getElementById("who");
const signoutBtn = document.getElementById("signout");

const HOST_NAME = "com.opencode.sidebar";
const SESSION_KEY = "eco_session";
const AUTH_BASE = "https://getecosphere.com";
const DEFAULT_PORT = 4096;
const TIMEOUT_MS = 2500;

const STEP_HOST = "step-host";
const STEP_OPENCODE = "step-opencode";
const STEP_DIR = "step-dir";
const STEP_BUSY = "step-busy";

let hostPort = null;
let gotStatus = false;
let session = null;
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

// ── Account (getecosphere.com) ───────────────────────────────────────────

function applySessionUI() {
  const loggedIn = Boolean(session && session.token);
  loginEl.classList.toggle("hidden", loggedIn);
  wizard.classList.add("hidden");
  overlay.classList.add("hidden");
  frame.removeAttribute("src");
  whoEl.classList.toggle("hidden", !loggedIn);
  signoutBtn.classList.toggle("hidden", !loggedIn);
  portInput.classList.toggle("hidden", !loggedIn);
  reloadBtn.classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    whoEl.textContent = session.username || session.name || "";
    setStatus(false, "Signed in");
  } else {
    setStatus(false, "Sign in to continue");
  }
}

function setLoginError(text) {
  const el = document.getElementById("login-error");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

async function login() {
  const username = document.getElementById("login-id").value.trim();
  const password = document.getElementById("login-pass").value;
  const btn = document.getElementById("login-btn");
  setLoginError("");
  if (!username || !password) {
    setLoginError("Enter your username or email and password.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Signing in\u2026";
  try {
    const res = await fetch(`${AUTH_BASE}/auth-api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      throw new Error(data.message || data.error || "Invalid credentials.");
    }
    session = {
      token: data.token,
      username: (data.user && data.user.username) || username,
      name: (data.user && data.user.name) || "",
      role: (data.user && data.user.role) || "",
    };
    chrome.storage.local.set({ [SESSION_KEY]: session });
    applySessionUI();
    bootWizard();
  } catch (err) {
    setLoginError(err.message || "Sign in failed.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
}

function signout() {
  session = null;
  chrome.storage.local.remove(SESSION_KEY);
  document.getElementById("login-pass").value = "";
  applySessionUI();
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

function bootWizard() {
  setStatus(false, "Checking\u2026");
  showStep(STEP_BUSY);
  gotStatus = false;
  openPort();
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

document.getElementById("login-btn").addEventListener("click", login);
document.getElementById("login-pass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
document.getElementById("login-id").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("login-pass").focus();
});
signoutBtn.addEventListener("click", signout);

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
chrome.storage.local.get(SESSION_KEY).then((stored) => {
  session = (stored && stored[SESSION_KEY]) || null;
  if (session && session.token) {
    applySessionUI();
    bootWizard();
  } else {
    session = null;
    applySessionUI();
  }
});
