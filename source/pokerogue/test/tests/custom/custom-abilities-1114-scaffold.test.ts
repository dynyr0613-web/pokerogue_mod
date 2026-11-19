// Local fork (2026-11-14): passive rebalance. Checks the scaffold of the 42 new custom abilities and of the
// follow-up after them (Clearing Gust): registration order matches the enum and both locales have a name and
// description for each.

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { toCamelCase } from "#utils/strings";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The new abilities, first to last (impl_batches.json "order"). */
const FIRST = AbilityId.FROST_FUR;
const LAST = AbilityId.CANNONEER;
/**
 * Local fork (2026-11-14): passive rebalance. Follow-up abilities after the 42, in enum order (custom-abilities-1114-e.ts).
 * Local fork (2026-11-14): custom moves. Then Gardener and Turnabout (custom-abilities-1114-f.ts).
 * Local fork (2026-11-19): 1.2.0 D12 (the user: "d12 실행"). Then Archmage, Wicked Scheme and Grit
 * (custom-abilities-1119-d12.ts).
 */
const FOLLOW_UP = [
  AbilityId.CLEARING_GUST,
  AbilityId.GARDENER,
  AbilityId.TURNABOUT,
  AbilityId.ARCHMAGE,
  AbilityId.WICKED_SCHEME,
  AbilityId.GRIT,
] as const;
/** The last custom ability: the end of the enum and of `allAbilities`. */
const REGION_END = FOLLOW_UP.at(-1) ?? LAST;

function readLocale(lang: string): Record<string, { name?: string; description?: string }> {
  return JSON.parse(readFileSync(`locales/${lang}/ability.json`, "utf-8"));
}

describe("Custom abilities 2026-11-14 scaffold", () => {
  it("adds 42 abilities right after Mind Blade", () => {
    expect(FIRST).toBe(AbilityId.MIND_BLADE + 1);
    expect(LAST - FIRST + 1).toBe(42);
  });

  it("adds the follow-up abilities right after Cannoneer, at the end of the enum", () => {
    FOLLOW_UP.forEach((id, index) => {
      expect(id, AbilityId[id]).toBe(LAST + 1 + index);
    });
    expect(AbilityId[REGION_END + 1]).toBeUndefined();
  });

  it("registers every ability at the index of its id", () => {
    expect(allAbilities.length).toBe(REGION_END + 1);
    for (let id = FIRST; id <= REGION_END; id++) {
      expect(allAbilities[id].id, AbilityId[id]).toBe(id);
    }
  });

  it.each(["ko", "en"])("has a %s name and description for each", lang => {
    const locale = readLocale(lang);
    for (let id = FIRST; id <= REGION_END; id++) {
      const entry = locale[toCamelCase(AbilityId[id])];
      expect(entry?.name, AbilityId[id]).toBeTruthy();
      expect(entry?.description, AbilityId[id]).toBeTruthy();
    }
  });

  // What the summary screen and the dev bridge show (`Ability.name` / `.description`; tests load the en locale)
  it("resolves each name and description at run time", () => {
    const locale = readLocale("en");
    for (let id = FIRST; id <= REGION_END; id++) {
      const entry = locale[toCamelCase(AbilityId[id])];
      expect(allAbilities[id].name, AbilityId[id]).toBe(entry?.name);
      expect(allAbilities[id].description, AbilityId[id]).toBe(entry?.description);
    }
  });
});
