import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { PlayerPokemon } from "#field/pokemon";
import { feedCandy } from "#modifiers/custom-consumables";

/**
 * Local fork (2026-11-05): feeds a Candy Pile (사탕더미) candy by candy, so it ends exactly where 5 Rare Candies on
 * the chosen Pokémon and then 2 Rarer Candies would: every evolution on the way happens (Caterpie -> Metapod ->
 * Butterfree), moves are offered from the learnset of the species at that point, evolutions that need a move or
 * friendship see what they would see, and a Shedinja that appears partway gets the Rarer Candies still to come.
 *
 * Each step queues its level-up phase(s) and then the next step. The level-up phase's own learn-move and evolution
 * phases run before that next step (they sit one level higher in the phase tree).
 *
 * The chosen Pokémon's Rare Candies are grouped into one level-up while nothing can happen in between: a group ends
 * with the candy whose own level-up would offer a level-up move or start an evolution. Each Rarer Candy round is
 * one level-up per party member, like the real item.
 *
 * Local fork (2026-11-08): Candy Jars count once per pile (the user's option (가)), so each candy gives 1 level and
 * the jar bonus is added once per Pokémon: the chosen Pokémon gets it on its first Rare Candy (`targetBonus`),
 * every other member on its first Rarer Candy (`partyBonus`, which a Shedinja that appears partway still gets).
 * Local fork (2026-11-12): the caller sets the sizes (`CandyPileModifier`: 2 x jars for the chosen Pokémon, jars for the
 * rest, `CANDY_PILE_JAR_COUNTS`); each is still added once.
 */
export class CandyPilePhase extends Phase {
  public readonly phaseName = "CandyPilePhase";
  private readonly targetId: number;
  private readonly rareLeft: number;
  private readonly rarerLeft: number;
  /** Local fork (2026-11-08): Candy Jar levels the chosen Pokémon has still to get (0 once it got them) */
  private readonly targetBonus: number;
  /** Local fork (2026-11-08): Candy Jar levels each other member gets in the next Rarer round (0 after the first) */
  private readonly partyBonus: number;

  constructor(targetId: number, rareLeft: number, rarerLeft: number, targetBonus: number, partyBonus: number) {
    super();
    this.targetId = targetId;
    this.rareLeft = rareLeft;
    this.rarerLeft = rarerLeft;
    this.targetBonus = targetBonus;
    this.partyBonus = partyBonus;
  }

  public override start(): void {
    super.start();

    const { phaseManager } = globalScene;
    const party = globalScene.getPlayerParty();
    const target = party.find(p => p.id === this.targetId);

    if (this.rareLeft > 0 && target) {
      const lastLevel = target.level;
      let used = 0;
      // Local fork (2026-11-08): the jar bonus rides on the first Rare Candy only
      let levels = 1 + this.targetBonus;
      while (used < this.rareLeft) {
        const before = target.level;
        feedCandy(target, levels);
        levels = 1;
        used++;
        if (CandyPilePhase.levelUpDoesSomething(target, before)) {
          break;
        }
      }
      phaseManager.unshiftNew("LevelUpPhase", party.indexOf(target), lastLevel, target.level);
      phaseManager.unshiftNew(
        "CandyPilePhase",
        this.targetId,
        this.rareLeft - used,
        this.rarerLeft,
        0, // Local fork (2026-11-08): the chosen Pokémon got its jar bonus
        this.partyBonus,
      );
    } else if (this.rarerLeft > 0) {
      for (const pokemon of party) {
        const lastLevel = pokemon.level;
        // Local fork (2026-11-08): 1 level, plus the jar bonus this Pokémon has not had yet (first round only)
        feedCandy(pokemon, 1 + this.rarerJarBonus(pokemon));
        phaseManager.unshiftNew("LevelUpPhase", party.indexOf(pokemon), lastLevel, pokemon.level);
      }
      phaseManager.unshiftNew("CandyPilePhase", this.targetId, 0, this.rarerLeft - 1, 0, 0);
    }

    this.end();
  }

  /** Local fork (2026-11-08): the Candy Jar levels `pokemon` gets with this Rarer round (0 once it had them) */
  private rarerJarBonus(pokemon: PlayerPokemon): number {
    return pokemon.id === this.targetId ? this.targetBonus : this.partyBonus;
  }

  /**
   * Whether a level-up from `before` to the Pokémon's current level would offer a move or start an evolution,
   * checked the way `LevelUpPhase.end` does.
   */
  static levelUpDoesSomething(pokemon: PlayerPokemon, before: number): boolean {
    if (
      before < 100
      && pokemon.getLevelMoves({ startingLevel: before + 1, includePrevolutionMoves: true }).length > 0
    ) {
      return true;
    }
    return !pokemon.pauseEvolutions && pokemon.getEvolution() != null;
  }
}
