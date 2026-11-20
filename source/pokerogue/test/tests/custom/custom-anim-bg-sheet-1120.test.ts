/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-20): Lick's enemy-side animation names its own sheet "PRAS- Sketch + Lick" as a background too.
 * Loading it both as the sheet and as a background image used one texture key twice, and the offline app's self-test
 * logged "Texture key already in use" for an enemy that knew Lick. `loadAnimAssets` now skips a background that is one
 * of the loaded animations' sheets.
 */

import { globalScene } from "#app/global-scene";
import { AnimConfig, loadMoveAnimAssets, moveAnims } from "#data/battle-anims";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import { toKebabCase } from "#utils/strings";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Puts `move`'s real animation (from disk) in `moveAnims`; the test harness does not fetch animation files */
function setRealAnim(move: MoveId): void {
  const data: unknown = JSON.parse(readFileSync(`assets/battle-anims/${toKebabCase(MoveId[move])}.json`, "utf8"));
  const [player, opponent] = (Array.isArray(data) ? data : [data]).map(source => new AnimConfig(source));
  moveAnims.set(move, opponent ? [player, opponent] : player);
}

describe("Animation backgrounds that are also a sheet (2026-11-20)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const id of [MoveId.LICK, MoveId.PSYCHIC, MoveId.PSYBEAM]) {
      moveAnims.delete(id);
    }
  });

  it("loads Lick's sheet once and not again as a background image", async () => {
    setRealAnim(MoveId.LICK);
    const loadImage = vi.spyOn(globalScene, "loadImage");
    const loadSpritesheet = vi.spyOn(globalScene, "loadSpritesheet");
    await loadMoveAnimAssets([MoveId.LICK]);

    const sheetKeys = loadSpritesheet.mock.calls.map(c => c[0]);
    const imageKeys = loadImage.mock.calls.map(c => c[0]);
    expect(sheetKeys).toContain("PRAS- Sketch + Lick");
    expect(imageKeys).not.toContain("PRAS- Sketch + Lick");
    expect(game).toBeDefined();
  });

  it("does the same for Psychic, whose sheet is its background, and still loads Psybeam's background image", async () => {
    setRealAnim(MoveId.PSYCHIC);
    setRealAnim(MoveId.PSYBEAM);
    const loadImage = vi.spyOn(globalScene, "loadImage");
    const loadSpritesheet = vi.spyOn(globalScene, "loadSpritesheet");

    // Psychic: sheet "PRAS- Psychic BG", background "PRAS- Psychic BG"
    await loadMoveAnimAssets([MoveId.PSYCHIC]);
    expect(loadSpritesheet.mock.calls.map(c => c[0])).toContain("PRAS- Psychic BG");
    expect(loadImage.mock.calls.map(c => c[0])).not.toContain("PRAS- Psychic BG");

    // Psybeam alone: its sheet is "PRAS- Psybeam", so "PRAS- Psychic BG" still loads as its background image
    loadImage.mockClear();
    await loadMoveAnimAssets([MoveId.PSYBEAM]);
    expect(loadImage.mock.calls.map(c => c[0])).toContain("PRAS- Psychic BG");
  });
});
