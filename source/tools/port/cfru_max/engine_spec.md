# PokeRogue move-animation engine: spec for the CFRU Max / G-Max / Max Guard generator

Local fork, 2026-11-18. Written from the fork's source in `D:/PokeRogueDev/pokerogue` (read only). Every rule here was read
in the code at the `file:line` given. Paths without a folder are relative to `D:/PokeRogueDev/pokerogue`.
`src/data/battle-anims.ts` is upstream code and is unchanged in this fork. The Z / Max logic is fork code in
`src/data/moves/move-transform.ts` and `src/data/moves/zmax-data.ts`.

Terms:

- **anim frame**: one entry of `frames`. It lasts 50 ms.
- **cel**: one object inside an anim frame.
- **field px**: one logical pixel of the battle field. The `field` container is scaled ×6, so the screen is 320×180 field px.
- **anim space**: the x / y numbers written in the JSON.

---

## 1. Pipeline: from a used move to a played animation

1. **Choosing the id.** `getAnimMoveId(move)` (`src/data/moves/move-transform.ts:394-409`) maps the move a slot behaves
   as to the `MoveId` whose animation plays. It is the only place where Z / Max / G-Max moves choose an animation. These
   callers use it:
   - `Pokemon.loadAssets` preloads the moveset (`src/field/pokemon.ts:937`). The enemy and the player both go through it.
   - `MoveEffectPhase` plays the animation (`src/phases/move-effect-phase.ts:198-199`).
   - Applying a conversion item loads the new animation (`src/modifier/zmax-items.ts:419-420`).
2. **Fetching the JSON.** `initMoveAnim(id)` (`src/data/battle-anims.ts:436-500`) fetches
   `./battle-anims/<toKebabCase(MoveId[id])>.json` once per session and caches it in `moveAnims` (`:415`).
3. **Loading assets.** `loadMoveAnimAssets(ids)` (`:608-625`) → `loadAnimAssets` (`:627-664`) queues the sprite sheet,
   the backgrounds and the sounds in Phaser's loader.
4. **Playing.** `new MoveAnim(id, user, targetBattlerIndex).play(onSubstitute, cb)` (`:1346-1371`, `play` at `:840`)
   plays once per target.
5. **Startup preload.** At startup `BattleScene` preloads TACKLE, TAIL_WHIP, FOCUS_ENERGY and STRUGGLE as fallbacks
   (`src/battle-scene.ts:424-430`).
6. **Switches that stop playback.** Nothing plays if Settings → Move Animations is off (`:920-922`), or if the target is
   not on the field (`:845-850`).

## 2. File names: MoveId → JSON path

- The rule is `./battle-anims/${toKebabCase(MoveId[move])}.json` (`src/data/battle-anims.ts:464`).
- On disk the file is `assets/battle-anims/<name>.json`.
- `toKebabCase` is in `src/utils/strings.ts:27-34,143-147`. For the all-caps enum names it does three things:
  - lowercases the name;
  - turns every run of `_`, `-` or space into one `-`;
  - trims delimiters from both ends.
- The same rule in Python (`tools/port/essentials_anims.py:374-376`):

  ```python
  re.sub(r"[-_ ]+", "-", name.strip("_")).lower()
  ```

- Examples:
  - `MAX_FLARE` → `max-flare.json`
  - `G_MAX_WILDFIRE` → `g-max-wildfire.json`
  - `MAX_GUARD` → `max-guard.json`
  - `BREAKNECK_BLITZ__PHYSICAL` → `breakneck-blitz-physical.json` (the double `_` becomes one `-`)

### All target ids

None of these has a file yet. The test `test/tests/custom/custom-zmax-anims.test.ts:150-162` currently asserts that
some of them have none. The enum is in `src/enums/move-id.ts`.

**Max moves.** `MAX_GUARD` is at :1490 and the 18 attacks at :1518-1552:

| MoveId | file |
|---|---|
| MAX_FLARE | max-flare.json |
| MAX_FLUTTERBY | max-flutterby.json |
| MAX_LIGHTNING | max-lightning.json |
| MAX_STRIKE | max-strike.json |
| MAX_KNUCKLE | max-knuckle.json |
| MAX_PHANTASM | max-phantasm.json |
| MAX_HAILSTORM | max-hailstorm.json |
| MAX_OOZE | max-ooze.json |
| MAX_GEYSER | max-geyser.json |
| MAX_AIRSTREAM | max-airstream.json |
| MAX_STARFALL | max-starfall.json |
| MAX_WYRMWIND | max-wyrmwind.json |
| MAX_MINDSTORM | max-mindstorm.json |
| MAX_ROCKFALL | max-rockfall.json |
| MAX_QUAKE | max-quake.json |
| MAX_DARKNESS | max-darkness.json |
| MAX_OVERGROWTH | max-overgrowth.json |
| MAX_STEELSPIKE | max-steelspike.json |
| MAX_GUARD | max-guard.json |

**G-Max moves.** There are 33, at `src/enums/move-id.ts:1896-1960`. The fork appended them after the custom moves. The
commented-out copy at :1705-1737 is not the live one.

| MoveId | file |
|---|---|
| G_MAX_WILDFIRE | g-max-wildfire.json |
| G_MAX_BEFUDDLE | g-max-befuddle.json |
| G_MAX_VOLT_CRASH | g-max-volt-crash.json |
| G_MAX_GOLD_RUSH | g-max-gold-rush.json |
| G_MAX_CHI_STRIKE | g-max-chi-strike.json |
| G_MAX_TERROR | g-max-terror.json |
| G_MAX_RESONANCE | g-max-resonance.json |
| G_MAX_CUDDLE | g-max-cuddle.json |
| G_MAX_REPLENISH | g-max-replenish.json |
| G_MAX_MALODOR | g-max-malodor.json |
| G_MAX_STONESURGE | g-max-stonesurge.json |
| G_MAX_WIND_RAGE | g-max-wind-rage.json |
| G_MAX_STUN_SHOCK | g-max-stun-shock.json |
| G_MAX_FINALE | g-max-finale.json |
| G_MAX_DEPLETION | g-max-depletion.json |
| G_MAX_GRAVITAS | g-max-gravitas.json |
| G_MAX_VOLCALITH | g-max-volcalith.json |
| G_MAX_SANDBLAST | g-max-sandblast.json |
| G_MAX_SNOOZE | g-max-snooze.json |
| G_MAX_TARTNESS | g-max-tartness.json |
| G_MAX_SWEETNESS | g-max-sweetness.json |
| G_MAX_SMITE | g-max-smite.json |
| G_MAX_STEELSURGE | g-max-steelsurge.json |
| G_MAX_MELTDOWN | g-max-meltdown.json |
| G_MAX_FOAM_BURST | g-max-foam-burst.json |
| G_MAX_CENTIFERNO | g-max-centiferno.json |
| G_MAX_VINE_LASH | g-max-vine-lash.json |
| G_MAX_CANNONADE | g-max-cannonade.json |
| G_MAX_DRUM_SOLO | g-max-drum-solo.json |
| G_MAX_FIREBALL | g-max-fireball.json |
| G_MAX_HYDROSNIPE | g-max-hydrosnipe.json |
| G_MAX_ONE_BLOW | g-max-one-blow.json |
| G_MAX_RAPID_FLOW | g-max-rapid-flow.json |

**Fork-only.** `MAX_SWORDS_DANCE` (다이검무, :1962) → `max-swords-dance.json`. CFRU has no counterpart. It falls back to
Swords Dance (§11).

**Z다이 moves have no MoveIds of their own.** A Z다이 slot is `{kind: "zMax", moveId: <the Max move>}`
(`move-transform.ts:517-560`). Its derived move is a clone of the Max move's registry entry, so it keeps that `id`
(`cloneMove`, `:211-222`, `Object.assign`). The three cases:

- Z다이 attacks have `id` = `MAX_<TYPE>`.
- Z다이월 has `id` = `MAX_GUARD`.
- Z다이검무 has `id` = `MAX_SWORDS_DANCE`.

A Z다이 move therefore plays its Max move's file. A separate Z다이 file is impossible without new MoveIds or a new
animation-key scheme (§11).

Reference tables:

- `MAX_MOVE_BY_TYPE`: `src/data/moves/zmax-data.ts:1051-1070`.
- G-Max per species (`GMAX_MOVES`): `zmax-data.ts:1164+`.
- Every Z / Max / G-Max id (`ZMAX_ONLY_MOVES`): `zmax-data.ts:1434-1541`.

## 3. Loading, caching, and missing files

### Fetching the JSON (`initMoveAnim`, `battle-anims.ts:436-500`)

- **Cache marker.** `moveAnims.set(move, null)` marks the fetch as in flight. Later calls poll every 50 ms (`:438-452`).
- **Fallback id** (`:456-460`):
  - attack moves → TACKLE;
  - self-status moves → FOCUS_ENERGY;
  - other moves → TAIL_WHIP.
- **Success** (`:474-487`):
  - A JSON object is stored as one `AnimConfig`.
  - A JSON array is stored as `[AnimConfig(ba[0]), AnimConfig(ba[1])]` (`populateMoveAnim`, `:575-582`).
- **404, or a content-type that is not `application/json`** (`:467-471`). `useDefaultAnim` stores a copy of the
  fallback, and `logMissingMoveAnim` prints `console.warn("Could not load animation file for move '<kebab>'")`.
  - Quirk: the promise chain then still runs `.then(ba => …)` with `ba = undefined`. `populateMoveAnim(move, undefined)`
    turns the entry into `[fallbackCopy, emptyAnimConfig]`.
  - Effect for a **player** user: the fallback's frames play with **no sounds**. `new AnimConfig(anAnimConfig)` loses
    `frameTimedEvents`, because `Object.keys(Map)` is `[]`.
  - Effect for an **enemy** user: the entry is an array, so `isOppAnim()` is true and `[1]` (empty) is played.
    **Nothing is shown.**
- **JSON parse error, or the constructor throws** (for example `frameTimedEvents` is missing): `.catch` (`:489-493`)
  stores a single fallback copy, with no sounds, for both sides.
- **Offline app.** It serves `.json` as `application/json` (`offline-app/main.js:31`) and a missing file as 404
  (`main.js:128-130`). Its self-test fails on any 404 except `manifest.json` (`offline-app/selftest.sh:47,56`).
  - Consequence: **never let the game fetch a file that does not exist.** Fallbacks for missing files are decided in
    `getAnimMoveId` from a static list of files that exist (§11), not by `initMoveAnim`.
- **Tests.** In tests every `./battle-anims/` fetch is answered with `tackle.json` (`test/setup/vitest.setup.ts:104`).
  Tests that check the real files read them with `node:fs`.

### Loading the assets (`loadAnimAssets`, `:627-664`)

- **Skipped configs.** An anim object with `frames.length === 0` loads nothing (`:632-634`).
- **Sprite sheet.**
  - `globalScene.loadSpritesheet(a.graphic, "battle_anims", 96)` (`:644`, `src/scene-base.ts:47-60`).
  - URL: `images/battle_anims/<graphic>.png` (disk: `assets/images/battle_anims/<graphic>.png`).
  - Texture key: `<graphic>`.
  - The sheet is cut into 96×96 frames with no margin or spacing. Frames are numbered row-major:
    `columns = floor(w/96)`, `rows = floor(h/96)`. A partial right column or bottom row is ignored.
  - The essentials port wrote 5-column sheets. That is a convention, not a requirement.
  - Out-of-range `graphicFrame`: Phaser warns "Frame missing" and draws frame 0
    (`node_modules/phaser/src/textures/Texture.js:253-271`).
  - Every new graphic sprite is created with frame `1` (`battle-anims.ts:955`), then switched to the cel's frame. A
    1-frame sheet therefore logs a harmless warning. Prefer at least 2 frames.
  - **One sheet per anim object.** Every GRAPHIC cel of an object uses `AnimConfig.graphic`. Pack all particles and
    palette variants of a move into that one sheet. The two objects of a `[player, opponent]` array may use different
    sheets; both are loaded (`loadMoveAnimAssets` flat-maps the array, `:610`).
- **Backgrounds.**
  - Each `AnimTimedAddBgEvent.resourceName` with text loads through `loadImage(bg, "battle_anims")` (`:647-649`,
    `scene-base.ts:33-45`): a plain image from the **same folder**, `images/battle_anims/<resourceName>.png`.
  - Texture key: `<resourceName>`, with no extension.
  - Only AddBg names are loaded. UpdateBg names are ignored (`getBackgroundResourceNames`, `:86-98`).
- **Sounds.**
  - Each `AnimTimedSoundEvent.resourceName` with text loads through `loadSe(s, "battle_anims", s)` (`:650-652`,
    `scene-base.ts:87-100`).
  - The key is `battle_anims/<resourceName>` and the URL is `audio/battle_anims/<resourceName>`.
  - `resourceName` **includes the file extension**, for example `"PRSFX- Protect.wav"`.
  - Nothing is loaded when audio is disabled.
  - The folder has 1278 `.wav`, 135 `.m4a` and 1 `.WAV`. Use files that exist; nothing converts GBA sounds.
- **Texture keys are global.** Sheets and backgrounds share Phaser's texture namespace. A key that is already loaded is
  not loaded again, so the first image under a name wins. Give every new image a **new unique name**, for example the
  prefix `CFRU- `. Never reuse an existing name for a different picture. Spaces in names are fine: upstream uses
  `"PRAS- Protect"`.
- **Missing sheet or background.** The loader 404s and sprites show Phaser's missing-texture placeholder. In the offline
  app the self-test fails.
- **Missing sound.** The loader 404s, `playSound` warns "not found" (`src/audio/audio-manager.ts:239-241`), and the
  event adds no hold.

## 4. Single object vs `[player, opponent]`

- `MoveAnim.getAnim()` (`battle-anims.ts:1356-1360`):
  - single object → that object for both sides;
  - array → `[0]` when `user.isPlayer()`, else `[1]`.
- `isOppAnim()` (`:1362-1364`) is `!user.isPlayer() && Array.isArray(entry)`.
- **Single object used by an enemy.** No swap: `user` is the enemy (top right) and `target` is the player (bottom left).
  - USER / TARGET focus follow the real battlers.
  - x offsets relative to them are **not mirrored**. "+16 x of the user" is in front of a player user but behind an
    enemy user.
  - USER_TARGET interpolates enemy → player and flips GRAPHIC cels horizontally (§6). Angles are **not** mirrored, so a
    rotated USER_TARGET graphic points the wrong way for an enemy user.
- **Array, `[1]` used by an enemy.** `isOppAnim` is true, so the code swaps `user` and `target` (`:776-778`,
  `:841-843`). The opponent version is authored in **screen terms**, with the attacker at the top-right slot:
  - AnimFocus.USER and Pokémon cels with `target: 0` mean the **bottom-left battler**, which is the move's target (the
    player).
  - AnimFocus.TARGET and `target: 1` mean the **top-right battler**, which is the attacker (the enemy).
  - USER_TARGET runs from (0,0), the bottom-left player, to (128,-64), the top-right enemy, with no flip.
  - Upstream example: `protect.json`. The player version puts the shield at focus USER (2), x 16, y -8. The opponent
    version puts it at focus TARGET (1), x 111, y -58.
- **When to write an array.** Write `[player, opponent]` whenever the choreography is directional and not symmetric
  (beams, projectiles, sweeping particles, rotated sprites). The opponent version is the player version transformed:
  - swap USER and TARGET focus;
  - swap cel targets 0 and 1;
  - re-express positions as the screen positions they should have when the attacker is top right.

  CFRU / the GBA mirror attacker-relative x offsets at run time, from attacker x vs target x
  (`SetAnimSpriteInitialXOffset`). PokeRogue does not, so the generator must write the mirrored opponent version itself.
- **Usage upstream.** 333 of the 978 upstream files are arrays.
- `MoveChargeAnim` has the same pattern (`:1375-1393`).

## 5. JSON schema

### Top level

One object or a 2-element array of objects. Parsed by `AnimConfig` (`battle-anims.ts:22-71`).

| field | type | required | meaning |
|---|---|---|---|
| `graphic` | string | yes (the zmax test requires truthy) | sheet name without `.png`, in `images/battle_anims/`. `""` means no sheet; GRAPHIC cels then render the missing texture |
| `frames` | `Cel[][]` | yes (`.map` is called) | `frames[i]` holds the cels shown in anim frame i. `[]` is an allowed (empty) frame |
| `frameTimedEvents` | `{ "<frame>": Event[] }` | **yes**: `Object.keys(undefined)` throws (§3) | keys are parsed with `parseInt`. A key ≥ `frames.length` never fires. Write `{}` when there are none |
| `position` | int | no | stored, never used in playback. Upstream holds Essentials' 1-4 |
| `hue` | int | no | stored, never used. Write 0 |
| `id` | int | no | stored, never used. Upstream files have it; the essentials port omits it |

### Cel

Parsed by `ImportedAnimFrame` (`:228-266`). It calls `AnimFrame` with `init = true` (`:102-226`).

**The "missing" column below is the parsed value, not a sensible default. Always write the fields marked yes.**

| field | write | missing → | units / meaning |
|---|---|---|---|
| `x`, `y` | **yes** | undefined → NaN position | anim-space px (§6). Used as is when `init` is true (`:144-145`) |
| `zoomX`, `zoomY` | **yes** | **0**, invisible (`:151-160`) | percent. 100 = the texture at 1:1 in field px |
| `angle` | when ≠ 0 | 0 | degrees. **Positive = counter-clockwise on screen**: the engine applies `setAngle(-angle)` (`:831`), and Phaser's angle is clockwise. Pivot: sprite centre |
| `mirror` | when true | false | flips horizontally (`scaleX × -1`, `:795`) |
| `visible` | **yes** | **false** (`:171-175`) | per cel, per frame |
| `blendType` | when ≠ 0 | 0 NORMAL | 0 NORMAL, 1 ADD (Phaser ADD, func ONE/DST_ALPHA), 2 "SUBTRACT", mapped to Phaser DIFFERENCE (`:1014-1020`, `:1078-1083`). **WebGL has no DIFFERENCE, so 2 renders as NORMAL** (`WebGLRenderer.js:733-744`). Use only 0 and 1 |
| `target` | **yes** | undefined crashes `getGraphicFrameData` | 0 = USER Pokémon, 1 = TARGET Pokémon, 2 = GRAPHIC (`AnimFrameTarget`, `src/enums/move-anims-common.ts:1-5`). After the §4 swap, 0 / 1 mean screen slots in the opponent version |
| `graphicFrame` | **yes** (0 for Pokémon cels) | undefined | 0-based frame of the 96×96 sheet. The zmax test requires it to be `< floor(w/96)*floor(h/96)` even on invisible cels |
| `opacity` | **yes** | **0**, invisible (`:194-198`) | 0-255 → alpha `opacity/255` |
| `tone` | when ≠ 0 | [0,0,0,0] | `[r,g,b,gray]`. **Applied to Pokémon cels only** (§9) |
| `color` | no effect | [0,0,0,0] | parsed (`:199-203`), **never applied** |
| `flash` | no effect | [0,0,0,0] | parsed, **never applied** |
| `locked` | true on Pokémon cels | false | Pokémon cels only. Keeps the Pokémon copy alive through frames without its cel and through the end hold (§7). Ignored on graphics: `getData("locked")` is set only on Pokémon copies (`:1088`) |
| `priority` | **yes** on graphics | **0** (`:219-223`) | draw layer of a GRAPHIC cel (§8). Ignored on Pokémon cels. Upstream values are 0-4; 4 acts like 1 |
| `focus` | **yes** | 0 or missing → **1 TARGET** (`:224`) | 1 TARGET, 2 USER, 3 USER_TARGET, 4 SCREEN (`move-anims-common.ts:7-12`) |

The canonical stay-in-place Pokémon cels, which every upstream Essentials file opens each frame with:

```json
{"x":0,"y":0,"zoomX":100,"zoomY":100,"visible":true,"target":0,"graphicFrame":0,"opacity":255,"locked":true,"priority":1,"focus":2}
{"x":128,"y":-64,"zoomX":100,"zoomY":100,"visible":true,"target":1,"graphicFrame":0,"opacity":255,"locked":true,"priority":1,"focus":1}
```

`protect.json` uses focus 3 at the same coordinates. That is equivalent.

### Events

Parsed at `:44-64`. An unknown `eventType` is dropped silently.

**`AnimTimedSoundEvent`** (`:280-318`)

- Fields: `{frameIndex, resourceName, volume, pitch, eventType}`.
- **Write `volume` and `pitch` always.** The constructor copies `source.volume` / `source.pitch` even when they are
  undefined, which gives NaN.

**`AnimTimedAddBgEvent`** (`:386-416`)

- Fields: `{frameIndex, resourceName, bgX, bgY, opacity, duration, eventType}`.
- Write all of them.

**`AnimTimedUpdateBgEvent`** (`:358-384`)

- Fields: `{frameIndex, resourceName: "", [bgX], [bgY], [opacity], duration, eventType}`.
- Leave out the fields that should not change: undefined ones are skipped (`:361-369`).
- **Write `duration` always.** If it is missing, NaN breaks the tween and the hold.

For all events, `frameIndex` inside the event is not used. The map key decides the frame. Write both, with the same
value.

## 6. Coordinates (`getGraphicFrameData`, `battle-anims.ts:764-837`)

### Constants (`:672-675`)

- `userFocus = (106, 116)`, which is `148 - 32`.
- `targetFocus = (234, 52)`, which is `84 - 32`.
- The default single-battle battlers stand with their **feet** at (106, 148) for the player
  (`src/field/pokemon.ts:6552`) and (236, 84) for the enemy (`pokemon.ts:7234-7235`).
- In doubles, `getFieldPositionOffset` (`pokemon.ts:1418-1427`) adds LEFT (-32, -8) and RIGHT (+32, 0).
- Every computed position is in the `field` container (field px).

### Anim space

- (0,0) is the user's centre and (128,-64) is the target's centre.
- Each cel first gets `X = x + 106` and `Y = y + 116` (`:793-794`). The focus then moves it.
- Notation:
  - `U` is the (possibly swapped, §4) user's container position: its feet, `user.x` / `user.y`.
  - `T` is the target's: the substitute doll's position when the move hits a substitute (`:784-786`).
  - `uH` / `tH` are half of `getSprite().displayHeight`. That is the sprite's own height, **without the container
    scale**.

| focus | field position of the cel |
|---|---|
| 1 TARGET (`:798-801`) | `(T.x + (x - 128), T.y - tH + (y + 64))`. The target centre is (128,-64) |
| 2 USER (`:802-805`) | `(U.x + x, U.y - uH + y)`. The user centre is (0,0) |
| 3 USER_TARGET (`:806-829`) | per-axis linear map of the segment (0,0)→(128,-64) onto user centre → target centre: `fx = U.x + (x/128)·(T.x - U.x)`, `fy = (U.y-uH) + (-y/64)·((T.y-tH) - (U.y-uH))`. GRAPHIC cels get `scaleX × -1` when the user is right of the target (`isReversed`, `:731-739`) |
| 4 SCREEN | no case in the switch: `(x + 106, y + 116)`, fixed in field px. Screen corners in anim space: (-106,-116) top-left to (214,64) bottom-right; screen centre ≈ (54,-26). Does not follow the battlers (doubles, substitutes) |

- **Self-targeting moves (Max Guard).** `target === user`. The USER_TARGET segment has zero length, so **every
  USER_TARGET point collapses onto the user's centre**. Use USER or TARGET focus for Max Guard.
- **Scale and angle** (`:795-797,831`):
  - `scaleX = zoomX/100 × (mirror ? -1 : 1) × (reversed USER_TARGET graphic ? -1 : 1)`;
  - `scaleY = zoomY/100`;
  - `angle = -angle`.
- **Pokémon cels.**
  - The copy has origin (0.5, 0.5). (x, y) is its **centre**.
  - It is scaled by `zoom × container scale` and shifted up by `height/2 × (containerScale - 1)` (`:1072-1093`).
  - No reversal flip is applied.
  - Container scale: G-Max form or Dynamax state ×1.5, alpha ×1.1, Mini Mark ×0.9 (`getSpriteScale`,
    `pokemon.ts:1319+`).
  - Graphic positions use the unscaled `tH`. On a ×1.5 Pokémon, "the target centre" lands 0.25 × height below its
    visual centre.
- **Field zoom.** The fork zooms the `field` container out for big Pokémon (`setFieldScale`,
  `src/battle-scene.ts:1811-1834`). Everything in the animation, the background included, zooms with it.
- **Day / night tint.** GRAPHIC sprites are field sprites (`addFieldSprite`, `battle-scene.ts:2146-2156`). They get the
  biome's time-of-day tint, like all upstream effects. Backgrounds do not.

## 7. Timing

- **Frame length.** One anim frame is `getFrameMs(3)` = floor(1000/60 × 3) = **50 ms** (`:938`,
  `src/utils/common.ts:159-169`). In GBA terms that is **3 GBA frames (60 fps) per anim frame**: sample CFRU's
  per-frame sprite callbacks every 3rd frame, and divide `delay N` by 3.
- **Driver.** A Phaser counter with `repeat = frames.length` runs `onRepeat` once per frame (`:937-1121`).
  - Frame i is drawn at t = (i+1) × 50 ms.
  - The last frame stays for 50 ms.
  - Then `onComplete` (`:1122-1136`) runs.
- **Hold.** `r` is updated as `r = max(frames.length - f + ret, r)` at every event (`:1095-1101`), then decremented
  once per frame. When the frames end, the code waits **`max(ret over all executed events)` × 16.67 ms**, or 0 with no
  events. This value does not depend on which frame the event was on. `ret` per event type:
  - sound: `ceil(soundSeconds × 1000 / 33.33)` (`:306`). A 1 s sound adds about 0.5 s of hold.
  - AddBg / UpdateBg: `duration × 2` (`:378,410`).
- **At `onComplete`:** every GRAPHIC sprite and every **unlocked** Pokémon copy is destroyed. The real battler sprites
  stay hidden until `cleanUpAndComplete` (`:864-923`). Without `locked: true` on the Pokémon cels, the Pokémon
  **disappear during the hold**.
- **Cleanup.** The background is destroyed only at cleanup. A background fade must finish before that:
  `fadeStartFrame + duration ≤ frames.length - 1`, since a fade lasts `duration` anim frames (§10).
- **Real sprites hidden at frame 0.** The real sprites of the (swapped) user and target are hidden at frame 0
  (`:941-944`). From then on, the only visible Pokémon are the cel copies.
- **Consequences:**
  - A frame without a `target: 0` cel shows no user, unless the copy is locked.
  - A frame without a `target: 1` cel shows no target, unless locked.
  - **Put the user cel and the target cel in every frame, as cels [0] and [1], with `locked: true`.**
  - For a self move, a USER cel is skipped (`:1023-1025`) and the TARGET cel draws the user. The standard pair still
    works.
- **End of play.** The sprites' visibility is restored, unless the move has HIDE_USER / HIDE_TARGET (`:1366-1372`), and
  the callback runs (damage, etc.).

## 8. Sprites per frame, slots, and draw order

- **No cap.** There is no limit on cels per frame. Upstream's maximum is 31 cels in a frame (`steam-eruption.json`).
  Each GRAPHIC cel gets its own sprite.
- **Slots.** The g-th GRAPHIC cel of a frame always drives cached sprite g (`:949-1021`). The same holds for Pokémon
  cels: u-th USER cel → user copy u, t-th TARGET cel → target copy t.
- **Shrinking frames.** If a frame has fewer cels of a kind than the cache, the trailing sprites are destroyed. Locked
  Pokémon copies are spared (`:1102-1118`).
- **No tweening.** Each cel sets every property every frame, so slots carry only identity, z-order and the remembered
  priority.
- **Stable slots.** Keep every particle in a stable slot. Pad a finished particle with an invisible cel
  (`visible: false`, a valid `graphicFrame`) when the z-order of later slots matters.
- **Creation order is z-order.** New sprites are appended **on top** of the field container: Pokémon copies through
  `field.add`, `:1056/1062`; graphics at `:955-957`. So:
  - Pokémon copies created in frame 0 sit above everything that existed before the animation.
  - A graphic created later sits above them.
  - If a GRAPHIC cel comes **before** the Pokémon cels in frame 0, the Pokémon copies are created after it and cover
    it. This is one more reason to keep cels [0] and [1] the Pokémon.
- **Priority** (`:968-1003`). It is applied only when a slot's priority **changes**. A new slot starts at 1, so a
  priority-1 sprite simply stays where it was created: on top.

| priority | what the code does | practical result |
|---|---|---|
| 1, 4, ≥4 | `bringToTop` if changed, else stays at the top where it was created | **in front of everything**, Pokémon included |
| 0 | `moveBelow` the first enemy field Pokémon container (or the player's) | **behind the Pokémon copies**. A background added later lands between them and covers it |
| 2 | with a background: `moveAbove(bg)`. Without: `moveBelow` the focus battler's (hidden) container (USER / TARGET focus), else `bringToTop` | behind the Pokémon, above the background **if the background existed when the priority was applied**. With USER_TARGET / SCREEN focus and no background: top |
| 3 | `moveAbove` the focus battler's hidden container (USER / TARGET focus), else `bringToTop` | USER / TARGET focus: still below the copies, so behind the Pokémon. USER_TARGET / SCREEN: top |

`this.user` / `this.target` in that code are the **unswapped** ones.

- **Recommendation.** Use priority 1 for effects in front. Use 2 for "behind the Pokémon, over the background", and let
  such a sprite first appear (or switch to 2) at least one frame **after** its AddBg event. Events run after the cels of
  their frame.

## 9. Opacity, blend, tone

What each kind of cel actually gets:

- **GRAPHIC sprite** (`:1006-1020`): frame, position, angle, scale, `alpha = opacity/255`, `visible`, blend mode.
  **No tone, color, flash or hue.** Tint particles by baking the palette into the sheet; one sheet can hold several
  palette copies.
- **Pokémon copy** (`:1084-1093`): position, angle, scale, `locked`, alpha, **tone**, visible (also hidden if the real
  battler is invisible), blend mode.

Tone in the shader (`src/render-nodes/glsl/sprite-frag-shader.frag:226-231`, colour channels 0..1):

```glsl
float luma = dot(color.rgb, lumaF);
color.rgb = mix(color.rgb, vec3(luma), tone.w);
color.rgb += tone.rgb * (color.a / 255.0);
```

- `tone[0..2]` (−255..255) add `tone/255` to each channel, so ±255 gives full white or black.
- `tone[3]` (gray) is used **raw as the GLSL mix factor**.
  - 0 means none; 1 means fully gray; fractional values work (the uniform is a float).
  - Upstream PRAS files carry Essentials values up to 255. Those extrapolate far past gray (inverted, clamped colours)
    and only look sane when rgb is also ±255.
  - **Use gray 0, or 0..1 for a real desaturation.**
- **Approximating a GBA palette blend** (`BlendPalette(color, coeff/16)`) with an additive tone:
  `tone ≈ (C_target − ~128) × 2 × coeff/16` per channel. Use `[255,255,255,0]` for a white flash and
  `[-255,-255,-255,0]` for a black silhouette.
- **Whole-screen flashes** cannot use tone. Use a background (§10). Note that it stays **behind** the Pokémon.

## 10. Background events

**AddBg** (`battle-anims.ts:386-416`):

- It destroys any current background.
- It creates a `tileSprite(bgX - 320, bgY - 284, 896, 576, resourceName)`. An empty `resourceName` creates a **black**
  `rectangle` of the same size instead.
- Origin (0,0), **scale 1.25**, `alpha = opacity/255` **immediately** (no fade-in).
- It is placed `moveBelow` the enemy field Pokémon container. That is above the arena platforms, under all Pokémon
  copies and GRAPHIC sprites. The biome background image (`arenaBg`) is outside `field` and gets covered.
- The battle UI (`fieldUI`, depth 1) stays above it.
- Its own tween has no properties. `duration` here only adds `2 × duration` to the hold.
- **AddBg `bgX` / `bgY` are in field px.**

**Coverage and tiling:**

- The sprite covers field x ∈ [bgX - 320, bgX + 800] and y ∈ [bgY - 284, bgY + 436] (1120 × 720 field px).
- The texture **repeats** inside it from the sprite's top-left corner.
- With bgX = bgY = 0, the visible window of the texture is x ∈ [256, 512) and y ∈ [227.2, 371.2), taken modulo the
  texture size.
  - For the usual 256×192 PRAS background that is the full width and rows 35.2–179.2 (144 rows), shown ×1.25 =
    320×180.
- To show a texture's top-left 256×144 at the screen's top-left with no wrap, use AddBg `bgX = 320, bgY = 284`.
  - The texture must be at least 256×144; it is shown ×1.25.
  - UpdateBg events must then use `bgX = 640, bgY = 568` to hold that position.
- The screen stays fully covered while:
  - AddBg: bgX ∈ [−480, 320], bgY ∈ [−256, 284];
  - UpdateBg: bgX ∈ [−960, 640], bgY ∈ [−512, 568].
- Upstream backgrounds: 72 × 256×192, 17 × 256×144, 6 × 640×576, plus a few odd sizes.

**UpdateBg** (`:358-384`):

- It tweens the current background's x to `bgX × 0.5 − 320`, y to `bgY × 0.5 − 284` and alpha to `opacity/255`. Only
  the defined fields are tweened.
- The tween lasts `getFrameMs(duration × 3)` = **`duration` anim frames (50 ms each)**, with Phaser's default linear
  ease.
- **UpdateBg `bgX` / `bgY` are half-units**, which is Essentials' 512×384 screen. The scale differs from AddBg's.
- It moves the sprite (scroll), not `tilePosition`.
- **Never emit an UpdateBg before the first AddBg.** The tween target would be undefined. The essentials port drops
  those (`tools/port/essentials_anims.py:675-678`).
- To fade in: AddBg with `opacity: 0`, then an UpdateBg with `opacity: 255, duration: d`.
- To fade out: UpdateBg `opacity: 0`.
- The background is removed only at cleanup or by the next AddBg.
- The zmax test rejects any AddBg whose background is never seen: opacity 0 at add with no later opacity > 0
  (`custom-zmax-anims.test.ts:107-125,179-186`).
- **Concurrent plays.** Each target gets its own MoveAnim, so a spread move stacks backgrounds. Max / G-Max derived
  moves always have one target (`move-transform.ts:300`).

## 11. Sound events

- **Effective config** (`:290-303`):
  - `rate = pitch/100`, which changes speed and pitch together;
  - `volume = volume/100` × the Field volume setting × **0.5 if the name starts with `"PRSFX- "`**
    (`audio-manager.ts:219-228`);
  - values are percents; upstream mostly uses 100/100 or 80/100.
- **Empty `resourceName`** plays the **user's cry** (the unswapped `battleAnim.user`), and its length counts toward the
  hold (`:308-312`).
- **Sound key** is `battle_anims/<resourceName>`.
- The animation never stops a sound. A sound longer than about twice the hold keeps playing after the move.

## 12. How Z / Max moves choose an animation today, and the changes needed

### Today (`getAnimMoveId`, `src/data/moves/move-transform.ts:394-409`)

Steps in order:

1. `ZMAX_OWN_ANIM_MOVES.has(move.id)` → `move.id`. The set is at `:104-159`: 36 Z ids and 16 exclusive Z ids, 52 in all.
2. `MAX_GUARD` → `PROTECT` (`:398-400`).
3. `MAX_SWORDS_DANCE` → `SWORDS_DANCE` (`:401-403`).
4. A converted slot → its base move (`:404-407`). This is the path for Max, G-Max and Z다이 attacks.
5. A Z / Max registry entry outside a slot → TACKLE. Anything else → `move.id` (`:408`).

### Changes needed so Max / G-Max / Max Guard / Z다이 moves play their own files

1. **`src/data/moves/move-transform.ts:104-159`.** Add to `ZMAX_OWN_ANIM_MOVES` every MoveId for which a file was
   **actually written**: `MAX_<TYPE>`, `MAX_GUARD`, `G_MAX_*`, and optionally `TEN_MILLION_VOLT_THUNDERBOLT` (CFRU has
   Z-move animations too). Nothing else.
   - Step 1 runs first, so no logic change is needed. The results:
     - Max moves play `max-<type>.json`.
     - G-Max moves play `g-max-*.json`.
     - Max Guard and Z다이월 play `max-guard.json`.
     - Z다이 attacks play their Max move's file, because they share its id (§2).
   - Ids left out keep today's fallbacks (Protect, Swords Dance, the base move, Tackle), so a missing file never causes
     a fetch.
   - Update the doc comments at `:95-103` and `:383-393`. They say "every Max and G-Max move and Max Guard have no
     animation there".
   - Optional, for a partial G-Max set: before step 4, return the type's Max move file. The lookup is
     `findGmaxInfoByMove(move.id)?.type` → `MAX_MOVE_BY_TYPE`, and it applies only if that id is in the set
     (`findGmaxInfoByMove` is at `:238-240`).
   - Optional: a Max-only "Dynamax aura" prelude would need new design. `getAnimMoveId` returns one MoveId, and the file
     name is derived from it.
   - Z다이 moves cannot get their own file: no MoveIds exist for them. Adding enum entries means appending at the end
     (movesets are saved by numeric id), plus registry entries. Not recommended.
   - `MAX_SWORDS_DANCE` keeps the Swords Dance fallback unless a `max-swords-dance.json` is written.
2. **Nothing changes in the callers.** `battle-anims.ts`, `pokemon.ts:937`, `move-effect-phase.ts:198-199` and
   `zmax-items.ts:419-420` all go through `getAnimMoveId`.
3. **`test/tests/custom/custom-zmax-anims.test.ts`** must follow the new set:
   - `:139-148`: "lists exactly …" compares the set with the files. It works unchanged, but the `size` of 52 at `:147`
     must become 52 + the number of new files.
   - `:150-162`: keep only the ids that still have no file (`MAX_SWORDS_DANCE`, and `TEN_MILLION_VOLT_THUNDERBOLT` if
     it is not written).
   - `:164-186`: every member must parse and meet the file rules:
     - more than 10 frames;
     - a truthy `graphic`;
     - the sheet exists;
     - every GRAPHIC `graphicFrame` is inside the sheet;
     - the backgrounds and sounds exist;
     - every background is seen.

     The new files get this check automatically.
   - `:237-261`: expected values change. `{max, MAX_FLARE}` → `MAX_FLARE`. `{gmax, G_MAX_MELTDOWN}` →
     `G_MAX_MELTDOWN`. `{zMax, MAX_FLARE}` → `MAX_FLARE`. Max Guard, max and zMax → `MAX_GUARD`. 다이검무 and the Z status
     move stay.
   - `:263-272`: `allMoves[MAX_FLARE]` → `MAX_FLARE`, `G_MAX_WILDFIRE` → itself, `MAX_GUARD` → `MAX_GUARD`. The loop
     stays valid.
   - `:302-337` (in battle): `animIds` should become `[GIGAVOLT_HAVOC__SPECIAL, MAX_FLARE]`, and `played` should
     contain `MAX_FLARE`.
   - Update the header comment `:23-32`.
   - Possibly add CFRU checks:
     - every Max move and Max Guard is listed;
     - Max Guard has no USER_TARGET graphics (§6);
     - every array has 2 elements.
4. **Run the tests.** The memory rule after any fork change: run `offline-app/test_and_update.sh` (tests plus a fast
   update). Its self-test fails on any 404.

## 13. Build, offline app, registration

- **Nothing to register.** No asset manifest lists animation files.
  - `dist/asset-manifest.json` only names the JS entry, CSS and preloads (`plugins/vite/static-shell-plugin.ts:100-127`, written at `:170`).
  - The timestamp manifest `/manifest.json` (`src/init/init-manifest.ts`) does not exist locally, so `getCachedUrl`
    adds nothing (`src/utils/fetch-utils.ts:3-15`).
- **Dev server.** It serves `assets/` as `publicDir` (`vite.config.ts:88`).
- **Build.** `vite build --mode app` copies all of `assets/` into `dist/` (`plugins/vite/vite-minify-json-plugin.ts`).
  - JSON files are minified.
  - Anything whose name **contains** `.config.ts`, `.editorconfig`, `.git`, `.test.ts`, `LICENSE`, `README.md`,
    `REUSE.toml`, `biome.jsonc`, `lefthook.yml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or
    `tsconfig.json` is skipped. Keep those substrings out of file names.
- **Offline app.** `offline-app/fast_update.sh` mirrors `dist/` into `D:/PokeRogueOffline/resources/game` with
  `robocopy /MIR` and runs `selftest.sh`. The app serves those files through `app://` (`offline-app/main.js:111-132`).
  No list to update.
- **Git.** `assets/` is a git submodule: new files show up as untracked there.

## 14. How the Z-move port did it (conventions to mirror)

`tools/port/essentials_anims.py`, header at `:1-40`:

- **JSON output.** It writes `assets/battle-anims/<kebab>.json` (compact, `separators=(",",":")`,
  `ensure_ascii=False`, trailing `\n`, `:948-951`).
  - It writes the same object to both MoveIds of a Z type.
  - It writes an array when an `OppMove:` animation exists.
  - It never overwrites upstream files unless `--overwrite` (`:916-919`).
- **Images.**
  - Output: `assets/images/battle_anims`.
  - Sheets are laid out exactly 5 columns of 96 wide, with whole rows padded (`as_sheet`, `:722-736`).
  - New names avoid clashes: `"<name> (Essentials)"` when an existing image differs (`GraphicPlanner`, `:817-885`).
  - An existing sheet is reused only if every used frame is pixel-identical.
- **Sounds.** Only existing game files are used. Missing ones are dropped and listed (`:902-910`). The extra PRSFX
  sounds were converted to 16-bit `.wav` separately (`tools/port/essentials_anim_sounds.py`).
- **Manifest.** `tools/port/essentials_anims_manifest.json` lists `json`, `images`, `imagesReused`, `skippedUpstream`,
  `missingSounds`, `notes`, `entries` and `missing`.
  - A rerun refreshes only the files the tool wrote earlier, and deletes the ones it no longer writes (`:963-975`).
  - Suggested for this generator: `tools/port/cfru_max/cfru_max_manifest.json`, the same idea, and a `CFRU- ` name
    prefix.
- **Pokémon cels** (`convert_cel`, `:600-639`): `priority` defaults to 1 and `focus` defaults to 4 when Essentials left
  them unset.

### Credits

Three places were updated by hand, not by the tool:

- **`CREDITS.md`, section "## Local fork assets" (`:792`).** One bullet "Local fork (2026-11-18), Z-Move battle
  animations: …" (`:839-854`). It names:
  - the moves;
  - the source and authors;
  - the conversion tool;
  - the new sheets and backgrounds;
  - the new sounds and their tool;
  - the terms file.
- **Root `REUSE.toml`.** One `[[annotations]]` block (`:145-318`):
  - a comment with the source, the tool, the manifest and the user's request;
  - `path = [ "assets/battle-anims/….json", "assets/images/battle_anims/….png", "assets/audio/battle_anims/….wav" ]`,
    which lists every new file;
  - `SPDX-FileCopyrightText`;
  - `SPDX-License-Identifier = "LicenseRef-POKEMON-REBORN"`, whose text is in root `LICENSES/`.
  - `prepare.py` copies `LICENSES/` to `offline-app/docs/licenses/code` (`offline-app/prepare.py:93-100`).
- **`offline-app/docs/CREDITS.txt`, section "Additions in this modified build" (`:21`).** A hand-written bullet
  (`:62-67`).
- **For CFRU (Skeli789/Complete-Fire-Red-Upgrade):**
  - The repository has **no LICENSE file**. Its README asks for no money to be made from the work, which fits this
    local, non-commercial fork, and points to a `Credits.txt` in the repo.
  - Add `LICENSES/LicenseRef-CFRU.txt` quoting those terms, with the source URL.
  - Add a REUSE block for the new files with `SPDX-FileCopyrightText` naming Skeli and the CFRU contributors.
  - Add a CREDITS.md bullet and a CREDITS.txt bullet. They should also credit the particle sheets' origin: Game Freak
    or the decomp's graphics as CFRU ships them.

## 15. Generator checklist

1. **One file per MoveId** in §2. Name it with the kebab rule. The content is an object, or `[player, opponent]` for
   directional moves (§4).
2. **Top level.** Always write `graphic` (non-empty), `frames` (more than 10 for the test), `frameTimedEvents` (`{}`
   minimum), `position`, `hue: 0`.
3. **Pokémon cels.** Every frame starts with the two Pokémon cels: target 0 at focus 2 (0,0) and target 1 at focus 1
   (128,-64). Both use zoom 100, opacity 255, `visible: true`, `locked: true`, `priority: 1`. Move them for
   recoil or shake, and use their `tone` for Pokémon colour flashes.
4. **Every cel** writes `x`, `y`, `zoomX`, `zoomY`, `visible`, `target`, `graphicFrame`, `opacity`, `priority`,
   `focus`. `angle` is counter-clockwise positive. `blendType` is only 0 or 1.
5. **Slots.** GRAPHIC cels use stable slots. Every `graphicFrame` must exist in the sheet (96×96 cells, row-major,
   `floor(w/96)` columns), invisible cels included.
6. **Sheets.** One new sheet per animation object, with a new unique name (`CFRU- …`), in
   `assets/images/battle_anims/`. The particles are already coloured; graphics take no tone.
7. **Backgrounds** are new images with unique names in the same folder:
   - AddBg uses field-px offsets; UpdateBg uses half-units.
   - Fade-ins go through UpdateBg; no UpdateBg before the first AddBg.
   - The last fade must end before the final frame.
   - Every added background must become visible.
   - An empty-name AddBg is a black screen.
8. **Sounds.** Use existing files in `assets/audio/battle_anims/`, extension included. Always write `volume` and
   `pitch`.
9. **Max Guard** is a self move: use USER or TARGET focus, never USER_TARGET.
10. **Timing.** 3 GBA frames = 1 anim frame (50 ms). The hold after the end is `max(event ret) × 16.67 ms`.
11. **Code and tests.** Add exactly the written ids to `ZMAX_OWN_ANIM_MOVES`, update the zmax test (§12), credits
    (§14) and the manifest. Then run `offline-app/test_and_update.sh`.

## 16. GBA → anim space (guidance, not engine fact)

- **Battler coordinates.** pokefirered's `sBattlerCoords` (`src/battle_anim_mons.c`) for a single battle:
  - attacker (player) (72, 80);
  - opponent (176, 40);
  - doubles: (32,80), (200,40), (90,88), (152,32).
  
  These are approximate sprite centres on the 240×160 screen. Pic offset and elevation are applied through
  `BATTLER_COORD_Y_PIC_OFFSET`.
- **Per-axis mapping.** Mapping user (72,80) → (0,0) and target (176,40) → (128,-64) gives scale ×1.231 on x and ×1.6
  on y:

  ```
  x = (gx - 72) × 128/104
  y = (gy - 80) × 64/40
  ```

  This is exactly how USER_TARGET interpolates, so a GBA path between the battlers maps cleanly to USER_TARGET points.
- **Uniform size scale.** For sizes and offsets around a single battler (USER / TARGET focus), a uniform ×1.25 to
  ×1.333 keeps a particle's screen fraction: the GBA is 240 wide and the field is 320. That means `zoom ≈ 125–133` for a
  particle packed 1:1 in its 96×96 cell, or pre-scale the art.
- **Mirroring.** CFRU and the GBA mirror attacker-relative x offsets when attacker x > target x
  (`SetAnimSpriteInitialXOffset`). Do that in the generated opponent version (§4).
- **Screen effects.** GBA BG-layer effects (BG scroll and blend, `fadetobg`, `blendcolor` on BGs) map to AddBg /
  UpdateBg. OBJ palette blends on battler sprites map to Pokémon-cel `tone`. Palette blends on particles must be baked
  into extra sheet frames.
