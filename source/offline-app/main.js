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

/*
 * Local fork (2026-11-18): the self-test's second part, the "seeded save" (the user: "작은 정리부터"; so nobody has to
 * look at the new mark and achievement screens by hand). The fresh save of the first part has no marks, so those
 * screens only show greyed-out icons; the second part writes the marks and achievements below into the save the run
 * has just made, reloads the page and goes on with 계속하기 (the title's continue).
 *
 * The offline build has VITE_BYPASS_LOGIN=1 (pokerogue/.env.app), so the player is "Guest" (account.ts) and the save is
 * not AES: encrypt()/decrypt() of src/utils/data.ts are btoa(encodeURIComponent(json)) and back. The system data is
 * `data_Guest` (GameData.saveSystem, long key names), the run in slot 0 is `sessionData_Guest`
 * (getSessionDataLocalStorageKey). The numbers are PokemonMark (src/enums/pokemon-mark.ts), the ids the keys of
 * `achvs` (src/system/achv.ts).
 */
/** The marks a complete line collection needs: orderedPokemonMarks but COMPLETION_EXEMPT_MARKS (pokemon-marks.ts) */
const SELFTEST_LISTED_MARKS = [
  // ribbons 1-8 and 10-19 (9 and 20-28 are hidden)
  ...[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  // the 41 wild marks, LUNCHTIME_MARK 100 to SLUMP_MARK 140
  ...Array.from({ length: 41 }, (_, i) => 100 + i),
  // alpha 200, golden alpha 201, jumbo 202, mini 203, partner 204, the shiny 206 / rare shiny 207, egg moves 209,
  // perfect IV 210, Master Ball 211 (205 Mightiest, 208 epic shiny and 212-214 are hidden)
  ...[200, 201, 202, 203, 204, 206, 207, 209, 210, 211],
];
/**
 * The hidden ones the seed gives (8 of the 15): Once-in-a-Lifetime 9, Endless Master 20, Ability 21, Great Ability 22,
 * Hisui 27, Destiny 212, Gourmand 213, Itemfinder 214. Left out, so the hidden page shows both kinds: Mightiest 205,
 * epic shiny 208, Master Rank 28, Double / Multi / Pair / World Ability 23-26 and the Eternatus Mark.
 */
const SELFTEST_HIDDEN_MARKS = [9, 20, 21, 22, 27, 212, 213, 214];
const SELFTEST_SEED = {
  systemKey: "data_Guest",
  sessionKey: "sessionData_Guest",
  // the session's party[0] (PokemonData.marks / equippedMark / alphaBoost): champion and Ability ribbons, the alpha
  // marks, the Partner Mark, the three new hidden marks and a wild mark, wearing the Great Ability Ribbon, whose title
  // "1000웨이브를 돌파한" is the longest there is (so the battle info's room for title + name + alpha badge is tested)
  leadMarks: [22, 21, 3, 10, 200, 201, 202, 204, 212, 213, 214, 128],
  leadEquippedMark: 22,
  leadAlphaBoost: 20,
  // the wild enemy's (enemyParty[0]): the Charismatic Mark and the Mini Mark, both shown as icons in its info box
  enemyMarks: [117, 203],
  // starterData[<the lead's species>]: every listed mark (the golden outline, isMarkCollectionComplete) and the
  // hidden ones above, and an alpha boost of 20 (the alpha option of starter select)
  lineMarks: [...SELFTEST_LISTED_MARKS, ...SELFTEST_HIDDEN_MARKS],
  lineAlphaBoost: 20,
  // two more lines with a few marks, so the mark Pokédex counts more than one line
  otherLineMarks: { 4: [1, 104, 113, 200, 206], 7: [2, 105, 117, 203, 212] },
  // GameData.markCounts: every listed mark (so the mark Pokédex scrolls down to its hidden page) and the hidden ones
  markCounts: Object.fromEntries([
    ...SELFTEST_LISTED_MARKS.map(m => [m, m === 200 || m === 202 ? 12 : m === 201 ? 3 : 1 + (m % 5)]),
    ...SELFTEST_HIDDEN_MARKS.map(m => [m, m === 212 ? 2 : 1]),
  ]),
  // GameData.achvUnlocks (id -> time): mark achievements and 8 of the 19 Pokédex collection achievements of 11-18;
  // DAWN_AND_DUSK, TIME_SPACE_ANTIMATTER, SEA_AND_LAND, PAST_AND_FUTURE, LIFE_AND_DEATH, RUINOUS_BEASTS,
  // SWORDS_OF_JUSTICE, GUARDIAN_DEITIES, SWORD_AND_SHIELD, ALL_SUB_LEGENDARY and ALL_LEGENDARY stay locked
  achvUnlocks: [
    "MARKS_10",
    "ALPHA_MARKS_10",
    "GOLDEN_ALPHA_MARK",
    "MEMORIAL_RIBBON",
    "MARK_DEX_ONE",
    "EFFORT_RIBBON",
    "HIDDEN_MARK",
    "ANCIENT_GIANTS",
    "SKY_DRAGON",
    "ULTRA_BEASTS",
    "LEGENDARY_BIRDS",
    "LEGENDARY_BEASTS",
    "LAKE_GUARDIANS",
    "TRUTH_AND_IDEALS",
    "ALL_MYTHICAL",
  ],
};

/**
 * Local fork (2026-11-18): runs in the page (executeJavaScript, passed as its source): decode the save the way the
 * offline build does, write {@linkcode SELFTEST_SEED} into it, encode it back and read it again to check.
 * @returns What it wrote, or `{ error }`
 */
function selfTestSeedSave(seed) {
  const decode = s => JSON.parse(decodeURIComponent(atob(s)));
  const encode = o => btoa(encodeURIComponent(JSON.stringify(o)));
  const systemRaw = localStorage.getItem(seed.systemKey);
  const sessionRaw = localStorage.getItem(seed.sessionKey);
  if (!systemRaw || !sessionRaw) {
    return { error: `no ${systemRaw ? seed.sessionKey : seed.systemKey}`, keys: Object.keys(localStorage) };
  }
  const system = decode(systemRaw);
  const session = decode(sessionRaw);
  const lead = session.party && session.party[0];
  const enemy = session.enemyParty && session.enemyParty[0];
  if (!lead || !enemy) {
    return { error: "no party or enemy in the session" };
  }
  // the lead is the starter itself (Lv. 5, not evolved), so its species is its line's root
  const root = String(lead.species);
  const entry = system.starterData && system.starterData[root];
  if (!entry) {
    return { error: `no starterData for ${root}` };
  }
  lead.marks = seed.leadMarks;
  lead.equippedMark = seed.leadEquippedMark;
  lead.alphaBoost = seed.leadAlphaBoost;
  enemy.marks = seed.enemyMarks;
  entry.marks = seed.lineMarks;
  entry.alphaBoost = seed.lineAlphaBoost;
  for (const [id, marks] of Object.entries(seed.otherLineMarks)) {
    if (system.starterData[id]) {
      system.starterData[id].marks = marks;
    }
  }
  system.markCounts = Object.assign(system.markCounts || {}, seed.markCounts);
  system.achvUnlocks = system.achvUnlocks || {};
  const now = Date.now();
  seed.achvUnlocks.forEach((id, i) => {
    system.achvUnlocks[id] = now - i * 3600000;
  });
  localStorage.setItem(seed.systemKey, encode(system));
  localStorage.setItem(seed.sessionKey, encode(session));
  const systemBack = decode(localStorage.getItem(seed.systemKey));
  const sessionBack = decode(localStorage.getItem(seed.sessionKey));
  return {
    root,
    wave: sessionBack.waveIndex,
    enemySpecies: sessionBack.enemyParty[0].species,
    leadMarks: sessionBack.party[0].marks,
    leadEquippedMark: sessionBack.party[0].equippedMark,
    leadAlphaBoost: sessionBack.party[0].alphaBoost,
    enemyMarks: sessionBack.enemyParty[0].marks,
    lineMarks: systemBack.starterData[root].marks.length,
    lineAlphaBoost: systemBack.starterData[root].alphaBoost,
    markCounts: Object.keys(systemBack.markCounts).length,
    achvUnlocks: Object.keys(systemBack.achvUnlocks),
  };
}

/**
 * Local fork (2026-11-18): the self-test run. On the fresh save it presses the keyboard like a player: through the
 * gender question to the title, 새로운 게임 -> 클래식, adds the first starter and starts, presses A through the
 * encounter to the command menu, then opens 포켓몬 -> the first Pokémon -> 도감 -> its marks (the 11-17 Pokédex page
 * mark list), and the menu's 증표도감 (UiMode.MARK_DEX) with its second view. Every step waits on what the game
 * shows (the UI mode ui.ts writes into #touchControls' data-ui-mode, also on desktop, and the logged phase) with a
 * timeout, and logs "STEP ok <name>" or "STEP FAILED <name>: <why> <state>"; the last lines are
 * "RESULT PASS|FAILED steps=<ok>/<all> battle=0|1 shots=<n> ..." and the list of shots. Screenshots are numbered
 * PNGs in the test folder (01-loaded.png ... 15-mark-dex-lines.png). selftest.sh reads the log.
 * Local fork (2026-11-18): then the second part, the seeded save (SELFTEST_SEED): it writes marks, a worn mark, an
 * alpha boost and achievements into the run's save, reloads, 계속하기 back to the battle (its alpha boost must raise
 * the lead's stats), and shoots the battle, the party, the Pokédex page's marks, the 증표도감 and its hidden page, the
 * achievements (scrolled to the new ones) and, after 저장하고 나가기, starter select (gold outline, alpha option):
 * 16-seeded-title.png ... 30-seeded-starter-menu.png (the two message shots only if caught), 25 steps in all; it
 * runs whenever the first part reached the battle.
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
  // Local fork (2026-11-18): returns the PNG (null if skipped), so a step can tell whether a key changed the screen
  const snap = async name => {
    shotNumber++;
    const file = `${String(shotNumber).padStart(2, "0")}-${name}.png`;
    try {
      const image = await withTimeout(wc.capturePage(), 10000, "capture");
      if (image.isEmpty()) {
        throw new Error("empty image");
      }
      const png = image.toPNG();
      fs.writeFileSync(path.join(selfTestDir, file), png);
      shots.push(file);
      testLog(`shot ${file} ${JSON.stringify(await state())}`);
      return png;
    } catch (e) {
      testLog(`shot skipped ${name}: ${errText(e)}`);
      return null;
    }
  };
  const sameShot = (a, b) => !!a && !!b && a.equals(b);
  // Local fork (2026-11-18): the lead's stats from window.gameInfo (refreshed at every command phase), to see that the
  // seeded alpha boost (+20 %) was loaded with the run
  const leadStats = () =>
    withTimeout(
      wc.executeJavaScript(
        `(() => { const p = window.gameInfo?.party?.[0]; return p ? { name: p.name, level: p.level, stats: p.baseStats } : null; })()`,
      ),
      5000,
      "lead stats",
    ).catch(() => null);
  const statSum = info => (info && info.stats ? Object.values(info.stats).reduce((n, v) => n + Number(v || 0), 0) : 0);
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
  // the whole run stays under selftest.sh's limit, so it always ends with its RESULT line
  // Local fork (2026-11-18): 480 s (was 270 s) for the second part, the seeded save; selftest.sh stops at 540 s
  const watchdog = setTimeout(() => finish("watchdog"), Number(process.env.POKEROGUE_SELFTEST_TIMEOUT || 480000));
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

  // ---- Local fork (2026-11-18): the second part, the seeded save (SELFTEST_SEED, see there) ----
  let statsBefore = null;
  let markDexShot = null;
  // the menu from the command menu, opened fresh so its cursor is on its first entry (MenuOptions in
  // menu-ui-handler.ts: 0 게임 설정, 1 업적, ... 6 증표도감, ... 9 저장하고 나가기; 로그아웃 is left out offline)
  const openMenuEntry = async (index, mode) => {
    const back = await backToCommand();
    if (back !== true) {
      return back;
    }
    await press("Escape", 300);
    if (!(await waitFor(isMode("MENU"), 8000))) {
      return "no menu";
    }
    await wait(800);
    for (let i = 0; i < index; i++) {
      await press("Down", 250);
    }
    await press("Space", 300);
    return mode === null || (await waitFor(isMode(mode), 10000)) || `no ${mode}`;
  };
  // write the seed, reload, 계속하기 back to the battle
  const seededSave = [
    [
      "seed-save",
      async () => {
        statsBefore = await leadStats();
        if (!statsBefore) {
          return "no lead stats to compare with (window.gameInfo)";
        }
        const result = await withTimeout(
          wc.executeJavaScript(`(${selfTestSeedSave.toString()})(${JSON.stringify(SELFTEST_SEED)})`),
          10000,
          "seed",
        );
        testLog(`seed ${JSON.stringify(result)}`);
        testLog(`seed lead before ${JSON.stringify(statsBefore)}`);
        if (!result || result.error) {
          return `the save could not be seeded: ${result ? result.error : "no answer"}`;
        }
        // the page starts again from the seeded save; the phases are waited on afresh
        selfTestPhase = "";
        wc.reload();
        return true;
      },
    ],
    [
      "seeded-title",
      async () => {
        // a save with a gender and a run: no question before the title, and its first entry is 계속하기
        if (!(await waitFor(s => s.mode === "TITLE" && s.phase === "TitlePhase", 90000))) {
          return "no title menu after the reload";
        }
        // 2026-11-18: about 3 s after the title appears, as in "title" (its key presses come 1.5 s apart, then 1.5 s):
        // at 1.6 s the screen transition's black bars were still in the shot
        await wait(3000);
        await snap("seeded-title");
        return true;
      },
    ],
    [
      "seeded-battle",
      async () => {
        await press("Space", 800); // 계속하기
        if ((await state()).mode === "OPTION_SELECT") {
          return "the title had no 계속하기 (the seeded session did not load)";
        }
        // A through the reloaded wave's messages to the command menu, as in "battle", with a shot of the messages
        // that name the enemy and the lead by their titles (encounter-phase.ts, summon-phase.ts: getTitledName); not
        // steps of their own, since a message can be gone before it is caught
        const backOut = ["FIGHT", "BALL", "PARTY", "SUMMARY", "TARGET_SELECT"];
        const atCommand = s => s.mode === "COMMAND" && s.phase === "CommandPhase";
        const end = Date.now() + 120000;
        let lastSeen = "";
        let encounterShot = false;
        let summonShot = false;
        for (;;) {
          lastState = await state();
          const seen = `${lastState.mode}/${lastState.phase}`;
          if (seen !== lastSeen) {
            testLog(`seeded battle ${seen}`);
            lastSeen = seen;
          }
          if (atCommand(lastState)) {
            break;
          }
          if (Date.now() >= end) {
            return "no command menu after 계속하기";
          }
          if (!encounterShot && lastState.mode === "MESSAGE" && lastState.phase === "EncounterPhase") {
            // the encounter's message waits for A; time for it to be typed out
            encounterShot = true;
            await wait(1200);
            await snap("seeded-encounter-message");
          } else if (!summonShot && lastState.mode === "MESSAGE" && lastState.phase === "SummonPhase") {
            // the sending out's goes on by itself within a second or so: at once, and no A
            summonShot = true;
            await wait(400);
            await snap("seeded-summon-message");
            continue;
          }
          await press(backOut.includes(lastState.mode) ? "Backspace" : "Space", 100);
          // the 1.3 s between presses, watched closely so the short sending-out message is not missed
          const next = Date.now() + 1200;
          while (Date.now() < next) {
            const s = await state();
            if (atCommand(s) || (!summonShot && s.mode === "MESSAGE" && s.phase === "SummonPhase")) {
              break;
            }
            await wait(120);
          }
        }
        await wait(2500); // the info boxes slide in
        if (!(await waitFor(atCommand, 3000))) {
          return "the command menu did not stay";
        }
        await snap("seeded-battle");
        const statsAfter = await leadStats();
        testLog(`seeded battle ${JSON.stringify(await gameInfo())} lead ${JSON.stringify(statsAfter)}`);
        // the alpha boost (+20 %) of the seeded lead raises its stats: the seeded session is the one that was loaded
        if (statSum(statsAfter) <= statSum(statsBefore)) {
          return `the lead's stats did not rise with the seeded alpha boost (${statSum(statsBefore)} -> ${statSum(statsAfter)})`;
        }
        return true;
      },
    ],
  ];
  // the party, and the lead's Pokédex page with its marks (the worn one framed, gold outlines, the hidden ones)
  const seededPartyMarks = [
    [
      "seeded-party",
      async () => {
        await press("Down", 400); // 포켓몬
        await press("Space", 300);
        if (!(await waitFor(isMode("PARTY"), 8000))) {
          return "no party screen";
        }
        await wait(1200);
        await snap("seeded-party");
        return true;
      },
    ],
    [
      "seeded-dex-marks",
      async () => {
        await press("Space", 900);
        await press("Down", 400); // 도감
        await press("Space", 300);
        if (!(await waitFor(isMode("POKEDEX_PAGE"), 10000))) {
          return "no Pokédex page";
        }
        await wait(2000);
        await press("Up", 600); // the marks, the page menu's last option
        await press("Space", 1500);
        if ((await state()).mode !== "POKEDEX_PAGE") {
          return "the Pokédex page closed";
        }
        const tray = await snap("seeded-dex-marks");
        // the tray's cursor (ten to a row) starts on the worn mark, the Great Ability Ribbon (13th in
        // orderedPokemonMarks); three rows down and two left is the Destiny Mark (41st), for its description
        for (const key of ["Down", "Down", "Down", "Left", "Left"]) {
          await press(key, 300);
        }
        await wait(500);
        const destiny = await snap("seeded-dex-marks-destiny");
        if (sameShot(tray, destiny)) {
          return "the mark tray's cursor did not move";
        }
        return true;
      },
    ],
  ];
  const seededBackFromMarks = [["seeded-back-to-battle", backToCommand]];
  // the 증표도감 with every listed mark obtained, its hidden page, and the achievements
  const seededMenu = [
    [
      "seeded-mark-dex",
      async () => {
        const opened = await openMenuEntry(6, "MARK_DEX");
        if (opened !== true) {
          return opened;
        }
        await wait(1500);
        markDexShot = await snap("seeded-mark-dex");
        return true;
      },
    ],
    [
      "seeded-mark-dex-hidden",
      async () => {
        // 69 listed marks, 14 to a row: four rows down to the last, one more onto the hidden page (it scrolls there
        // once every listed mark has been obtained, mark-dex-ui-handler.ts)
        for (let i = 0; i < 5; i++) {
          await press("Down", 400);
        }
        await wait(800);
        if ((await state()).mode !== "MARK_DEX") {
          return "the 증표도감 closed";
        }
        const hidden = await snap("seeded-mark-dex-hidden");
        if (sameShot(markDexShot, hidden)) {
          return "the 증표도감 did not scroll to its hidden page";
        }
        // the cursor from the Once-in-a-Lifetime Ribbon to the Destiny Mark, the fourth of the first row
        for (let i = 0; i < 3; i++) {
          await press("Right", 300);
        }
        await wait(500);
        await snap("seeded-mark-dex-hidden-destiny");
        return true;
      },
    ],
    [
      "seeded-achievements",
      async () => {
        const opened = await openMenuEntry(1, "ACHIEVEMENTS");
        if (opened !== true) {
          return opened;
        }
        await wait(1200);
        const first = await snap("seeded-achievements-top");
        // 112 achievements, 18 to a row, 4 rows shown: Up from the first wraps to the last four rows (54-111), the
        // cursor on ALL_MYTHICAL (108); Up and Right twice is ANCIENT_GIANTS (92, unlocked by the seed), one more
        // Right DAWN_AND_DUSK (93, left locked)
        await press("Up", 400);
        await press("Up", 400);
        await press("Right", 400);
        await press("Right", 400);
        await wait(600);
        if ((await state()).mode !== "ACHIEVEMENTS") {
          return "the achievements closed";
        }
        const unlocked = await snap("seeded-achievements-new");
        await press("Right", 400);
        await wait(600);
        const locked = await snap("seeded-achievements-locked");
        if (sameShot(first, unlocked) || sameShot(unlocked, locked)) {
          return "the achievements did not scroll or the cursor did not move";
        }
        return true;
      },
    ],
  ];
  // 저장하고 나가기 to the title, then 새로운 게임 -> 클래식 -> starter select: the lead's line with its gold outline and
  // the alpha option in its menu
  const seededStarter = [
    [
      "seeded-save-quit",
      async () => {
        const opened = await openMenuEntry(9, null);
        if (opened !== true) {
          return opened;
        }
        // straight out on the first turn; later a warning and a 예 / 아니오 (menu-ui-handler.ts)
        const end = Date.now() + 40000;
        for (;;) {
          lastState = await state();
          if (lastState.mode === "TITLE" && lastState.phase === "TitlePhase") {
            break;
          }
          if (Date.now() >= end) {
            return "no title after 저장하고 나가기";
          }
          if (lastState.mode === "CONFIRM") {
            await press("Space", 800);
          } else {
            await wait(500);
          }
        }
        await wait(1500);
        return true;
      },
    ],
    [
      "seeded-starter-select",
      async () => {
        await press("Down", 400); // 새 게임, below 계속하기
        await press("Space", 300);
        if (!(await waitFor(isMode("OPTION_SELECT"), 10000))) {
          return "no game mode list";
        }
        await wait(800);
        await press("Space", 300); // 클래식
        if (!(await waitFor(s => s.phase === "SelectStarterPhase" && s.mode === "STARTER_SELECT", 30000))) {
          return "no starter select";
        }
        await wait(2000);
        await snap("seeded-starter-select");
        await press("Space", 300); // the first starter's menu, with 우두머리로 데려가기 for the seeded alpha boost
        if (!(await waitFor(isMode("OPTION_SELECT"), 5000))) {
          return "no starter menu";
        }
        await wait(900);
        await snap("seeded-starter-menu");
        return true;
      },
    ],
  ];
  const seededParts = [seededSave, seededPartyMarks, seededBackFromMarks, seededMenu, seededStarter];
  totalSteps = [toBattle, partyMarks, backFromMarks, markDex, backFromMarkDex, ...seededParts].reduce(
    (n, s) => n + s.length,
    0,
  );

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
      // Local fork (2026-11-18): the seeded save needs only the run's save, so it runs even if a mark screen failed
      testLog("second part: the seeded save");
      if (await chain(seededSave)) {
        await chain(seededPartyMarks);
        await chain(seededBackFromMarks);
        await chain(seededMenu);
        await chain(seededStarter);
      } else {
        for (const [name] of seededParts.slice(1).flat()) {
          testLog(`STEP skipped ${name}`);
        }
      }
    } else {
      for (const [name] of [...partyMarks, ...backFromMarks, ...markDex, ...backFromMarkDex, ...seededParts.flat()]) {
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
