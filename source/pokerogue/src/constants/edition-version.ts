// Local fork (2026-11-19): the edition's own version in one place (docs/1.2.0_후보_20261119.md, A3; the user: "a3는
// 경고 후 열지 못하도록"). The title screen shows it, and the system and session saves store it as `editionVersion`, so
// that a save written by a newer edition is refused instead of being loaded and saved over by an older one (the
// upstream `gameVersion` is the same in every edition, so it cannot tell them apart).
// Bump EDITION_VERSION with each release, together with offline-app/package.json and line 3 of the distribution's
// 읽어주세요.txt (test/tests/custom/custom-edition-version.test.ts checks that the three agree).

/** The edition's version, e.g. `"1.1.0"` (numbers and dots only: saves compare it number by number) */
export const EDITION_VERSION = "1.1.0";

/** Whether the edition is still a beta: the title then shows "(베타)" after the version */
export const EDITION_IS_BETA = true;

/** Version text shown under the title logo, e.g. `"v1.1.0 (베타)"` */
export const EDITION_VERSION_TEXT = `v${EDITION_VERSION}${EDITION_IS_BETA ? " (베타)" : ""}`;

/** Splits a version made of numbers and dots, or `null` when it is anything else */
function parseEditionVersion(version: string): number[] | null {
  return /^\d+(?:\.\d+)*$/.test(version) ? version.split(".").map(Number) : null;
}

/**
 * Whether a save's `editionVersion` comes from a newer edition than this build.
 * A save without one (1.1.0 and older) is never newer. A value this build cannot read counts as newer, so a save from
 * an edition that writes its version differently is refused rather than saved over.
 * @param saveEditionVersion - The `editionVersion` stored in the save, if any
 * @param currentVersion - This build's edition version; defaults to {@linkcode EDITION_VERSION}
 */
export function isNewerEditionVersion(saveEditionVersion: unknown, currentVersion: string = EDITION_VERSION): boolean {
  if (saveEditionVersion == null) {
    return false;
  }
  const current = parseEditionVersion(currentVersion);
  if (current == null) {
    // A malformed EDITION_VERSION must not lock every save out (custom-edition-version.test.ts checks its format)
    return false;
  }
  const save = typeof saveEditionVersion === "string" ? parseEditionVersion(saveEditionVersion) : null;
  if (save == null) {
    return true;
  }
  for (let i = 0; i < Math.max(save.length, current.length); i++) {
    const diff = (save[i] ?? 0) - (current[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}
