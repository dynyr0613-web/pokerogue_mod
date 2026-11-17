/**
 * Local fork (2026-11-08): the rare Endless spawn of the "GTS?" encounter (DARK_GLOBAL_TRADE_SYSTEM).
 *
 * Endless fights Eternatus on every wave % 250 === 0, always in the End. On the wave just before (249, 499, 749,
 * 999, ...) one roll decides whether that wave is moved into the End too and turned into the "GTS?" encounter:
 * 1% on the waves before a millennium (999, 1999, ...), 0.5% on the others. Classic, Challenge and Daily never get it.
 *
 * Kept in its own small module (no encounter or phase imports) so `BattleScene` and `SelectBiomePhase` can ask it
 * without import cycles, and so tests can stub {@linkcode isDarkGtsEndWave}.
 */
import { globalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import { randSeedInt } from "#utils/common";

/** The roll is out of this many; the chances below are whole numbers of it */
const DARK_GTS_ROLL_RANGE = 1000;
/** 0.5%: the wave before an ordinary Eternatus (249, 499, 749, 1249, ...) */
const DARK_GTS_CHANCE = 5;
/** 1%: the wave before an Eternamax Eternatus (999, 1999, ...) */
const DARK_GTS_MILLENNIUM_CHANCE = 10;

/**
 * Seed offset of the roll. The Endless mystery encounter roll uses `waveIndex * 3000`; `+ 1500` keeps the two apart
 * on every wave, also after `shiftCharCodes` wraps char codes at 65536 (1500 * odd is never a multiple of 65536).
 */
function getDarkGtsSeedOffset(waveIndex: number): number {
  return waveIndex * 3000 + 1500;
}

/**
 * The chance (0 to 1) that `waveIndex` is a "GTS?" wave in the End: 1/100 on waves 999, 1999, ..., 1/200 on the other
 * waves just before an Eternatus (249, 499, 749, ...), 0 elsewhere and outside Endless / Spliced Endless.
 */
export function getDarkGtsEndWaveChance(waveIndex: number): number {
  const modeId = globalScene.gameMode?.modeId;
  if (modeId !== GameModes.ENDLESS && modeId !== GameModes.SPLICED_ENDLESS) {
    return 0;
  }
  if (waveIndex % 250 !== 249) {
    return 0;
  }
  return (waveIndex % 1000 === 999 ? DARK_GTS_MILLENNIUM_CHANCE : DARK_GTS_CHANCE) / DARK_GTS_ROLL_RANGE;
}

/**
 * Whether `waveIndex` is a "GTS?" wave: the wave is in the End (the wave before it ends its biome, see
 * `BattleScene.isNewBiome` and `SelectBiomePhase`) and is that encounter, whatever the normal encounter roll says.
 *
 * The roll runs on its own seed offset of the session seed, so it gives the same answer at the end of the previous
 * wave (biome switch), when the wave is generated, and after a save is reloaded.
 */
export function isDarkGtsEndWave(waveIndex: number): boolean {
  const chance = getDarkGtsEndWaveChance(waveIndex);
  if (chance <= 0) {
    return false;
  }
  let roll = DARK_GTS_ROLL_RANGE;
  globalScene.executeWithSeedOffset(() => {
    roll = randSeedInt(DARK_GTS_ROLL_RANGE);
  }, getDarkGtsSeedOffset(waveIndex));
  return roll < Math.round(chance * DARK_GTS_ROLL_RANGE);
}
