// PokeRogue Offline: automatic save backup at startup (AGPL-3.0-only).
// 2026-11-19 (1.2.0, B3): the save lives only in <userData>/Local Storage/leveldb (the game's localStorage), so a
// changed save field or a crash that breaks it could not be undone. main.js calls backupSaves() once per start,
// before the game window exists (the single-instance lock is held, never in the self-test), and it copies that
// folder to <userData>/save-backups/<YYYYMMDD-HHMMSS>/leveldb. The 10 newest such folders are kept.
// For players userData is %APPDATA%\PokeRogue Offline. To restore (as the readme, docs/읽어주세요.txt, says): close the
// game, delete or rename %APPDATA%\PokeRogue Offline\Local Storage\leveldb, then copy the backup's leveldb folder into
// Local Storage. Never copy it over the current folder: LevelDB would also replay the newer .log files left there.
// (Review 2026-11-19: backup at whenReady and this restore checked with the real Electron 45 on a throwaway profile.)
// No Electron import here, so a plain node script can test it against temp folders.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BACKUP_DIR_NAME = "save-backups";
const KEEP_DEFAULT = 10;
// the backup folders this module creates and may delete; nothing else inside save-backups is ever touched
const STAMP_RE = /^\d{8}-\d{6}$/;
// a backup is written under <stamp>.partial and renamed when complete, so a cut-short copy never looks like a backup
const PARTIAL_RE = /^\d{8}-\d{6}\.partial$/;
// LevelDB's lock file: empty, held by the running game, and recreated by LevelDB when missing
const SKIP_FILES = new Set(["LOCK"]);
const LOG_NAME = "backup-log.txt";
const LOG_MAX_BYTES = 256 * 1024;

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Local time as YYYYMMDD-HHMMSS (the folder name players see). */
function stampOf(date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      files += copyDir(from, to);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      fs.copyFileSync(from, to);
      files++;
    }
  }
  return files;
}

/**
 * Delete the oldest backup folders so at most `keep` remain, never the one just made (`fresh`, so a clock set back
 * cannot delete the new backup at once) and never anything whose name is not a backup stamp. Leftover
 * `<stamp>.partial` folders (a copy cut short by a crash) go too.
 */
function pruneBackups(backupRoot, keep, fresh, log) {
  const removed = [];
  const names = fs.readdirSync(backupRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  const older = names
    .filter(n => STAMP_RE.test(n) && n !== fresh)
    .sort()
    .reverse();
  const doomed = [...older.slice(Math.max(keep - 1, 0)), ...names.filter(n => PARTIAL_RE.test(n))];
  for (const name of doomed) {
    try {
      fs.rmSync(path.join(backupRoot, name), { recursive: true, force: true });
      removed.push(name);
    } catch (e) {
      log(`could not remove old backup ${name}: ${e && e.message ? e.message : e}`);
    }
  }
  return removed;
}

function makeLogger(backupRoot, extraLog) {
  return line => {
    const text = `${new Date().toISOString()} ${line}`;
    try {
      extraLog?.(text);
    } catch {
      // logging must never stop the game
    }
    try {
      const file = path.join(backupRoot, LOG_NAME);
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        // no log yet
      }
      // kept small: started again once it reaches LOG_MAX_BYTES
      fs.mkdirSync(backupRoot, { recursive: true });
      if (size > LOG_MAX_BYTES) {
        fs.writeFileSync(file, `${text}\n`, "utf8");
      } else {
        fs.appendFileSync(file, `${text}\n`, "utf8");
      }
    } catch {
      // logging must never stop the game
    }
  };
}

/**
 * Copy <userData>/Local Storage/leveldb to <userData>/save-backups/<stamp>/leveldb and keep the `keep` newest
 * backups. Never throws: any error is logged (save-backups/backup-log.txt and `options.log`) and startup goes on.
 * @param {string} userDataDir app.getPath("userData")
 * @param {{keep?: number, now?: Date, log?: (line: string) => void}} [options]
 * @returns {{status: "done" | "no-save" | "exists" | "error", dir?: string, files?: number, removed?: string[], error?: string}}
 */
function backupSaves(userDataDir, options = {}) {
  const keep = options.keep ?? KEEP_DEFAULT;
  const backupRoot = path.join(userDataDir, BACKUP_DIR_NAME);
  const log = makeLogger(backupRoot, options.log);
  let partial = "";
  try {
    const source = path.join(userDataDir, "Local Storage", "leveldb");
    let isDir = false;
    try {
      isDir = fs.statSync(source).isDirectory();
    } catch {
      // first start: nothing saved yet
    }
    if (!isDir) {
      return { status: "no-save" };
    }
    const stamp = stampOf(options.now ?? new Date());
    const finalDir = path.join(backupRoot, stamp);
    if (fs.existsSync(finalDir)) {
      // a backup from this very second already exists
      return { status: "exists", dir: finalDir };
    }
    partial = path.join(backupRoot, `${stamp}.partial`);
    fs.rmSync(partial, { recursive: true, force: true });
    const files = copyDir(source, path.join(partial, "leveldb"));
    fs.renameSync(partial, finalDir);
    partial = "";
    const removed = pruneBackups(backupRoot, keep, stamp, log);
    log(`backup ${stamp}: ${files} files${removed.length > 0 ? `, removed ${removed.join(" ")}` : ""}`);
    return { status: "done", dir: finalDir, files, removed };
  } catch (e) {
    const error = e && e.message ? e.message : String(e);
    log(`backup failed: ${error}`);
    if (partial) {
      try {
        fs.rmSync(partial, { recursive: true, force: true });
      } catch {
        // pruneBackups removes it on a later start
      }
    }
    return { status: "error", error };
  }
}

module.exports = { backupSaves, stampOf, BACKUP_DIR_NAME, STAMP_RE };
