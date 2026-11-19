import type { BattleScene } from "#app/battle-scene";
import type { Phase } from "#app/phase";
import { PHASE_INTERCEPTOR_COLOR, PHASE_START_COLOR } from "#constants/colors";
import { UiMode } from "#enums/ui-mode";
import { TEST_TIMEOUT } from "#test/constants";
import type { GameManager } from "#test/framework/game-manager";
import type { PromptHandler } from "#test/helpers/prompt-handler";
import { getEnumStr } from "#test/utils/string-utils";
import type { PhaseString } from "#types/phase-types";
import { inspect } from "util";
import chalk from "chalk";
import { vi } from "vitest";

/**
 * The interceptor's current state.
 * Possible values are the following:
 * - `running`: The interceptor is currently running a phase.
 * - `interrupted`: The interceptor has been interrupted by a UI prompt or similar mechanism,
 *    and is waiting for the current phase to end.
 * - `idling`: The interceptor is not currently running a phase and is ready to start a new one.
 */
type StateType = "running" | "interrupted" | "idling";

/**
 * The PhaseInterceptor is a wrapper around the `BattleScene`'s {@linkcode PhaseManager}.
 * It allows tests to exert finer control over the phase system, providing logging, manual advancing, and other helpful utilities.
 */
export class PhaseInterceptor {
  private readonly scene: BattleScene;
  /**
   * A log containing all phases having been executed in FIFO order. \
   * Entries are appended each time {@linkcode run} is called, and can be cleared manually with {@linkcode clearLogs}.
   */
  public readonly phaseLog: PhaseString[] = [];
  /**
   * The interceptor's current state.
   * @see {@linkcode StateType}
   * @defaultValue `idling`
   */
  private state: StateType = "idling";
  /** The current target that is being ran to. */
  private target: PhaseString;
  /**
   * Local fork (2026-11-19): A6, random failures in full runs. The interceptor of the newest {@linkcode GameManager}
   * in this worker. Tests share one scene per worker (`isolate: false`), so a test that timed out inside
   * {@linkcode to} left its polling loop running and starting phases of the next test for up to 20 more seconds.
   */
  private static current: PhaseInterceptor | undefined;
  /** Local fork (2026-11-19): set once a newer interceptor took over the scene; stops this one's {@linkcode to} loop */
  private disposed = false;

  /**
   * Initialize a new PhaseInterceptor.
   * @param scene - The scene to be managed
   * @remarks
   * This overrides {@linkcode PhaseManager.startCurrentPhase} to toggle the interceptor's state
   * instead of immediately starting the next phase.
   */
  // TODO: This should take a `GameManager` instance once multi-scene things become a reality
  // (though our entire Phase system will likely have to be redone anyways)
  constructor(scene: BattleScene) {
    // Local fork (2026-11-19): A6. Retire the previous test's interceptor (see `current`)
    if (PhaseInterceptor.current) {
      PhaseInterceptor.current.disposed = true;
    }
    PhaseInterceptor.current = this;
    this.scene = scene;
    // Persistently stub out `this.scene.phaseManager.getCurrentPhase`
    // to toggle the interceptor's state (rather than starting a new phase).
    // We do not use `vi.spyOn` as that will reset once the test ends
    this.scene.phaseManager["startCurrentPhase"] = () => {
      this.state = "idling";
    };
  }

  /**
   * Method to transition to a target phase.
   * @param target - The name of the {@linkcode Phase} to transition to
   * @param runTarget - Whether or not to run the target phase before resolving; default `true`
   * @returns A Promise that resolves once `target` has been reached.
   * @remarks
   * This will not resolve for _any_ reason until the target phase has been reached.
   * @example
   * ```ts
   * await game.phaseInterceptor.to("MoveEffectPhase", false);
   * ```
   */
  public async to(target: PhaseString, runTarget = true): Promise<void> {
    this.target = target;

    const pm = this.scene.phaseManager;

    let currentPhase = pm.getCurrentPhase();
    let didLog = false;

    // NB: This has to use an interval to wait for UI prompts to activate
    // since our UI code effectively stalls when waiting for input.
    // This entire function can likely be made synchronous once UI code is moved to a separate scene.
    await vi.waitUntil(
      async () => {
        // Local fork (2026-11-19): A6. A newer test owns the scene now: stop here (the error ends the timed-out test's
        // remaining code, whose result vitest no longer reports) instead of running the newer test's phases
        this.throwIfDisposed();
        // If we were interrupted by a UI prompt, we assume that the calling code will queue inputs to
        // end the current phase manually, so we just wait for the phase to end from the caller.
        if (this.state === "interrupted") {
          if (!didLog) {
            this.log("PhaseInterceptor.to: Waiting for phase to end after being interrupted!");
            didLog = true;
          }
          return false;
        }

        currentPhase = pm.getCurrentPhase();
        if (currentPhase.is(this.target)) {
          return true;
        }

        // Current phase is different; run and wait for it to finish.
        await this.run(currentPhase);
        return false;
      },
      { interval: 0, timeout: TEST_TIMEOUT },
    );

    // We hit the target; run as applicable and wrap up.
    if (!runTarget) {
      this.log(`PhaseInterceptor.to: Stopping before running ${this.target}`);
      return;
    }

    await this.run(currentPhase);
    this.log(
      `PhaseInterceptor.to: Stopping ${this.state === "interrupted" ? `after reaching ${getEnumStr(UiMode, this.scene.ui.mode)} during` : "on completion of"} ${this.target}`,
    );
  }

  /**
   * Internal wrapper method to start a phase and wait until it finishes.
   * @param currentPhase - The {@linkcode Phase} to run
   * @returns A Promise that resolves when the phase has completed running.
   */
  private async run(currentPhase: Phase): Promise<void> {
    try {
      this.state = "running";
      this.logPhase(currentPhase.phaseName);
      currentPhase.start();
      // Local fork (2026-11-19): A6. A retired interceptor stops waiting (see `disposed`)
      await vi.waitUntil(
        () => {
          this.throwIfDisposed();
          return this.state !== "running";
        },
        { interval: 50, timeout: TEST_TIMEOUT },
      );
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`Unknown error occurred while running phase ${currentPhase.phaseName}!\nError: ${inspect(error)}`);
    }
  }

  /**
   * Local fork (2026-11-19): A6. Stop a retired interceptor's polling (see {@linkcode disposed}).
   * @throws Error once a newer interceptor took over the scene
   */
  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error("PhaseInterceptor: a newer test took over the scene; stopping this timed-out test's phase loop");
    }
  }

  /**
   * If this is at the target phase, unlock the interceptor and
   * return control back to the caller once the calling phase has finished.
   * @remarks
   * This should not be called by anything other than {@linkcode PromptHandler}.
   */
  public checkMode(): void {
    const currentPhase = this.scene.phaseManager.getCurrentPhase();
    if (!currentPhase.is(this.target) || this.state === "interrupted") {
      // Wrong phase / already interrupted = do nothing
      return;
    }

    // Interrupt the phase and return control to the caller
    this.state = "interrupted";
  }

  /**
   * Skip the next upcoming phase.
   * @throws Error if currently running a phase.
   * @remarks
   * This function should be used for skipping phases _not yet started_.
   * To end ones already in the process of running, use {@linkcode GameManager.endPhase}.
   * @example
   * await game.phaseInterceptor.to("LoginPhase", false);
   * game.phaseInterceptor.shiftPhase(); // skips LoginPhase without starting it
   */
  public shiftPhase(): void {
    const phaseName = this.scene.phaseManager.getCurrentPhase().phaseName;
    if (this.state !== "idling") {
      throw new Error(`PhaseInterceptor.shiftPhase attempted to skip phase ${phaseName} mid-execution!`);
    }
    this.log(`Skipping current phase: ${phaseName}`);
    this.scene.phaseManager.shiftPhase();
  }

  /**
   * Method to log the start of a phase.
   * Called in place of {@linkcode PhaseManager.startCurrentPhase} to allow for manual intervention.
   * @param phaseName - The name of the phase to log
   */
  private logPhase(phaseName: PhaseString): void {
    console.log(`%cStart Phase: ${phaseName}`, `color:${PHASE_START_COLOR}`);
    this.phaseLog.push(phaseName);
  }

  /**
   * Clear all prior phase logs.
   */
  public clearLogs(): void {
    this.phaseLog.splice(0, this.phaseLog.length);
  }

  /**
   * Wrapper function to add coral coloration to phase logs.
   * @param args - Arguments to original logging function
   */
  private log(...args: unknown[]): void {
    console.log(chalk.hex(PHASE_INTERCEPTOR_COLOR)(...args));
  }
}
