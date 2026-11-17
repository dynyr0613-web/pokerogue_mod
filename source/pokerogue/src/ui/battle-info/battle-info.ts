import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { ALPHA_MAX_BOOST } from "#data/alpha-pokemon";
import { Gender, getGenderColor, getGenderSymbol } from "#data/gender";
import { getMarkKey, getPokemonTitle, MARKS_ATLAS_KEY, WILD_MARKS } from "#data/pokemon-marks";
import { getTypeRgb } from "#data/type";
import { PokemonMark } from "#enums/pokemon-mark";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TextStyle } from "#enums/text-style";
import type { Pokemon } from "#field/pokemon";
import { getVariantTint } from "#sprites/variant";
import { addTextObject } from "#ui/text";
import { fixedInt, getLocalizedSpriteKey, getShinyDescriptor } from "#utils/common";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import i18next from "i18next";
import Phaser from "phaser";

/**
 * Parameters influencing the position of elements within the battle info container
 */
export type BattleInfoParamList = {
  /** X offset for the name text*/
  nameTextX: number;
  /** Y offset for the name text */
  nameTextY: number;
  /** X offset for the level container */
  levelContainerX: number;
  /** Y offset for the level container */
  levelContainerY: number;
  /** X offset for the hp bar */
  hpBarX: number;
  /** Y offset for the hp bar */
  hpBarY: number;
  /** Parameters for the stat box container */
  statBox: {
    /** The starting offset from the left of the label for the entries in the stat box */
    xOffset: number;
    /** The X padding between each number column */
    paddingX: number;
    /** The index of the stat entries at which paddingX is used instead of startingX */
    statOverflow: number;
  };
};

/** Local fork (2026-11-17): the mark icons are 40 px; 0.2 makes them 8 px, one px apart */
const MARK_ICON_SCALE = 0.2;
const MARK_ICON_PITCH = 9;

/** Local fork (2026-11-17): a `lastTitle` no Pokémon has, to have the name and the title worked out again */
export const TITLE_STALE = "\u0000";

/** Local fork (2026-11-17): the room the name keeps next to a title, and the gap between the two, in px */
const TITLE_NAME_MIN = 30;
const TITLE_GAP = 1.5;

export abstract class BattleInfo extends Phaser.GameObjects.Container {
  public static readonly EXP_GAINS_DURATION_BASE = 1650;

  protected baseY: number;
  protected baseLvContainerX: number;

  protected player: boolean;
  protected mini: boolean;
  protected boss: boolean;
  protected bossSegments: number;
  protected offset: boolean;
  protected lastName: string | null;
  protected lastTeraType: PokemonType;
  protected lastStatus: StatusEffect;
  protected lastHp: number;
  protected lastMaxHp: number;
  protected lastHpFrame: string | null;
  protected lastStats: string;

  protected box: Phaser.GameObjects.Sprite;
  protected nameText: Phaser.GameObjects.Text;
  protected genderText: Phaser.GameObjects.Text;
  protected teraIcon: Phaser.GameObjects.Sprite;
  protected shinyIcon: Phaser.GameObjects.Sprite;
  protected fusionShinyIcon: Phaser.GameObjects.Sprite;
  protected splicedIcon: Phaser.GameObjects.Sprite;
  /**
   * Local fork (2026-11-17): an alpha's badge after the other icons next to the name, for the player's and the enemy's
   * Pokémon alike: its mark (golden at the full boost) with the stat boost in percent as a number on it
   * (alpha-pokemon.ts; the user: "야생 우두머리는 전투 중에도 증가율이 보이게 해보죠" and "아군이 전투에서 표시될때도
   * 아이콘과 증가율 표시가 있게 해보죠, 이름 옆에 우두머리 아이콘에 숫자를 추가한 아이콘이 있게 해서")
   */
  protected alphaIcon: Phaser.GameObjects.Image;
  protected alphaBoostText: Phaser.GameObjects.Text;
  /**
   * Local fork (2026-11-17): the title of the Pokémon's mark in small letters left of its name; the name and
   * everything placed after it move right by its width (the user: "이름은 왼쪽에 칭호를 표시하고 다른 요소들을 더 밀면
   * 될 것 같네요"). See `getPokemonTitle`.
   */
  protected titleText: Phaser.GameObjects.Text;
  protected lastTitle = "";
  /** Where the name starts without a title: the left end of the row under it too */
  protected nameTextBaseX = 0;
  /**
   * Local fork (2026-11-17): the Pokémon's mark icons, for the player's and the enemy's Pokémon alike, from the far
   * left of the row under the name (the user: "증표 아이콘은 아군 적 둘다 흰부분 맨 왼쪽부터 붙어있게"): the mark it
   * wears, then its wild mark and the Mini Mark, two at most. The other icons of the row and the status come after.
   */
  protected markIcons: Phaser.GameObjects.Image[] = [];
  /** How many of them the Pokémon has marks for, and the width they take */
  protected shownMarkCount = 0;
  protected statusIndicator: Phaser.GameObjects.Sprite;
  protected levelContainer: Phaser.GameObjects.Container;
  protected hpLabel: Phaser.GameObjects.Image;
  protected hpBar: Phaser.GameObjects.Image;
  protected levelNumbersContainer: Phaser.GameObjects.Container;
  protected type1Icon: Phaser.GameObjects.Sprite;
  protected type2Icon: Phaser.GameObjects.Sprite;
  protected type3Icon: Phaser.GameObjects.Sprite;
  protected expBar: Phaser.GameObjects.Image;

  protected statsContainer: Phaser.GameObjects.Container;
  protected statsBox: Phaser.GameObjects.Sprite;
  protected statValuesContainer: Phaser.GameObjects.Container;
  protected statNumbers: Phaser.GameObjects.Sprite[];

  get statOrder(): Stat[] {
    return [];
  }

  /** Helper method used by the constructor to create the tera and shiny icons next to the name */
  private constructIcons() {
    const hitArea = new Phaser.Geom.Rectangle(0, 0, 12, 15);
    const hitCallback = Phaser.Geom.Rectangle.Contains;

    this.teraIcon = globalScene.add
      .sprite(0, 0, "icon_tera")
      .setName("icon_tera")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .setInteractive(hitArea, hitCallback)
      .setPositionRelative(this.nameText, 0, 2);

    this.shinyIcon = globalScene.add
      .sprite(0, 0, "shiny_star")
      .setName("icon_shiny")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .setInteractive(hitArea, hitCallback)
      .setPositionRelative(this.nameText, 0, 2);

    this.fusionShinyIcon = globalScene.add
      .sprite(0, 0, "shiny_star_2")
      .setName("icon_fusion_shiny")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .copyPosition(this.shinyIcon);

    this.splicedIcon = globalScene.add
      .sprite(0, 0, "icon_spliced")
      .setName("icon_spliced")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .setInteractive(hitArea, hitCallback)
      .setPositionRelative(this.nameText, 0, 2);

    this.add([this.teraIcon, this.shinyIcon, this.fusionShinyIcon, this.splicedIcon]);

    // Local fork (2026-11-17): the alpha badge, see the fields. The mark icons are 40 px; 0.225 makes them 9 px
    this.alphaIcon = globalScene.add
      .image(0, 0, MARKS_ATLAS_KEY, getMarkKey(PokemonMark.ALPHA_MARK))
      .setName("icon_alpha")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.225);
    this.alphaBoostText = addTextObject(0, 0, "", TextStyle.BATTLE_INFO, { fontSize: "60px" })
      .setName("text_alpha_boost")
      .setVisible(false)
      .setOrigin(0)
      // A dark outline keeps the small digits readable over the icon
      .setStroke("#282030", 14);
    this.add([this.alphaIcon, this.alphaBoostText]);

    // Local fork (2026-11-17): the mark icons, see the field; below the stats container like the enemy's other icons
    for (let i = 0; i < 2; i++) {
      this.markIcons.push(
        globalScene.add
          .image(0, 0, MARKS_ATLAS_KEY, getMarkKey(PokemonMark.RARE_MARK))
          .setName(`icon_mark_${i}`)
          .setVisible(false)
          .setOrigin(0, 0)
          .setScale(MARK_ICON_SCALE),
      );
    }
    this.addAt(this.markIcons, this.getIndex(this.statsContainer));
  }

  /**
   * Local fork (2026-11-17): show or hide the alpha badge for the Pokémon and put it after the last icon next to the
   * name. Call it after the other icons have been placed.
   * @param pokemon - The Pokémon this info is for
   */
  protected updateAlphaBadge(pokemon: Pokemon): void {
    const isAlpha = pokemon.isAlpha();
    this.alphaIcon.setVisible(isAlpha);
    this.alphaBoostText.setVisible(isAlpha);
    if (!isAlpha) {
      return;
    }

    const x =
      this.nameText.displayWidth
      + this.genderText.displayWidth
      + 1
      + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0)
      + (this.splicedIcon.visible ? this.splicedIcon.displayWidth + 1 : 0)
      + (this.shinyIcon.visible ? this.shinyIcon.displayWidth + 1 : 0);
    const golden = pokemon.alphaBoost >= ALPHA_MAX_BOOST;
    // The icon stands a little to the right, and the number overlaps its lower left, as in the user's sketch
    this.alphaIcon
      .setFrame(getMarkKey(golden ? PokemonMark.GOLDEN_ALPHA_MARK : PokemonMark.ALPHA_MARK))
      .setPositionRelative(this.nameText, x + 4, 0.5);
    this.alphaBoostText.setText(`${pokemon.alphaBoost}`).setPositionRelative(this.nameText, x, 2);
  }

  /**
   * Submethod of the constructor that creates and adds the stats container to the battle info
   */
  protected constructStatContainer({ xOffset, paddingX, statOverflow }: BattleInfoParamList["statBox"]): void {
    this.statsContainer = globalScene.add.container(0, 0).setName("container_stats").setAlpha(0);
    this.add(this.statsContainer);

    this.statsBox = globalScene.add
      .sprite(0, 0, `${this.getTextureName()}_stats`)
      .setName("box_stats")
      .setOrigin(1, 0.5);
    this.statsContainer.add(this.statsBox);

    const statLabels: Phaser.GameObjects.Sprite[] = [];
    this.statNumbers = [];

    this.statValuesContainer = globalScene.add.container();
    this.statsContainer.add(this.statValuesContainer);

    const startingX = -this.statsBox.width + xOffset;

    // this gives us a different starting location from the left of the label and padding between stats for a player vs enemy
    // since the player won't have HP to show, it doesn't need to change from the current version

    for (const [i, s] of this.statOrder.entries()) {
      const isHp = s === Stat.HP;
      // we do a check for i > statOverflow to see when the stat labels go onto the next column
      // For enemies, we have HP (i=0) by itself then a new column, so we check for i > 0
      // For players, we don't have HP, so we start with i = 0 and i = 1 for our first column, and so need to check for i > 1
      const statX =
        i > statOverflow
          ? this.statNumbers[Math.max(i - 2, 0)].x + this.statNumbers[Math.max(i - 2, 0)].width + paddingX
          : startingX; // we have the Math.max(i - 2, 0) in there so for i===1 to not return a negative number; since this is now based on anything >0 instead of >1, we need to allow for i-2 < 0

      let statY = -this.statsBox.height / 2 + 4; // this is the baseline for the y-axis
      if (isHp || s === Stat.SPD) {
        statY += 5;
      } else if (this.player === !!(i % 2)) {
        // we compare i % 2 against this.player to tell us where to place the label
        // because this.battleStatOrder for enemies has HP, this.battleStatOrder[1]=ATK, but for players
        // this.battleStatOrder[0]=ATK, so this comparing i % 2 to this.player fixes this issue for us
        statY += 10;
      }

      const statLabel = globalScene.add
        .sprite(statX, statY, getLocalizedSpriteKey("pbinfo_stat"), Stat[s])
        .setName("icon_stat_label_" + i.toString())
        .setOrigin(0);
      statLabels.push(statLabel);
      this.statValuesContainer.add(statLabel);

      const statNumber = globalScene.add
        .sprite(statX + statLabel.width, statY, "pbinfo_stat_numbers", isHp ? "empty" : "3")
        .setName("icon_stat_number_" + i.toString())
        .setOrigin(0);
      this.statNumbers.push(statNumber);
      this.statValuesContainer.add(statNumber);

      if (isHp) {
        statLabel.setVisible(false);
        statNumber.setVisible(false);
      }
    }
  }

  /**
   * Submethod of the constructor that creates and adds the pokemon type icons to the battle info
   */
  protected abstract constructTypeIcons(): void;

  /**
   * @param x - The x position of the battle info container
   * @param y - The y position of the battle info container
   * @param player - Whether this battle info belongs to a player or an enemy
   * @param posParams - The parameters influencing the position of elements within the battle info container
   */
  constructor(x: number, y: number, player: boolean, posParams: BattleInfoParamList) {
    super(globalScene, x, y);
    this.baseY = y;
    this.player = player;
    this.mini = !player;
    this.boss = false;
    this.offset = false;
    this.lastName = null;
    this.lastTeraType = PokemonType.UNKNOWN;
    this.lastStatus = StatusEffect.NONE;
    this.lastHp = -1;
    this.lastMaxHp = -1;
    this.lastHpFrame = null;
    this.baseLvContainerX = posParams.levelContainerX;

    // Initially invisible and shown via Pokemon.showInfo
    this.setVisible(false);

    this.box = globalScene.add.sprite(0, 0, this.getTextureName()).setName("box").setOrigin(1, 0.5);
    this.add(this.box);

    this.nameText = addTextObject(posParams.nameTextX, posParams.nameTextY, "", TextStyle.BATTLE_INFO)
      .setName("text_name")
      .setOrigin(0);
    this.add(this.nameText);

    this.nameTextBaseX = posParams.nameTextX;
    this.titleText = addTextObject(posParams.nameTextX, posParams.nameTextY + 2.5, "", TextStyle.BATTLE_INFO, {
      fontSize: "52px",
    })
      .setName("text_title")
      .setOrigin(0);
    this.add(this.titleText);

    this.genderText = addTextObject(0, 0, "", TextStyle.BATTLE_INFO)
      .setName("text_gender")
      .setOrigin(0)
      .setPositionRelative(this.nameText, 0, 2);
    this.add(this.genderText);

    this.constructIcons();

    this.statusIndicator = globalScene.add
      .sprite(0, 0, getLocalizedSpriteKey("statuses"))
      .setName("icon_status")
      .setVisible(false)
      .setOrigin(0)
      .setPositionRelative(this.nameText, 0, 11.5);
    this.add(this.statusIndicator);

    this.levelContainer = globalScene.add
      .container(posParams.levelContainerX, posParams.levelContainerY)
      .setName("container_level");
    this.add(this.levelContainer);

    const levelOverlay = globalScene.add.image(5.5, 0, getLocalizedSpriteKey("overlay_lv")).setOrigin(1, 0.5);
    this.levelContainer.add(levelOverlay);

    this.hpBar = globalScene.add.image(posParams.hpBarX, posParams.hpBarY, "overlay_hp").setName("hp_bar").setOrigin(0);
    this.add(this.hpBar);

    this.hpLabel = globalScene.add
      .image(posParams.hpBarX - 1, posParams.hpBarY - 3, getLocalizedSpriteKey("overlay_hp_label"))
      .setOrigin(1, 0);
    this.add(this.hpLabel);

    this.levelNumbersContainer = globalScene.add
      .container(9.5, settings.isLegacyTheme ? 0 : -0.5)
      .setName("container_level");
    this.levelContainer.add(this.levelNumbersContainer);

    this.constructStatContainer(posParams.statBox);

    this.constructTypeIcons();
  }

  getStatsValueContainer(): Phaser.GameObjects.Container {
    return this.statValuesContainer;
  }

  // #region Initialization methods

  initSplicedIcon(pokemon: Pokemon, baseWidth: number) {
    this.splicedIcon.setPositionRelative(
      this.nameText,
      baseWidth + this.genderText.displayWidth + 1 + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0),
      2.5,
    );
    this.splicedIcon.setVisible(pokemon.isFusion(true));
    this.splicedIcon
      .on("pointerover", () =>
        globalScene.ui.showTooltip(
          "",
          `${pokemon.species.getName(pokemon.formIndex)}/${pokemon.fusionSpecies?.getName(pokemon.fusionFormIndex)}`,
        ),
      )
      .on("pointerout", () => globalScene.ui.hideTooltip());
  }

  /**
   * Called by {@linkcode initInfo} to initialize the shiny icon
   * @param pokemon - The pokemon object attached to this battle info
   * @param baseXOffset - The x offset to use for the shiny icon
   * @param doubleShiny - Whether the pokemon is shiny and its fusion species is also shiny
   */
  protected initShinyIcon(pokemon: Pokemon, xOffset: number, doubleShiny: boolean) {
    const baseVariant = doubleShiny ? pokemon.variant : pokemon.getVariant(true);

    this.shinyIcon.setPositionRelative(
      this.nameText,
      xOffset
        + this.genderText.displayWidth
        + 1
        + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0)
        + (this.splicedIcon.visible ? this.splicedIcon.displayWidth + 1 : 0),
      2.5,
    );
    this.shinyIcon
      .setTexture(`shiny_star${doubleShiny ? "_1" : ""}`)
      .setVisible(pokemon.isShiny())
      .setTint(getVariantTint(baseVariant));

    this.shinyIcon
      .on("pointerover", () => globalScene.ui.showTooltip("", i18next.t("common:shinyOnHover") + shinyDescriptor))
      .on("pointerout", () => globalScene.ui.hideTooltip());

    if (!this.shinyIcon.visible) {
      return;
    }

    let shinyDescriptor = "";
    if (doubleShiny || baseVariant) {
      shinyDescriptor = " (" + getShinyDescriptor(baseVariant);
      if (doubleShiny) {
        shinyDescriptor += "/" + getShinyDescriptor(pokemon.fusionVariant);
      }
      shinyDescriptor += ")";
    }
  }

  /**
   * Local fork (2026-11-17): set the mark icons for the Pokémon, from the left end of the row under the name.
   * @param pokemon - The Pokémon this info is for
   * @param visible - Whether to show them; the enemy's give way when there is no room next to a status
   */
  protected updateMarkIcons(pokemon: Pokemon, visible = true): void {
    const shownMarks = [
      ...new Set([
        ...(pokemon.equippedMark !== null && pokemon.marks.includes(pokemon.equippedMark)
          ? [pokemon.equippedMark]
          : []),
        ...pokemon.marks.filter(m => WILD_MARKS.includes(m) || m === PokemonMark.MINI_MARK),
      ]),
    ];
    this.shownMarkCount = Math.min(shownMarks.length, this.markIcons.length);
    this.markIcons.forEach((icon, i) => {
      const mark = shownMarks[i];
      icon.setVisible(mark !== undefined && visible);
      if (mark !== undefined) {
        icon.setFrame(getMarkKey(mark)).setPosition(this.nameTextBaseX + i * MARK_ICON_PITCH, this.nameText.y + 11.75);
      }
    });
  }

  /** The width the shown mark icons take in the row under the name */
  protected getMarkIconsWidth(): number {
    return this.markIcons.filter(icon => icon.visible).length * MARK_ICON_PITCH;
  }

  initInfo(pokemon: Pokemon) {
    this.updateNameText(pokemon);
    this.updateMarkIcons(pokemon);
    const nameTextWidth = this.nameText.displayWidth;

    this.name = pokemon.getNameToRender({ prependFormName: false });
    this.box.name = pokemon.getNameToRender({ prependFormName: false });

    this.genderText
      .setText(getGenderSymbol(pokemon.gender))
      .setColor(getGenderColor(pokemon.gender))
      .setPositionRelative(this.nameText, nameTextWidth, 0);

    this.lastTeraType = pokemon.getTeraType();

    this.teraIcon
      .setVisible(pokemon.isTerastallized)
      .on("pointerover", () => {
        if (pokemon.isTerastallized) {
          globalScene.ui.showTooltip(
            "",
            i18next.t("fightUiHandler:teraHover", {
              type: i18next.t(getPokemonTypeLocaleKey(this.lastTeraType)),
            }),
          );
        }
      })
      .on("pointerout", () => globalScene.ui.hideTooltip())
      .setPositionRelative(this.nameText, nameTextWidth + this.genderText.displayWidth + 1, 2);

    const isFusion = pokemon.isFusion(true);
    this.initSplicedIcon(pokemon, nameTextWidth);

    const doubleShiny = isFusion && pokemon.shiny && pokemon.fusionShiny;
    this.initShinyIcon(pokemon, nameTextWidth, doubleShiny);

    this.fusionShinyIcon.setVisible(doubleShiny).copyPosition(this.shinyIcon);
    if (isFusion) {
      this.fusionShinyIcon.setTint(getVariantTint(pokemon.fusionVariant));
    }
    // Local fork (2026-11-17): the alpha badge comes last
    this.updateAlphaBadge(pokemon);

    this.hpBar.setScale(pokemon.getHpRatio(true), 1);
    this.lastHpFrame = this.hpBar.scaleX > 0.5 ? "high" : this.hpBar.scaleX > 0.25 ? "medium" : "low";
    this.hpBar.setFrame(this.lastHpFrame);
    this.lastHp = pokemon.hp;
    this.lastMaxHp = pokemon.getMaxHp();

    this.setLevelDisplay(pokemon.level);

    this.shinyIcon.setVisible(pokemon.isShiny());

    this.setTypes(pokemon.getTypes({ useIllusion: true }));

    const stats = this.statOrder.map(() => 0);

    this.lastStats = stats.join("");
    this.updateStats(stats);
  }

  // #endregion Initialization methods

  /**
   * Return the texture name of the battle info box
   */
  abstract getTextureName(): string;

  setMini(_mini: boolean): void {}

  toggleStats(visible: boolean): void {
    globalScene.tweens.add({
      targets: this.statsContainer,
      duration: fixedInt(125),
      ease: "Sine.easeInOut",
      alpha: visible ? 1 : 0,
    });
  }

  setOffset(offset: boolean): void {
    if (this.offset === offset) {
      return;
    }

    this.offset = offset;

    this.x += 10 * (this.offset === this.player ? 1 : -1);
    this.y += 27 * (this.offset ? 1 : -1);
    this.baseY = this.y;
  }

  // #region Update methods and helpers

  /**
   * Update the status icon to match the pokemon's current status
   * @param pokemon - The pokemon object attached to this battle info
   * @param xOffset - The offset from the name text
   */
  updateStatusIcon(pokemon: Pokemon, xOffset = this.getMarkIconsWidth()) {
    if (this.lastStatus !== (pokemon.status?.effect || StatusEffect.NONE)) {
      this.lastStatus = pokemon.status?.effect || StatusEffect.NONE;

      if (this.lastStatus !== StatusEffect.NONE) {
        this.statusIndicator.setFrame(StatusEffect[this.lastStatus].toLowerCase());
      }

      this.statusIndicator.setVisible(!!this.lastStatus);
    }
    // Local fork (2026-11-17): from the left end of the row, after the mark icons (and the enemy's other icons), not
    // from the name, which a title moves right; placed every time, since the marks can change without the status
    this.statusIndicator.setPosition(this.nameTextBaseX + xOffset, this.nameText.y + 11.5);
  }

  /** Update the pokemon name inside the container */
  protected updateName(pokemon: Pokemon): boolean {
    const name = pokemon.getNameToRender({ prependFormName: false });
    if (this.lastName === name && this.lastTitle === getPokemonTitle(pokemon)) {
      return false;
    }

    this.updateNameText(pokemon);
    this.genderText.setPositionRelative(this.nameText, this.nameText.displayWidth, 0);

    return true;
  }

  protected updateTeraType(ty: PokemonType): boolean {
    if (this.lastTeraType === ty) {
      return false;
    }

    this.teraIcon
      .setVisible(ty !== PokemonType.UNKNOWN)
      .setTint(Phaser.Display.Color.GetColor(...getTypeRgb(ty)))
      .setTintMode(Phaser.TintModes.FILL)
      .setPositionRelative(this.nameText, this.nameText.displayWidth + this.genderText.displayWidth + 1, 2);
    this.lastTeraType = ty;

    return true;
  }

  /**
   * Update the type icons to match the pokemon's types
   */
  setTypes(types: PokemonType[]): void {
    this.type1Icon
      .setTexture(`pbinfo_${this.player ? "player" : "enemy"}_type${types.length > 1 ? "1" : ""}`)
      .setFrame(PokemonType[types[0]].toLowerCase());
    this.type2Icon.setVisible(types.length > 1);
    this.type3Icon.setVisible(types.length > 2);
    if (types.length > 1) {
      this.type2Icon.setFrame(PokemonType[types[1]].toLowerCase());
    }
    if (types.length > 2) {
      this.type3Icon.setFrame(PokemonType[types[2]].toLowerCase());
    }
  }

  /**
   * Called by {@linkcode updateInfo} to update the position of the tera, spliced, and shiny icons
   * @param isFusion - Whether the pokemon is a fusion or not
   */
  protected updateIconDisplay(isFusion: boolean): void {
    this.teraIcon.setPositionRelative(this.nameText, this.nameText.displayWidth + this.genderText.displayWidth + 1, 2);
    this.splicedIcon
      .setVisible(isFusion)
      .setPositionRelative(
        this.nameText,
        this.nameText.displayWidth
          + this.genderText.displayWidth
          + 1
          + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0),
        1.5,
      );
    this.shinyIcon.setPositionRelative(
      this.nameText,
      this.nameText.displayWidth
        + this.genderText.displayWidth
        + 1
        + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0)
        + (this.splicedIcon.visible ? this.splicedIcon.displayWidth + 1 : 0),
      2.5,
    );
  }

  // #region HP Bar Display handling

  /**
   * Called every time the hp frame is updated by the tween
   * @param pokemon - The pokemon object attached to this battle info
   */
  protected updateHpFrame(): void {
    const hpFrame = this.hpBar.scaleX > 0.5 ? "high" : this.hpBar.scaleX > 0.25 ? "medium" : "low";
    if (hpFrame !== this.lastHpFrame) {
      this.hpBar.setFrame(hpFrame);
      this.lastHpFrame = hpFrame;
    }
  }

  /**
   * Called by every frame in the hp animation tween created in {@linkcode updatePokemonHp}
   * @param _pokemon - The pokemon the battle-info bar belongs to
   */
  protected onHpTweenUpdate(_pokemon: Pokemon): void {
    this.updateHpFrame();
  }

  /** Update the pokemonHp bar */
  protected updatePokemonHp(pokemon: Pokemon, resolve: (r: void | PromiseLike<void>) => void, instant?: boolean): void {
    let duration = instant ? 0 : Phaser.Math.Clamp(Math.abs(this.lastHp - pokemon.hp) * 5, 250, 5000);
    const speed = settings.general.hpBarSpeed;
    if (speed) {
      duration = speed >= 3 ? 0 : duration / Math.pow(2, speed);
    }
    globalScene.tweens.add({
      targets: this.hpBar,
      ease: "Sine.easeOut",
      scaleX: pokemon.getHpRatio(true),
      duration,
      onUpdate: () => {
        this.onHpTweenUpdate(pokemon);
      },
      onComplete: () => {
        this.updateHpFrame();
        resolve();
      },
    });
    this.lastMaxHp = pokemon.getMaxHp();
  }

  // #endregion HP Bar Display handling

  async updateInfo(pokemon: Pokemon, instant?: boolean): Promise<void> {
    let resolve: (r: void | PromiseLike<void>) => void = () => {};
    const promise = new Promise<void>(r => (resolve = r));

    if (!globalScene || !this.active) {
      return resolve();
    }

    const gender: Gender = pokemon.summonData?.illusion?.gender ?? pokemon.gender;

    this.genderText.setText(getGenderSymbol(gender)).setColor(getGenderColor(gender));

    const nameUpdated = this.updateName(pokemon);

    const teraTypeUpdated = this.updateTeraType(pokemon.isTerastallized ? pokemon.getTeraType() : PokemonType.UNKNOWN);

    const isFusion = pokemon.isFusion(true);

    if (nameUpdated || teraTypeUpdated) {
      this.updateIconDisplay(isFusion);
    }
    // Local fork (2026-11-17): the alpha badge follows the icons, every time: a Pokémon can become an alpha without
    // its name changing (the shiny icon's visibility is settled further down, but its position is not)
    this.updateAlphaBadge(pokemon);

    this.updateMarkIcons(pokemon);
    this.updateStatusIcon(pokemon);

    this.setTypes(pokemon.getTypes({ useIllusion: true }));

    if (this.lastHp !== pokemon.hp || this.lastMaxHp !== pokemon.getMaxHp()) {
      this.updatePokemonHp(pokemon, resolve, instant);
    }

    const stats = pokemon.getStatStages();
    const statsStr = stats.join("");

    if (this.lastStats !== statsStr) {
      this.updateStats(stats);
      this.lastStats = statsStr;
    }

    this.shinyIcon.setVisible(pokemon.isShiny(true));

    const doubleShiny = isFusion && pokemon.shiny && pokemon.fusionShiny;
    const baseVariant = doubleShiny ? pokemon.variant : pokemon.getVariant(true);
    this.shinyIcon.setTint(getVariantTint(baseVariant));

    this.fusionShinyIcon.setVisible(doubleShiny).setPosition(this.shinyIcon.x, this.shinyIcon.y);
    if (isFusion) {
      this.fusionShinyIcon.setTint(getVariantTint(pokemon.fusionVariant));
    }

    resolve();
    await promise;
  }

  /**
   * Local fork (2026-11-17): the widest the name may be drawn before {@linkcode updateNameText} shortens it, so that
   * it and the icons after it stay clear of "Lv". Taken out of updateNameText unchanged, with the alpha badge's room
   * added (so it can be tested).
   * @param pokemon - The Pokémon this info is for
   * @returns The width in pixels
   */
  protected getNameWidthLimit(pokemon: Pokemon): number {
    const gender = pokemon.summonData.illusion?.gender ?? pokemon.gender;
    const levelDigits = pokemon.level.toString().length;
    // Local fork (2026-11-13): 08 명세 4번 (Endless levels up to ~320,000), the level container moves 8px left per digit
    // past the third (setLevelDisplay), so the name gets 8px less per such digit too: before, a 5-digit level's "Lv"
    // already covered the end of a long name and a 6-digit one covered about 12px of it. Levels under 1000 are unchanged.
    return (
      (this.player || !this.boss ? 60 : 98)
      - ((gender === Gender.GENDERLESS ? 0 : 6)
        + (pokemon.fusionSpecies ? 8 : 0)
        + (pokemon.isShiny() ? 8 : 0)
        + (Math.min(levelDigits, 3) - 3) * 8
        + Math.max(levelDigits - 3, 0) * 8
        // Local fork (2026-11-17): room for the alpha badge (updateAlphaBadge), which comes after the name and its
        // icons; without it a long name pushed the badge over "Lv". Levels under 100 give the name the 8px per missing
        // digit above, which the badge needs, so it takes that back: the name ends where a 3-digit level's would, 2px
        // earlier
        + (pokemon.isAlpha() ? 2 + 8 * (3 - Math.min(levelDigits, 3)) : 0))
    );
  }

  updateNameText(pokemon: Pokemon): void {
    let displayName = pokemon.getNameToRender({ prependFormName: false }).replace(/[♂♀]/g, "");
    let nameTextWidth: number;

    const nameSizeTest = addTextObject(0, 0, displayName, TextStyle.BATTLE_INFO);
    nameTextWidth = nameSizeTest.displayWidth;

    // Local fork (2026-11-17): the limit is worked out in getNameWidthLimit, which also leaves room for the alpha badge.
    const allowance = this.getNameWidthLimit(pokemon);

    // Local fork (2026-11-17): the title takes its room from the same allowance. The name keeps up to TITLE_NAME_MIN
    // px of it; the title is cut to what the name leaves and dropped if not even two letters fit
    let title = getPokemonTitle(pokemon);
    this.lastTitle = title;
    this.titleText.setText(title);
    const titleRoom = allowance - Math.min(nameTextWidth, TITLE_NAME_MIN) - TITLE_GAP;
    while (title.length > 0 && this.titleText.displayWidth > titleRoom) {
      title = title.length > 2 ? `${title.slice(0, title.endsWith(".") ? -2 : -1).trimEnd()}.` : "";
      this.titleText.setText(title);
    }
    const titleWidth = title ? this.titleText.displayWidth + TITLE_GAP : 0;
    this.nameText.setX(this.nameTextBaseX + titleWidth);
    // The length guard stops the loop at "." if a huge level ever leaves no room at all (it would never end otherwise).
    while (displayName.length > 1 && nameTextWidth > allowance - titleWidth) {
      displayName = `${displayName.slice(0, displayName.endsWith(".") ? -2 : -1).trimEnd()}.`;
      nameSizeTest.setText(displayName);
      nameTextWidth = nameSizeTest.displayWidth;
    }

    nameSizeTest.destroy();

    this.nameText.setText(displayName);
    this.lastName = pokemon.getNameToRender({ prependFormName: false });

    if (this.nameText.visible) {
      this.nameText.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, this.nameText.width, this.nameText.height),
        Phaser.Geom.Rectangle.Contains,
      );
    }
  }

  /**
   * Set the level numbers container to display the provided level
   *
   * @remarks
   * The numbers in the pokemon's level uses images for each number rather than a text object with a special font.
   * This method sets the images for each digit of the level number and then positions the level container based
   * on the number of digits.
   *
   * @param level - The level to display
   * @param textureKey - The texture key for the level numbers
   */
  public setLevelDisplay(level: number, textureKey: "numbers" | "numbers_red" = "numbers"): void {
    this.levelNumbersContainer.removeAll(true);
    const levelStr = level.toString();
    for (let i = 0; i < levelStr.length; i++) {
      this.levelNumbersContainer.add(globalScene.add.image(i * 8, 0, textureKey, levelStr[i]));
    }
    this.levelContainer.setX(this.baseLvContainerX - 8 * Math.max(levelStr.length - 3, 0));
  }

  updateStats(stats: number[]): void {
    for (const [i, s] of this.statOrder.entries()) {
      if (s !== Stat.HP) {
        this.statNumbers[i].setFrame(stats[s - 1].toString());
      }
    }
  }

  // #endregion Update methods and helpers

  getBaseY(): number {
    return this.baseY;
  }

  resetY(): void {
    this.y = this.baseY;
  }
}
