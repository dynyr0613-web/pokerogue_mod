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
  // Local fork (2026-11-18): resolved, so a folder given with forward slashes still passes the protocol's
  // "inside the game folder" check (selftest.sh points it at the offline copy's resources\game)
  return process.env.POKEROGUE_GAME_DIR
    ? path.resolve(process.env.POKEROGUE_GAME_DIR)
    : path.join(__dirname, "..", "pokerogue", "dist");
}

// ---- self-test (POKEROGUE_SELFTEST=<folder>): a scripted run from the title to a battle and the mark screens,
// with screenshots and selftest.log (requests, console, every step), then quit ----
// Local fork (2026-11-18): the user ("화면 확인 관련 코드"): since 11-17 the self-test failed every time with
// starter=0, (a) with the display off (no frames, "Current display surface not available for capture") and
// (b) with a run in progress in the user's save (the first Space picked 이어하기). It now runs on its own empty
// profile and in an offscreen window; the normal app (no POKEROGUE_SELFTEST) is unchanged.
const selfTestDir = process.env.POKEROGUE_SELFTEST ? path.resolve(process.env.POKEROGUE_SELFTEST) : "";
const selfTestLogFile = selfTestDir ? path.join(selfTestDir, "selftest.log") : "";
// Local fork (2026-11-18): the window size of the self-test, the game's own 1920x1080 so the shots are 1:1
const SELFTEST_WIDTH = 1920;
const SELFTEST_HEIGHT = 1080;
// Local fork (2026-11-18): the phase the game last logged ("Start Phase X") and every one so far, for the run below
let selfTestPhase = "";
const selfTestPhases = [];
function testLog(line) {
  if (selfTestDir) {
    // Local fork (2026-11-18): written line by line, so a run cut short (timeout, crash) still leaves its log
    try {
      fs.appendFileSync(selfTestLogFile, `${new Date().toISOString()} ${line}\n`, "utf8");
    } catch {
      // nothing else to report it to
    }
  }
}

if (selfTestDir) {
  fs.mkdirSync(selfTestDir, { recursive: true });
  fs.writeFileSync(selfTestLogFile, "", "utf8");
  // Local fork (2026-11-18): a throwaway profile in the test's own folder, emptied first: localStorage (the save),
  // caches and settings all live there, so the test never reads or writes the user's save in
  // %APPDATA%\PokeRogue Offline (nor the Claude app's virtualized copy of it), always starts from a fresh save
  // (title -> 새로운 게임, never 이어하기) and can even run while the user plays. selftest.sh deletes it afterwards.
  let profileDir = path.join(selfTestDir, "profile");
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch {
    profileDir = path.join(selfTestDir, `profile-${Date.now()}`);
  }
  app.setPath("userData", profileDir);
  app.setPath("sessionData", profileDir);
  testLog(`selftest profile ${profileDir}`);
  testLog(`selftest game ${gameRoot()}`);
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
      // Local fork (2026-11-18): the self-test renders offscreen: Chromium draws the frames on its own timer and
      // capturePage reads them from there, with no window on screen, so neither stops while the display is off.
      // Never set for the normal app.
      ...(selfTestDir ? { offscreen: true } : {}),
    },
    // Local fork (2026-11-18): and at the game's own size (1920x1080), so the shots are sharp
    ...(selfTestDir ? { width: SELFTEST_WIDTH, height: SELFTEST_HEIGHT, useContentSize: true } : {}),
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
    // Local fork (2026-11-18): the window is offscreen (webPreferences above), so it is never shown, takes no focus
    // and has no taskbar slot; the old nearly transparent window on screen (2026-11-03) lost its frames with the
    // display off. Chromium draws it 30 times a second, and the game's sound is muted (no music from the speakers).
    win.setSkipTaskbar(true);
    win.webContents.setFrameRate(30);
    win.webContents.setAudioMuted(true);
    win.webContents.on("console-message", event => {
      const { level, message, lineNumber, sourceId } = event;
      testLog(`console[${level}] ${message} (${sourceId}:${lineNumber})`);
      // Local fork (2026-11-18): the game logs "%cStart Phase X" at every phase; the run below waits on them
      const phase = /Start Phase (\w+)/.exec(message);
      if (phase) {
        selfTestPhase = phase[1];
        selfTestPhases.push(phase[1]);
      }
    });
    win.webContents.on("render-process-gone", (_e, details) => testLog(`RENDERER GONE ${JSON.stringify(details)}`));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => testLog(`LOAD FAIL ${code} ${desc} ${url}`));
    runSelfTest(win);
  }

  win.loadURL(START_URL);
  return win;
}

// Local fork (2026-11-18): the tutorials of src/tutorial.ts, marked as seen in the self-test's fresh save, so no
// tutorial dialogue takes a key press meant for a menu (the steps below count on the menus' cursor positions)
const SELFTEST_TUTORIALS = [
  "INTRO",
  "ACCESS_MENU",
  "MENU",
  "STARTER_SELECT",
  "POKEDEX",
  "POKERUS",
  "STAT_CHANGE",
  "SELECT_ITEM",
  "EGG_GACHA",
];

/**
 * Local fork (2026-11-18): the self-test run. On the fresh save it presses the keyboard like a player: through the
 * gender question to the title, 새로운 게임 -> 클래식, adds the first starter and starts, presses A through the
 * encounter to the command menu, then opens 포켓몬 -> the first Pokémon -> 도감 -> its marks (the 11-17 Pokédex page
 * mark list), and the menu's 증표도감 (UiMode.MARK_DEX) with its second view. Every step waits on what the game
 * shows (the UI mode ui.ts writes into #touchControls' data-ui-mode, also on desktop, and the logged phase) with a
 * timeout, and logs "STEP ok <name>" or "STEP FAILED <name>: <why> <state>"; the last lines are
 * "RESULT PASS|FAILED steps=<ok>/<all> battle=0|1 shots=<n> ..." and the list of shots. Screenshots are numbered
 * PNGs in the test folder (01-loaded.png ... 15-mark-dex-lines.png). selftest.sh reads the log.
 */
async function runSelfTest(win) {
  const wc = win.webContents;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const errText = e => (e && e.message ? e.message : String(e));
  const withTimeout = (promise, ms, what) =>
    Promise.race([promise, new Promise((_r, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);
  const startedAt = Date.now();
  const shots = [];
  const passed = [];
  const failed = [];
  let shotNumber = 0;
  let finished = false;
  let lastState = {};
  let totalSteps = 0;

  const probe = () =>
    withTimeout(
      wc.executeJavaScript(
        `(() => ({ title: document.title, canvas: !!document.querySelector("canvas"), keys: Object.keys(localStorage), lang: navigator.language }))()`,
      ),
      5000,
      "probe",
    ).catch(e => ({ error: errText(e) }));
  // what the game shows: the UI mode (ui.ts writes its name into #touchControls' data-ui-mode on every screen) and
  // the wave (window.gameInfo); the phase comes from the console (createWindow)
  const state = async () => {
    const page = await withTimeout(
      wc.executeJavaScript(
        `(() => ({ mode: document.getElementById("touchControls")?.dataset.uiMode || "", wave: window.gameInfo?.wave ?? null }))()`,
      ),
      5000,
      "page state",
    ).catch(e => ({ mode: "", error: errText(e) }));
    return { ...page, phase: selfTestPhase };
  };
  const gameInfo = () =>
    withTimeout(
      wc.executeJavaScript(
        `(() => { const g = window.gameInfo || {}; return { gameMode: g.gameMode ?? null, biome: g.biome ?? null, wave: g.wave ?? null, party: (g.party || []).map(p => p.name + " Lv." + p.level) }; })()`,
      ),
      5000,
      "game info",
    ).catch(e => ({ error: errText(e) }));
  // 2026-11-08: a failed capture is logged and the run goes on; the offscreen window should never fail it now
  const snap = async name => {
    shotNumber++;
    const file = `${String(shotNumber).padStart(2, "0")}-${name}.png`;
    try {
      const image = await withTimeout(wc.capturePage(), 10000, "capture");
      if (image.isEmpty()) {
        throw new Error("empty image");
      }
      fs.writeFileSync(path.join(selfTestDir, file), image.toPNG());
      shots.push(file);
      testLog(`shot ${file} ${JSON.stringify(await state())}`);
    } catch (e) {
      testLog(`shot skipped ${name}: ${errText(e)}`);
    }
  };
  // Electron key names: Space = A (action), Enter = start, Backspace = B (cancel), Escape = menu, Up/Down/Left/Right
  const press = async (key, settleMs = 500) => {
    wc.sendInputEvent({ type: "keyDown", keyCode: key });
    await wait(60);
    wc.sendInputEvent({ type: "keyUp", keyCode: key });
    await wait(settleMs);
  };
  const isMode = name => s => s.mode === name;
  const waitFor = async (test, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      lastState = await state();
      if (test(lastState)) {
        return true;
      }
      if (Date.now() >= end) {
        return false;
      }
      await wait(250);
    }
  };
  // press a key (picked from the state) every intervalMs until the state passes the test
  const pressUntil = async (test, keyFor, timeoutMs, intervalMs) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      lastState = await state();
      if (test(lastState)) {
        return true;
      }
      if (Date.now() >= end) {
        return false;
      }
      await press(keyFor(lastState), intervalMs);
    }
  };
  const backToCommand = async () =>
    (await pressUntil(isMode("COMMAND"), () => "Backspace", 20000, 1000)) || "could not get back to the command menu";

  const finish = async reason => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(watchdog);
    testLog(`probe ${JSON.stringify(await probe())}`);
    const ok = !reason && failed.length === 0 && passed.length === totalSteps;
    testLog(
      `RESULT ${ok ? "PASS" : "FAILED"} steps=${passed.length}/${totalSteps} battle=${passed.includes("battle") ? 1 : 0}`
        + ` shots=${shots.length} seconds=${Math.round((Date.now() - startedAt) / 1000)}`
        + (failed.length > 0 ? ` failed=${failed.join(",")}` : "")
        + (reason ? ` reason=${reason}` : ""),
    );
    testLog(`shots ${shots.join(", ")}`);
    app.exit(ok ? 0 : 1);
  };
  // the whole run stays under selftest.sh's 300 s limit, so it always ends with its RESULT line
  const watchdog = setTimeout(() => finish("watchdog"), Number(process.env.POKEROGUE_SELFTEST_TIMEOUT || 270000));
  wc.on("render-process-gone", () => finish("renderer gone"));

  // one named step: it returns true, or a reason why it failed
  const step = async (name, run) => {
    const t0 = Date.now();
    let result;
    try {
      result = await run();
    } catch (e) {
      result = `error ${errText(e)}`;
    }
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    if (result === true) {
      passed.push(name);
      testLog(`STEP ok ${name} (${took}s)`);
      return true;
    }
    failed.push(name);
    testLog(`STEP FAILED ${name} (${took}s): ${result} ${JSON.stringify(lastState)}`);
    return false;
  };
  // steps that need the one before: after a failure the rest are logged as skipped
  const chain = async steps => {
    let ok = true;
    for (const [name, run] of steps) {
      if (finished) {
        return false;
      }
      if (ok) {
        ok = await step(name, run);
      } else {
        testLog(`STEP skipped ${name}`);
      }
    }
    return ok;
  };

  const toBattle = [
    [
      "load",
      async () => {
        const ok = await waitFor(
          s => selfTestPhases.length > 0 && s.mode !== "",
          Number(process.env.POKEROGUE_SELFTEST_WAIT || 90000),
        );
        testLog(`probe ${JSON.stringify(await probe())}`);
        await snap("loaded");
        return ok || "the game did not start (no phase or UI mode)";
      },
    ],
    [
      "title",
      async () => {
        // A through the gender question of a fresh save (and anything else before the title menu)
        if (!(await pressUntil(s => s.mode === "TITLE" && s.phase === "TitlePhase", () => "Space", 60000, 1500))) {
          return "no title menu";
        }
        await wait(1500);
        await snap("title");
        return true;
      },
    ],
    [
      "game-mode",
      async () => {
        // the fresh save has no run, so the title's first entry is 새로운 게임
        if ((await state()).mode === "TITLE") {
          await press("Space", 300);
        }
        if (!(await waitFor(isMode("OPTION_SELECT"), 10000))) {
          return "no game mode list";
        }
        await wait(800);
        await snap("game-mode");
        return true;
      },
    ],
    [
      "starter-select",
      async () => {
        await press("Space", 300); // 클래식, the first mode
        if (!(await waitFor(s => s.phase === "SelectStarterPhase" && s.mode === "STARTER_SELECT", 30000))) {
          return "no starter select";
        }
        await wait(2000);
        await snap("starter-select");
        return true;
      },
    ],
    [
      "starter",
      async () => {
        // the grid's cursor starts on the first starter: A opens its menu, A again is 파티에 추가, Enter starts
        for (let attempt = 1; attempt <= 3; attempt++) {
          await press("Space", 300);
          if (await waitFor(isMode("OPTION_SELECT"), 5000)) {
            if (attempt === 1) {
              await snap("starter-menu");
            }
            await press("Space", 300);
            await waitFor(isMode("STARTER_SELECT"), 5000);
            await wait(500);
            await press("Enter", 300);
            if (await waitFor(isMode("CONFIRM"), 8000)) {
              await wait(500);
              await snap("start-confirm");
              return true;
            }
          }
          testLog(`starter attempt ${attempt} did not reach the confirmation ${JSON.stringify(lastState)}`);
          await pressUntil(isMode("STARTER_SELECT"), () => "Backspace", 5000, 800);
        }
        return "the starter could not be added and confirmed";
      },
    ],
    [
      "start-run",
      async () => {
        await press("Space", 300); // 예
        // then the save slot of the new run: the first one, empty in the fresh save (a used one would ask first)
        if (!(await waitFor(isMode("SAVE_SLOT"), 10000))) {
          return "no save slot list";
        }
        await wait(800);
        await snap("save-slot");
        await press("Space", 800);
        if ((await state()).mode === "CONFIRM") {
          await press("Space", 300);
        }
        return (
          (await waitFor(s => s.phase !== "" && s.phase !== "SelectStarterPhase", 30000)) || "the run did not start"
        );
      },
    ],
    [
      "battle",
      async () => {
        // A through the encounter's messages to the command menu, B out of any menu a press opened on the way
        const backOut = ["FIGHT", "BALL", "PARTY", "SUMMARY", "TARGET_SELECT"];
        const atCommand = s => s.mode === "COMMAND" && s.phase === "CommandPhase";
        if (!(await pressUntil(atCommand, s => (backOut.includes(s.mode) ? "Backspace" : "Space"), 120000, 1300))) {
          return "no command menu";
        }
        await wait(2500); // the info boxes slide in
        if (!(await waitFor(atCommand, 3000))) {
          return "the command menu did not stay";
        }
        await snap("battle");
        testLog(`battle ${JSON.stringify(await gameInfo())}`);
        return true;
      },
    ],
  ];
  // 포켓몬 -> the first Pokémon -> 도감 -> its marks (the 11-17 mark list of the Pokédex page)
  const partyMarks = [
    [
      "party",
      async () => {
        await press("Down", 400); // 포켓몬, below 싸운다 where the cursor starts
        await press("Space", 300);
        if (!(await waitFor(isMode("PARTY"), 8000))) {
          return "no party screen";
        }
        await wait(1200);
        await snap("party");
        return true;
      },
    ],
    [
      "party-dex",
      async () => {
        await press("Space", 900); // the active Pokémon's options: 요약, 도감, ... (party-ui-handler.ts)
        await snap("party-options");
        await press("Down", 400);
        await press("Space", 300);
        if (!(await waitFor(isMode("POKEDEX_PAGE"), 10000))) {
          return "no Pokédex page";
        }
        await wait(2000);
        await snap("dex-page");
        return true;
      },
    ],
    [
      "dex-marks",
      async () => {
        // the marks are the page menu's last option (MenuOptions.MARKS); Up from the first one wraps to it
        await press("Up", 600);
        await press("Space", 1500);
        if ((await state()).mode !== "POKEDEX_PAGE") {
          return "the Pokédex page closed";
        }
        await snap("dex-marks");
        return true;
      },
    ],
  ];
  // the menu's 증표도감 (MARK_DEX): its list, then A for the first mark's lines
  const markDex = [
    [
      "menu",
      async () => {
        await press("Escape", 300);
        if (!(await waitFor(isMode("MENU"), 8000))) {
          return "no menu";
        }
        await wait(800);
        await snap("menu");
        return true;
      },
    ],
    [
      "mark-dex",
      async () => {
        // 증표도감 is the menu's 7th entry (MenuOptions.MARK_DEX in menu-ui-handler.ts; nothing above it is
        // left out in a battle)
        for (let i = 0; i < 6; i++) {
          await press("Down", 250);
        }
        await press("Space", 300);
        if (!(await waitFor(isMode("MARK_DEX"), 8000))) {
          return "no 증표도감";
        }
        await wait(1500);
        await snap("mark-dex");
        await press("Space", 1500);
        if ((await state()).mode !== "MARK_DEX") {
          return "the 증표도감 closed";
        }
        await snap("mark-dex-lines");
        return true;
      },
    ],
  ];
  const backFromMarks = [["back-to-battle", backToCommand]];
  const backFromMarkDex = [["back-to-battle-2", backToCommand]];
  totalSteps = [toBattle, partyMarks, backFromMarks, markDex, backFromMarkDex].reduce((n, s) => n + s.length, 0);

  try {
    wc.once("did-finish-load", () => testLog("did-finish-load"));
    wc.once("dom-ready", () => {
      const flags = JSON.stringify(Object.fromEntries(SELFTEST_TUTORIALS.map(t => [t, true])));
      wc.executeJavaScript(
        `(() => { if (!localStorage.getItem("tutorials")) { localStorage.setItem("tutorials", ${JSON.stringify(flags)}); } return localStorage.getItem("tutorials"); })()`,
      )
        .then(v => testLog(`tutorials ${v}`))
        .catch(e => testLog(`tutorials not set: ${errText(e)}`));
    });
    if (await chain(toBattle)) {
      await chain(partyMarks);
      await chain(backFromMarks);
      await chain(markDex);
      await chain(backFromMarkDex);
    } else {
      for (const [name] of [...partyMarks, ...backFromMarks, ...markDex, ...backFromMarkDex]) {
        testLog(`STEP skipped ${name}`);
      }
    }
  } catch (e) {
    testLog(`SELFTEST ERROR ${e && e.stack ? e.stack : e}`);
  } finally {
    await finish();
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
