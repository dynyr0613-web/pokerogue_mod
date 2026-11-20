/*
 * Dev Bridge (local development only): `burst()`, a run of frames from the game canvas made into one contact sheet
 * (each tile labelled with its frame number and time), and `shot()` with a crop. Local fork (2026-11-21): seeing an
 * animation used to take a move, 30-50 separate screenshots and a contact sheet built outside the game (the user's
 * goal: "당신이 화면 정보를 보다 쉽게 읽고 ...").
 *
 * Frames are copied from the canvas right after Phaser renders them (its `postrender` event), so they also come while
 * the game loop runs on setTimeout because requestAnimationFrame stopped in a hidden pane.
 */

import { lastMessageSeq, messagesSince } from "#app/dev-bridge/bridge-look";
import {
  type BurstOptions,
  changedPercent,
  cropToCanvas,
  formatPercent,
  layoutSheet,
  normalizeBurstOptions,
  type Rect,
  resolveCrop,
} from "#app/dev-bridge/bridge-pure";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { BattleAnim, MoveAnim } from "#data/battle-anims";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";

/** What the capture tools use from the rest of the bridge */
export interface BurstDeps {
  game(): Phaser.Game;
  /** Save a PNG data URL as Bridge/shots/<name>.png; returns the path */
  saveShot(name: string, dataUrl: string): Promise<string>;
  useMove(moveIndex: number, targetIndex?: number, style?: any, item?: number | string): Promise<string>;
  evalCommand(code: string): Promise<unknown>;
}

let deps: BurstDeps;

export function initBurstTools(d: BurstDeps): void {
  deps = d;
  hookAnims();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// #region animation hook

interface AnimStart {
  readonly seq: number;
  readonly t: number;
  /** "MoveAnim FLAMETHROWER", "CommonBattleAnim" ... */
  readonly what: string;
  readonly isMove: boolean;
}

let animSeq = 0;
let lastAnim: AnimStart | null = null;
let animHooked = false;

/** Count battle animations as they start, so a burst can begin with the move's animation */
function hookAnims(): void {
  if (animHooked) {
    return;
  }
  animHooked = true;
  const proto = BattleAnim.prototype as any;
  const original = proto.play;
  proto.play = function (this: any, ...args: unknown[]) {
    const isMove = this instanceof MoveAnim;
    lastAnim = {
      seq: ++animSeq,
      t: performance.now(),
      what: `${this.constructor?.name ?? "anim"}${isMove ? ` ${MoveId[this.move] ?? this.move}` : ""}`,
      isMove,
    };
    return original.apply(this, args);
  };
}

// #endregion animation hook

// #region capture

interface Frame {
  readonly tile: HTMLCanvasElement;
  readonly ms: number;
  readonly mode: string;
  /** Changed from the frame before, in percent */
  changed: number;
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  return c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
}

function isBlank(c: HTMLCanvasElement): boolean {
  const data = pixels(c);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] || data[i + 1] || data[i + 2]) {
      return false;
    }
  }
  return true;
}

/** Copy the crop of the game canvas into a new tile (nearest neighbour, game pixels times `scale`) */
function copyTile(
  source: CanvasImageSource,
  canvasW: number,
  canvasH: number,
  rect: Rect,
  scale: number,
): HTMLCanvasElement {
  const [sx, sy, sw, sh] = cropToCanvas(rect, canvasW, canvasH);
  const tile = newCanvas(rect[2] * scale, rect[3] * scale);
  const ctx = tile.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, tile.width, tile.height);
  return tile;
}

/** One frame through the renderer's snapshot (slower; used when copying the canvas gives a blank frame) */
function snapshotTile(rect: Rect, scale: number): Promise<HTMLCanvasElement> {
  const game = deps.game();
  return new Promise(resolve => {
    (game.renderer as any).snapshot((image: HTMLImageElement) => {
      const done = () => resolve(copyTile(image, image.width, image.height, rect, scale));
      if (image.complete) {
        done();
      } else {
        image.onload = done;
      }
    });
  });
}

/** Capture frames at the interval after Phaser renders them */
async function captureFrames(
  opts: BurstOptions,
  maxMs: number,
): Promise<{ frames: Frame[]; note: string; start: number }> {
  const game = deps.game();
  const canvas = game.canvas;
  const frames: Frame[] = [];
  const start = performance.now();
  let note = "";
  let useSnapshot = false;
  await new Promise<void>(resolve => {
    let last = Number.NEGATIVE_INFINITY;
    let busy = false;
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        game.events.off("postrender", onRender);
        clearTimeout(timer);
        resolve();
      }
    };
    const take = (tile: HTMLCanvasElement, now: number) => {
      frames.push({ tile, ms: Math.round(now - start), mode: UiMode[globalScene.ui.mode] ?? "?", changed: 100 });
      if (frames.length >= opts.count) {
        finish();
      }
    };
    const onRender = () => {
      const now = performance.now();
      if (busy || finished || now - last < opts.intervalMs - 4) {
        return;
      }
      last = now;
      if (useSnapshot) {
        busy = true;
        snapshotTile(opts.crop, opts.scale).then(snap => {
          busy = false;
          take(snap, now);
        });
        return;
      }
      const tile = copyTile(canvas, canvas.width, canvas.height, opts.crop, opts.scale);
      if (frames.length === 0 && isBlank(tile)) {
        // The drawing buffer was gone; fall back to the renderer's snapshots
        useSnapshot = true;
        note = "canvas copy was blank: frames came from renderer snapshots";
        last = Number.NEGATIVE_INFINITY;
        return;
      }
      take(tile, now);
    };
    const timer = setTimeout(() => {
      note = `${note ? `${note}; ` : ""}stopped after ${Math.round(maxMs / 1000)} s with ${frames.length} frames (the game loop is slow or stopped)`;
      finish();
    }, maxMs);
    game.events.on("postrender", onRender);
  });
  for (let i = 1; i < frames.length; i++) {
    frames[i].changed = changedPercent(pixels(frames[i - 1].tile), pixels(frames[i].tile));
  }
  return { frames, note, start };
}

/** Draw the kept frames on one sheet, each with "#index +ms MODE" under it */
function composeSheet(frames: Frame[], indexes: number[], opts: BurstOptions): HTMLCanvasElement {
  const tileW = opts.crop[2] * opts.scale;
  const tileH = opts.crop[3] * opts.scale;
  const layout = layoutSheet(frames.length, tileW, tileH, opts.columns);
  const sheet = newCanvas(Math.max(1, layout.width), Math.max(1, layout.height));
  const ctx = sheet.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#202020";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  frames.forEach((f, i) => {
    const cell = layout.cells[i];
    ctx.drawImage(f.tile, cell.x, cell.y);
    ctx.fillStyle = "#000000";
    ctx.fillRect(cell.x, cell.labelY, tileW, layout.labelHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`#${indexes[i]} +${f.ms}ms ${f.mode}`, cell.x + 2, cell.labelY + 1, tileW - 4);
  });
  return sheet;
}

// #endregion capture

/**
 * Capture `count` frames every `intervalMs` (optionally after an action: `{move: 0, style, item}` or `{js}`), keep
 * the changed ones if asked, and save one contact sheet as Bridge/shots/<name>.png.
 * With a move, capturing starts when its animation starts (`startOn: "anim"`, waiting up to `waitMs`).
 * Returns short text (or the object with `{json: true}`): the path, the frames (index, ms, mode, changed %), messages.
 */
export async function burst(
  name: string,
  raw: Record<string, unknown> = {},
): Promise<string | Record<string, unknown>> {
  const { json, ...rest } = raw as Record<string, unknown> & { json?: boolean };
  const opts = normalizeBurstOptions(rest);
  const msgStart = lastMessageSeq();
  const animStart = animSeq;
  const t0 = performance.now();
  let actionResult: Promise<unknown> | null = null;
  let actionFailed = false;
  const runAction = () => {
    const a = opts.action;
    if (!a) {
      return;
    }
    actionResult = (
      a.move == null ? deps.evalCommand(a.js ?? "") : deps.useMove(a.move, a.target, a.style as any, a.item)
    ).catch((err: unknown) => {
      actionFailed = true;
      return `action failed: ${err instanceof Error ? err.message : String(err)}`;
    });
  };
  let startNote = "now";
  if (opts.startOn === "anim") {
    runAction();
    const wantMove = opts.action?.move != null;
    // Until the animation starts; a failed action (not in the command menu ...) stops the wait at once
    while (!(lastAnim && lastAnim.seq > animStart && (!wantMove || lastAnim.isMove))) {
      if (actionFailed || performance.now() - t0 > opts.waitMs) {
        break;
      }
      await sleep(5);
    }
    if (lastAnim && lastAnim.seq > animStart) {
      startNote = `${lastAnim.what} after ${Math.round(lastAnim.t - t0)} ms`;
    } else {
      startNote = actionFailed
        ? "the action failed; started anyway"
        : `no animation within ${opts.waitMs} ms; started anyway`;
    }
  } else {
    // Capture first, then act, so the frames include the command itself
    setTimeout(runAction, 0);
  }
  const captured = await captureFrames(opts, opts.count * opts.intervalMs + 15_000);
  const { frames } = captured;
  // Review fix (2026-11-21): with move animations off a move plays no animation to capture; say so
  const note = [
    captured.note,
    opts.action?.move != null && !settings.display.enableMoveAnimations
      ? "move animations are off in the settings (bridge.sh settings normal turns them on)"
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  const actionOut = actionResult ? await actionResult : null;
  // The frames kept on the sheet
  const kept: number[] = [];
  let lastKeptPixels: Uint8ClampedArray | null = null;
  frames.forEach((f, i) => {
    if (!opts.changedOnly || lastKeptPixels == null) {
      kept.push(i);
      lastKeptPixels = pixels(f.tile);
      return;
    }
    const now = pixels(f.tile);
    if (changedPercent(lastKeptPixels, now) >= opts.threshold) {
      kept.push(i);
      lastKeptPixels = now;
    }
  });
  const sheet = composeSheet(
    kept.map(i => frames[i]),
    kept,
    opts,
  );
  const path = frames.length > 0 ? await deps.saveShot(name, sheet.toDataURL("image/png")) : "(no frames)";
  // Review fix (2026-11-21): message times on the frames' clock (ms from the first frame; before it they are
  // negative), so a message lines up with the tiles shown at that time
  const messages = messagesSince(msgStart).map(m => ({ ms: Math.round(m.t - captured.start), text: m.text }));
  const frameList = frames.map((f, i) => ({ i, ms: f.ms, mode: f.mode, changed: Number(f.changed.toFixed(2)) }));
  const result = {
    path,
    sheet: `${sheet.width}x${sheet.height}`,
    columns: layoutSheet(kept.length, opts.crop[2] * opts.scale, opts.crop[3] * opts.scale, opts.columns).columns,
    crop: opts.cropName || opts.crop.join(","),
    scale: opts.scale,
    start: startNote,
    frames: frameList,
    kept,
    messages,
    ...(note ? { note } : {}),
    ...(actionOut == null ? {} : { action: actionOut }),
  };
  if (json) {
    return result;
  }
  const span = frames.length > 0 ? frames.at(-1)!.ms : 0;
  const lines = [
    `burst ${name}: ${frames.length} frames / ${span} ms (every ${opts.intervalMs}), kept ${kept.length}${opts.changedOnly ? ` (changed >= ${opts.threshold}%)` : ""}, crop ${result.crop} x${opts.scale} -> ${path} (${result.sheet}, ${result.columns} cols)`,
    `start: ${startNote}${actionOut == null ? "" : ` · action: ${typeof actionOut === "string" ? actionOut : JSON.stringify(actionOut)}`}`,
    `frames: ${frameList.map(f => `#${f.i} +${f.ms} ${f.mode}${f.i > 0 ? ` ${formatPercent(f.changed)}%` : ""}${kept.includes(f.i) ? "" : " -"}`).join(" | ")}`,
  ];
  if (messages.length > 0) {
    lines.push(`messages: ${messages.map(m => `${m.ms < 0 ? "" : "+"}${m.ms} ${m.text}`).join(" | ")}`);
  }
  if (note) {
    lines.push(`note: ${note}`);
  }
  return lines.join("\n");
}

/** One frame of `crop` (a name or [x, y, w, h] in game pixels) at `scale`, as a PNG data URL, after the next render */
export async function cropShot(crop: string | number[], scale = 1): Promise<string> {
  const rect = resolveCrop(crop);
  const game = deps.game();
  const canvas = game.canvas;
  // The tile copied right after the next render, or null when no frame comes within 3 s
  const copied = await new Promise<HTMLCanvasElement | null>(resolve => {
    const timer = setTimeout(() => {
      game.events.off("postrender", onRender);
      resolve(null);
    }, 3000);
    const onRender = () => {
      game.events.off("postrender", onRender);
      clearTimeout(timer);
      resolve(copyTile(canvas, canvas.width, canvas.height, rect, scale));
    };
    game.events.on("postrender", onRender);
  });
  const tile = copied && !isBlank(copied) ? copied : await snapshotTile(rect, scale);
  return tile.toDataURL("image/png");
}
