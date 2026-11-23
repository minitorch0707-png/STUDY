// LectureLab desktop app (Electron).
//
// What happens when a student opens the app:
//   1. A small loading window appears.
//   2. The LectureLab server starts in the background, using the copy of
//      Node.js bundled inside the app (nothing to install).
//   3. The main window opens. On first run, the app shows the one-click AI
//      setup, which downloads the free AI engine and model onto this computer.
// Everything runs locally; the only network calls are downloads, update
// checks, and (for Pro) checking a licence key with the store.

const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const REPO = "minitorch0707-png/lecturelab";
const PREFERRED_PORT = 47321;
const isDev = !app.isPackaged;

let server = null;
let mainWindow = null;
let splash = null;
let baseUrl = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const paths = () => {
  const userData = app.getPath("userData");
  return {
    data: path.join(userData, "data"),
    log: path.join(userData, "server.log"),
    server: isDev ? path.join(__dirname, "..", ".next", "standalone") : path.join(process.resourcesPath, "server"),
    node: isDev
      ? process.env.LECTURELAB_NODE || (fs.existsSync(path.join(__dirname, "resources", "node", nodeName())) ? path.join(__dirname, "resources", "node", nodeName()) : "node")
      : path.join(process.resourcesPath, "node", nodeName()),
  };
};
function nodeName() {
  return process.platform === "win32" ? "node.exe" : "node";
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => {
      const s2 = net.createServer();
      s2.listen(0, "127.0.0.1", () => {
        const p = s2.address().port;
        s2.close(() => resolve(p));
      });
    });
    s.listen(preferred, "127.0.0.1", () => s.close(() => resolve(preferred)));
  });
}

async function waitForServer(url, ms = 90_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (server && server.exitCode !== null) return false;
    try {
      const r = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function startServer() {
  const p = paths();
  fs.mkdirSync(p.data, { recursive: true });
  const port = await freePort(PREFERRED_PORT);
  baseUrl = `http://127.0.0.1:${port}`;
  const log = fs.openSync(p.log, "a");
  fs.writeSync(log, `\n--- ${new Date().toISOString()} starting LectureLab ${app.getVersion()} on ${baseUrl}\n`);
  server = spawn(p.node, [path.join(p.server, "server.js")], {
    cwd: p.server,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      LECTURELAB_DATA_DIR: p.data,
      LECTURELAB_DESKTOP: "1",
      LECTURELAB_APP_VERSION: app.getVersion(),
    },
    stdio: ["ignore", log, log],
    windowsHide: true,
    // Own process group on Mac/Linux, so quitting stops the server AND the AI engine it started.
    detached: process.platform !== "win32",
  });
  server.on("exit", (code) => {
    if (!quitting) {
      dialog.showErrorBox("LectureLab stopped", `The LectureLab engine stopped unexpectedly (code ${code}).\n\nDetails are in:\n${p.log}\n\nPlease restart the app.`);
      app.quit();
    }
  });
  return waitForServer(baseUrl);
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    try {
      server.kill();
    } catch {
      /* already stopped */
    }
  }
}

const bg = () => (nativeTheme.shouldUseDarkColors ? "#0d0f17" : "#f7f7fb");

function createSplash() {
  splash = new BrowserWindow({ width: 420, height: 300, frame: false, resizable: false, show: false, backgroundColor: bg(), webPreferences: { sandbox: true } });
  splash.loadFile(path.join(__dirname, "splash.html"));
  splash.once("ready-to-show", () => splash && splash.show());
}

function isAppUrl(url) {
  return baseUrl && url.startsWith(baseUrl);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "LectureLab",
    backgroundColor: bg(),
    webPreferences: { contextIsolation: true, sandbox: true, plugins: true, preload: path.join(__dirname, "preload.js") },
  });
  // Links to websites (YouTube, Wikipedia, the store) open in the normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 1000, height: 800, backgroundColor: bg() } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (splash) {
      splash.destroy();
      splash = null;
    }
  });
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.loadURL(baseUrl);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const p = paths();
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "forceReload" }, ...(isDev ? [{ role: "toggleDevTools" }] : []), { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Check for updates…", click: () => checkForUpdates(true) },
        { label: "Report a problem", click: () => shell.openExternal(`https://github.com/${REPO}/issues/new/choose`) },
        { label: "LectureLab on GitHub", click: () => shell.openExternal(`https://github.com/${REPO}`) },
        { type: "separator" },
        { label: "Show my data folder", click: () => shell.openPath(p.data) },
        { label: "Show log file", click: () => shell.showItemInFolder(p.log) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- Updates
// Windows: downloads updates in the background and installs them on restart.
// Mac: apps not signed with an Apple Developer ID can't self-install updates,
// so we show a message with a download link instead.
function newer(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkForUpdates(manual = false) {
  if (isDev) {
    if (manual) dialog.showMessageBox({ message: "Updates are only checked in the installed app." });
    return;
  }
  if (process.platform === "win32") {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.once("update-downloaded", (info) => {
        dialog
          .showMessageBox({ type: "info", buttons: ["Restart now", "Later"], message: `LectureLab ${info.version} is ready`, detail: "Restart to finish updating. Your courses and progress are kept." })
          .then((r) => r.response === 0 && autoUpdater.quitAndInstall());
      });
      const r = await autoUpdater.checkForUpdates();
      if (manual && (!r || !r.isUpdateAvailable)) dialog.showMessageBox({ message: "You're on the latest version." });
    } catch (e) {
      if (manual) dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates.", detail: String(e && e.message) });
    }
    return;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
    const rel = await r.json();
    if (rel.tag_name && newer(rel.tag_name, app.getVersion())) {
      const res = await dialog.showMessageBox({
        type: "info",
        buttons: ["Download update", "Later"],
        message: `LectureLab ${rel.tag_name.replace(/^v/, "")} is available`,
        detail: "Download the new version and drag it into Applications to replace this one. Your courses and progress are kept.",
      });
      if (res.response === 0) shell.openExternal(rel.html_url);
    } else if (manual) dialog.showMessageBox({ message: "You're on the latest version." });
  } catch (e) {
    if (manual) dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates.", detail: String(e && e.message) });
  }
}

// ---------------------------------------------------------------- Lifecycle
app.whenReady().then(async () => {
  buildMenu();
  createSplash();
  const ok = await startServer();
  if (!ok) {
    dialog.showErrorBox("LectureLab couldn't start", `Something went wrong while starting.\n\nPlease restart the app. If it keeps happening, use Help → Report a problem and attach:\n${paths().log}`);
    app.quit();
    return;
  }
  createMainWindow();
  setTimeout(() => checkForUpdates(false), 15_000);
  setInterval(() => checkForUpdates(false), 6 * 3600_000);
});

app.on("activate", () => {
  if (!mainWindow && baseUrl) createMainWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
