/*
 * Dev Bridge (server half). Local development only.
 *
 * Lets a shell drive the running game, the way the Essentials project's Dev Bridge does:
 * the game polls this plugin for JavaScript commands, runs them in the page and posts the
 * results back; the plugin also keeps a log, the latest state dump, screenshots and a
 * status line in the Bridge folder next to the repository. `Bridge/bridge.sh` is the client.
 *
 * Only `vite serve` loads this plugin, so nothing here reaches a build.
 */

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin as VitePlugin } from "vite";

const NAME = "dev-bridge-plugin";

/** A command queued for the game, with the promise the HTTP caller is waiting on. */
interface PendingCommand {
  id: number;
  js: string;
  logLineAtStart: number;
  resolve: (value: CommandResult) => void;
  dispatched: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface CommandResult {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Log lines written while the command ran */
  log: string[];
  timedOut?: boolean;
}

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const LOG_RING_SIZE = 2000;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Keep screenshot names to something safe for the file system */
function safeName(name: unknown, fallback: string): string {
  const str = typeof name === "string" && name.trim() ? name.trim() : fallback;
  return str.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80);
}

export function devBridgePlugin(): VitePlugin {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const bridgeDir = process.env.DEV_BRIDGE_DIR
    ? path.resolve(process.env.DEV_BRIDGE_DIR)
    : path.resolve(repoRoot, "..", "Bridge");
  const shotsDir = path.join(bridgeDir, "shots");
  const logPath = path.join(bridgeDir, "log.txt");
  const statePath = path.join(bridgeDir, "state.json");
  const statusPath = path.join(bridgeDir, "status.json");
  const livePath = path.join(bridgeDir, "live.png");

  let nextId = 1;
  const pending = new Map<number, PendingCommand>();
  const logRing: string[] = [];
  let logLineCount = 0;
  let lastPollAt = 0;
  let clientStatus: Record<string, unknown> = {};

  function ensureDirs(): void {
    fs.mkdirSync(shotsDir, { recursive: true });
  }

  function appendLog(lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    const stamped = lines.map(line => `${timestamp()} ${line}`);
    for (const line of stamped) {
      logRing.push(line);
      if (logRing.length > LOG_RING_SIZE) {
        logRing.shift();
      }
    }
    logLineCount += stamped.length;
    fs.appendFileSync(logPath, `${stamped.join("\n")}\n`, "utf8");
  }

  function logSince(count: number): string[] {
    const missing = logLineCount - count;
    if (missing <= 0) {
      return [];
    }
    return logRing.slice(Math.max(0, logRing.length - missing));
  }

  function writeStatus(): void {
    const status = {
      ...clientStatus,
      serverTime: Date.now(),
      lastPollAgoMs: lastPollAt ? Date.now() - lastPollAt : null,
      queued: [...pending.values()].filter(c => !c.dispatched).length,
      running: [...pending.values()].filter(c => c.dispatched).length,
      logLines: logLineCount,
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
  }

  function enqueue(js: string, timeoutMs: number): Promise<CommandResult> {
    return new Promise(resolve => {
      const id = nextId++;
      const command: PendingCommand = {
        id,
        js,
        logLineAtStart: logLineCount,
        resolve,
        dispatched: false,
        timer: setTimeout(() => {
          const stillPending = pending.get(id);
          if (!stillPending) {
            return;
          }
          pending.delete(id);
          resolve({
            id,
            ok: false,
            error: stillPending.dispatched
              ? `timeout after ${timeoutMs} ms: the game took the command but has not answered`
              : `timeout after ${timeoutMs} ms: the game never polled (is it open at the dev server, with VITE_DEV_BRIDGE=1?)`,
            log: logSince(stillPending.logLineAtStart),
            timedOut: true,
          });
        }, timeoutMs),
      };
      pending.set(id, command);
    });
  }

  function writeDataUrlPng(dataUrl: unknown, target: string): boolean {
    if (typeof dataUrl !== "string") {
      return false;
    }
    const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
    if (!match) {
      return false;
    }
    fs.writeFileSync(target, Buffer.from(match[1], "base64"));
    return true;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://bridge");
    const route = `${req.method} ${url.pathname}`;

    switch (route) {
      // The shell sends a command and waits for its result
      case "POST /cmd": {
        const body = JSON.parse(await readBody(req));
        if (typeof body.js !== "string") {
          return sendJson(res, 400, { error: "js (string) required" });
        }
        const timeoutMs = Number(body.timeout) > 0 ? Number(body.timeout) : 30_000;
        return sendJson(res, 200, await enqueue(body.js, timeoutMs));
      }
      // The game asks for commands
      case "GET /poll": {
        lastPollAt = Date.now();
        const commands: { id: number; js: string }[] = [];
        for (const command of pending.values()) {
          if (!command.dispatched) {
            command.dispatched = true;
            commands.push({ id: command.id, js: command.js });
          }
        }
        return sendJson(res, 200, { commands });
      }
      // The game answers a command
      case "POST /result": {
        const body = JSON.parse(await readBody(req));
        const command = pending.get(Number(body.id));
        if (!command) {
          return sendJson(res, 200, { accepted: false });
        }
        clearTimeout(command.timer);
        pending.delete(command.id);
        command.resolve({
          id: command.id,
          ok: !!body.ok,
          result: body.result,
          error: body.error,
          log: logSince(command.logLineAtStart),
        });
        return sendJson(res, 200, { accepted: true });
      }
      case "POST /log": {
        const body = JSON.parse(await readBody(req));
        const lines = Array.isArray(body.lines) ? body.lines.map(String) : [];
        appendLog(lines);
        return sendJson(res, 200, { lines: logLineCount });
      }
      case "GET /log": {
        const tail = Number(url.searchParams.get("tail")) || 40;
        return sendJson(res, 200, { lines: logRing.slice(-tail), total: logLineCount });
      }
      case "POST /status": {
        clientStatus = JSON.parse(await readBody(req));
        writeStatus();
        return sendJson(res, 200, { ok: true });
      }
      case "GET /status": {
        writeStatus();
        return sendJson(res, 200, JSON.parse(fs.readFileSync(statusPath, "utf8")));
      }
      case "POST /state": {
        const body = await readBody(req);
        fs.writeFileSync(statePath, body, "utf8");
        return sendJson(res, 200, { ok: true });
      }
      case "POST /shot": {
        const body = JSON.parse(await readBody(req));
        const name = safeName(body.name, `shot_${Date.now()}`);
        const target = path.join(shotsDir, `${name}.png`);
        if (!writeDataUrlPng(body.dataUrl, target)) {
          return sendJson(res, 400, { error: "dataUrl must be a PNG data URL" });
        }
        return sendJson(res, 200, { path: target });
      }
      case "POST /live": {
        const body = JSON.parse(await readBody(req));
        if (!writeDataUrlPng(body.dataUrl, livePath)) {
          return sendJson(res, 400, { error: "dataUrl must be a PNG data URL" });
        }
        return sendJson(res, 200, { path: livePath });
      }
      default:
        return sendJson(res, 404, { error: `unknown route ${route}` });
    }
  }

  return {
    name: NAME,
    apply: "serve",
    configureServer(server) {
      ensureDirs();
      fs.writeFileSync(
        path.join(bridgeDir, "README.txt"),
        [
          "Dev Bridge runtime folder (written by plugins/vite/dev-bridge-plugin.ts).",
          "log.txt     game messages, UI/phase changes and console errors, one line per event",
          "state.json  latest battle/party dump (bridge.sh peek)",
          "status.json what the game last reported plus the command queue (bridge.sh status)",
          "shots/      screenshots from bridge.sh shot NAME",
          "live.png    the screen, rewritten while bridge.sh live N is on",
          "",
        ].join("\n"),
        "utf8",
      );
      appendLog([`[S] dev server started; bridge folder ${bridgeDir}`]);
      server.config.logger.info(`  ➜  Dev Bridge: ${bridgeDir} (bridge.sh)`);

      server.middlewares.use("/__bridge", (req, res) => {
        handle(req, res).catch(err => {
          sendJson(res, 500, { error: String(err?.stack ?? err) });
        });
      });
    },
  };
}
