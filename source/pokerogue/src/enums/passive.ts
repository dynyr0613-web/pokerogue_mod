/**
 * enum for passive
 */
export enum Passive {
  UNLOCKED = 1,
  ENABLED = 2,
  /**
   * Legacy: the whole line used our table's passive (`custom-passives`). Converted on load into
   * `StarterDataEntry.customPassiveSpecies`, which holds the choice per species.
   */
  CUSTOM = 4,
}
