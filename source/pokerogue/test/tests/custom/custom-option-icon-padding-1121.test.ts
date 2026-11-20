/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-21): an option menu with item icons of different widths. When a later option's icon is wider,
 * the earlier options are re-initialized; they used to pad their already padded label again, so the first line's text
 * sat further right (the held-item choice: 화염구슬 above 왕의징표석).
 */

import { UiMode } from "#enums/ui-mode";
import { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { describe, expect, it } from "vitest";

/** A stand-in for the measuring sprite: its frame width follows the frame name ("w12" is 12 px wide) */
function fakeSprite() {
  const sprite = {
    scale: 1,
    frame: { width: 0 },
    setTexture(_name: string, frame: string) {
      sprite.frame = { width: Number(frame.slice(1)) };
      return sprite;
    },
    setScale(scale: number) {
      sprite.scale = scale;
      return sprite;
    },
  };
  return sprite;
}

describe("Option menu icon padding (2026-11-21)", () => {
  it("pads every label once, by the widest icon, also after a wider icon re-initializes the earlier ones", () => {
    const handler = new OptionSelectUiHandler(UiMode.OPTION_SELECT) as any;
    handler.maxIconWidth = 0;
    const options: any[] = [
      { label: "A", iconsConfig: [{ name: "items", frame: "w8", scale: 1 }], displayLabel: "A", initialized: false },
      { label: "B", iconsConfig: [{ name: "items", frame: "w12", scale: 1 }], displayLabel: "B", initialized: false },
    ];
    // the handler re-initializes from its own option list
    handler.options = options;
    const sprite = fakeSprite();
    let remaining = options.filter(o => !o.initialized);
    while (remaining.length > 0) {
      for (const option of remaining) {
        handler.initializeOption(option, 1, sprite);
      }
      remaining = options.filter(o => !o.initialized);
    }
    const leadingSpaces = (s: string) => s.replace(/\[[^\]]*\]/g, "").search(/\S/);
    // both labels: 12 spaces (the widest icon), not 8 + 12 for the first one
    expect(leadingSpaces(options[0].displayLabel)).toBe(12);
    expect(leadingSpaces(options[1].displayLabel)).toBe(12);
  });
});
