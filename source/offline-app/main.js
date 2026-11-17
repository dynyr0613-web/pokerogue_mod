// PokeRogue Offline: desktop wrapper for the user's local PokeRogue fork (AGPL-3.0-only).
// The game is served from the bundled `game/` folder through a private app:// origin, and every
// outside network request is blocked, so it runs fully offline and never talks to any server.
"use strict";

const { app, BrowserWindow, protocol, session, shell, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SCHEME = "app";
const HOST = "pokerogue";
const START_URL = `${SCHEME}://${HOST}/index.html`;
// 2026-11-14: the edition name the user gave the distributed build (the window title). The product name
// ("PokeRogue Offline") stays, so the exe name and the save folder %APPDATA%\PokeRogue Offline do not change.
const WINDOW_TITLE = "포켓로그 - 도주런 없는 엔드리스 에디션";

// Must run before the app is ready: a standard, secure scheme behaves like https for fetch,
// localStorage (saves), audio decoding and ES modules.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".fnt": "application/xml",
  ".wasm": "application/wasm",
};

function gameRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "game");
  }
  // Unpackaged runs (npm start, self-test) use the fork's build output directly
  return process.env.POKEROGUE_GAME_DIR || path.join(__dirname, "..", "pokerogue", "dist");
}

// ---- self-test (POKEROGUE_SELFTEST=<folder>): load, wait, screenshot, log requests, quit ----
const selfTestDir = process.env.POKEROGUE_SELFTEST || "";
const selfTestLog = [];
function testLog(line) {
  if (selfTestDir) {
    selfTestLog.push(`${new Date().toISOString()} ${line}`);
  }
}

function registerGameProtocol() {
  const root = gameRoot();
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") {
      rel = "/index.html";
    }
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) {
      testLog(`403 ${request.url}`);
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
      return new Response(data, { status: 200, headers: { "content-type": type, "cache-control": "no-cache" } });
    } catch {
      testLog(`404 ${request.url}`);
      return new Response("Not found", { status: 404 });
    }
  });
}

function blockNetwork() {
  // Offline by design: nothing leaves the PC (no official server, no accounts, no telemetry).
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      testLog(`BLOCKED ${details.method} ${details.url}`);
      callback({ cancel: true });
    },
  );
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: "#000000",
    title: WINDOW_TITLE,
    autoHideMenuBar: true,
    show: !selfTestDir,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // keep the edition name in the title bar (the game page would replace it with its own <title>)
  win.on("page-title-updated", event => event.preventDefault());

  // Links in the game menu (wiki, Discord, GitHub) open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    }
  });

  // F11: full screen, Ctrl+R / F5: reload (handy if something gets stuck)
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  if (selfTestDir) {
    // A hidden window gets no animation frames, so the self-test shows a nearly transparent one
    // that never takes focus or a taskbar slot
    win.setSkipTaskbar(true);
    win.setFocusable(false);
    win.setOpacity(0.02);
    win.showInactive();
    win.webContents.on("console-message", event => {
      const { level, message, lineNumber, sourceId } = event;
      testLog(`console[${level}] ${message} (${sourceId}:${lineNumber})`);
    });
    win.webContents.on("render-process-gone", (_e, details) => testLog(`RENDERER GONE ${JSON.stringify(details)}`));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => testLog(`LOAD FAIL ${code} ${desc} ${url}`));
    runSelfTest(win);
  }

  win.loadURL(START_URL);
  return win;
}

async function runSelfTest(win) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shots = [];
  fs.mkdirSync(selfTestDir, { recursive: true });
  // 2026-11-08: a screenshot can fail while the PC's display is off ("Current display surface not available for
  // capture"); log it and go on, so the rest of the test (starter select, blocked requests, 404s) still runs
  const snap = async name => {
    try {
      const image = await win.webContents.capturePage();
      const file = path.join(selfTestDir, `${name}.png`);
      fs.writeFileSync(file, image.toPNG());
      shots.push(file);
    } catch (e) {
      testLog(`shot skipped ${name}: ${e && e.message ? e.message : e}`);
    }
  };
  const probe = () =>
    win.webContents
      .executeJavaScript(
        `(() => ({ title: document.title, canvas: !!document.querySelector("canvas"), keys: Object.keys(localStorage), lang: navigator.language }))()`,
      )
      .catch(e => ({ error: String(e) }));
  const press = async key => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
    await wait(60);
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
  };
  try {
    win.webContents.once("did-finish-load", () => testLog("did-finish-load"));
    await wait(Number(process.env.POKEROGUE_SELFTEST_WAIT || 45000));
    testLog(`probe ${JSON.stringify(await probe())}`);
    await snap("1-loaded");
    // press through the intro messages and the gender question to the title menu
    for (let i = 0; i < 16; i++) {
      await press("Space");
      await wait(1500);
    }
    await snap("2-title");
    // New game, then whatever comes next (mode select or starter select)
    for (let i = 0; i < 3; i++) {
      await press("Space");
      await wait(3000);
      await snap(`${3 + i}-new-game-${i}`);
    }
    testLog(`probe ${JSON.stringify(await probe())}`);
  } catch (e) {
    testLog(`SELFTEST ERROR ${e && e.stack ? e.stack : e}`);
  } finally {
    testLog(`shots ${shots.join(", ")}`);
    fs.writeFileSync(path.join(selfTestDir, "selftest.log"), selfTestLog.join("\n"), "utf8");
    app.exit(0);
  }
}

if (!selfTestDir && !app.requestSingleInstanceLock()) {
  // One window at a time, so two copies never write the same save
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerGameProtocol();
    blockNetwork();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
