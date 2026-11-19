import { modifierTypes } from "#data/data-lists";
import { FormChangeItem } from "#enums/form-change-item";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-19): 1.2.0 item A2. Max Mushrooms (다이버섯) showed the vanilla form-change text although since
 * 11-18 they give any Pokémon the Dynamax state (pokemon-forms-dynamax.ts); the Life Orb's text did not say its recoil
 * always leaves 1 HP (LIFE_ORB_MIN_HP_LEFT, custom-held-items.ts).
 */
describe("Local fork - Max Mushroom and Life Orb descriptions (2026-11-19)", () => {
  const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
  const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;

  it("Max Mushrooms have their own text in both locales", () => {
    for (const text of [ko, en]) {
      const own: string = text.FormChangeItemModifierType.maxMushroomsDescription;
      expect(own).toBeTruthy();
      expect(own).not.toBe(text.FormChangeItemModifierType.description);
      expect(own).toContain("1.5");
      expect(own).not.toMatch(/\{\{|\[\[/);
    }
    expect(ko.FormChangeItemModifierType.maxMushroomsDescription).toContain("다이맥스 상태");
    expect(ko.FormChangeItemModifierType.maxMushroomsDescription).toContain("거다이맥스");
    expect(en.FormChangeItemModifierType.maxMushroomsDescription).toContain("Dynamax state");
    expect(en.FormChangeItemModifierType.maxMushroomsDescription).toContain("G-Max");
  });

  it("the reward uses it for Max Mushrooms only; other form-change items keep the vanilla text", () => {
    const mushrooms = new FormChangeItemModifierType(FormChangeItem.MAX_MUSHROOMS);
    expect(mushrooms.getDescription()).toBe(en.FormChangeItemModifierType.maxMushroomsDescription);
    for (const item of [FormChangeItem.GENGARITE, FormChangeItem.CHARIZARDITE_X, FormChangeItem.BLUE_ORB]) {
      expect(new FormChangeItemModifierType(item).getDescription(), FormChangeItem[item]).toBe(
        en.FormChangeItemModifierType.description,
      );
    }
  });

  it("the Life Orb's text says its recoil never makes the holder faint", () => {
    expect(ko.LIFE_ORB.description).toContain("쓰러지지 않는다");
    expect(ko.LIFE_ORB.description).toContain("HP 1");
    expect(en.LIFE_ORB.description).toContain("never makes it faint");
    expect(en.LIFE_ORB.description).toContain("1 HP");
    expect(modifierTypes.LIFE_ORB().withIdFromFunc(modifierTypes.LIFE_ORB).getDescription()).toBe(
      en.LIFE_ORB.description,
    );
  });
});
