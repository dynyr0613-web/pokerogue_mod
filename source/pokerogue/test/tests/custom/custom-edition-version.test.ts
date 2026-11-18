// Local fork (2026-11-18): the edition's version is written in three places that must agree (the user: "작은 정리부터
// 하도록 하죠"; docs/다음_작업_후보_20261118.md "버전 표기가 네 가지로 섞여 있음"):
// - the title screen, EDITION_VERSION_TEXT (src/ui/handlers/title-ui-handler.ts), e.g. "v1.0.0 (베타)";
// - the offline app's package.json version (the installer's file version), e.g. "1.0.0-beta";
// - line 3 of the distribution's 읽어주세요.txt, e.g. "(베타 1.0.0, ...)".
// Bump all three together for a release. pokerogue's own package.json version (1.12.2.x) is the upstream PokeRogue
// version that saves and the update check use, and stays separate on purpose.

import { getAppRootDir } from "#test/utils/sprite-utils";
import { EDITION_VERSION_TEXT } from "#ui/title-ui-handler";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Local fork - one edition version everywhere", () => {
  const appDir = path.join(getAppRootDir(), "..", "offline-app");
  const appPackage = path.join(appDir, "package.json");

  it.skipIf(!fs.existsSync(appPackage))("title text = offline app package.json version", () => {
    const version: string = JSON.parse(fs.readFileSync(appPackage, "utf8")).version;
    const match = /^(\d+\.\d+\.\d+)(-beta)?$/.exec(version);
    expect(match, `offline-app version ${version}`).not.toBeNull();
    const [, number, beta] = match!;
    expect(EDITION_VERSION_TEXT).toBe(`v${number}${beta ? " (베타)" : ""}`);
  });

  const readme = path.join(appDir, "docs", "읽어주세요.txt");
  it.skipIf(!fs.existsSync(readme) || !fs.existsSync(appPackage))("읽어주세요.txt names the same version", () => {
    const version: string = JSON.parse(fs.readFileSync(appPackage, "utf8")).version;
    const number = version.replace(/-beta$/, "");
    const thirdLine = fs.readFileSync(readme, "utf8").split(/\r?\n/)[2];
    expect(thirdLine).toContain(version.endsWith("-beta") ? `베타 ${number}` : number);
    // Review: a release after the beta must not keep "베타" on that line
    if (!version.endsWith("-beta")) {
      expect(thirdLine).not.toContain("베타");
    }
  });
});
