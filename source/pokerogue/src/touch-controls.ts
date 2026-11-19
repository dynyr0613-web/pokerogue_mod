import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { TouchChoicePanel } from "#app/touch-choices";
import { Button } from "#enums/buttons";
import { UiTheme } from "#enums/ui-theme";
import { UiWindowStyle } from "#enums/ui-window-style";
import { hasTouchscreen } from "#utils/app-utils";
import { enumValueToKey } from "#utils/enums";
import i18next from "i18next";
import type Phaser from "phaser";

const repeatInputDelayMillis = 250;

/** Fork: touch buttons that must not auto-repeat while held (the keyboard doesn't repeat them either). */
const nonRepeatingKeys: ReadonlySet<string> = new Set(["MENU", "STATS"]);

/** Fork: how long a touch button buzzes when "Vibration" is on (ms). */
const touchVibrationMillis = 10;

/**
 * Fork: readable names for the small buttons ([Korean, English]). The portrait phone layout in `index.css`
 * shows `data-long` instead of the keyboard letter; landscape keeps the letters.
 */
const forkButtonLabels: Record<string, readonly [ko: string, en: string]> = {
  // plain < > because the game font has no ◀ ▶ (they would fall back to a system or emoji font)
  apadPreviousTab: ["< 탭", "< Tab"],
  apadNextTab: ["탭 >", "Tab >"],
  apadOpenFilters: ["필터", "Filter"],
  apadMenu: ["메뉴", "Menu"],
  apadCycleForm: ["폼", "Form"],
  apadCycleGender: ["성별", "Gender"],
  apadCycleShiny: ["이로치", "Shiny"],
  apadCycleAbility: ["특성", "Ability"],
  apadCycleNature: ["성격", "Nature"],
  apadCycleTera: ["테라", "Tera"],
  apadInfo: ["정보", "Info"],
  apadStats: ["능력치", "Stats"],
};

/** Fork: screens where a button does something else than its usual name says. */
const forkModeLabels: Partial<Record<string, Record<string, readonly [ko: string, en: string]>>> = {
  // Menu submits the team (starts the run) in starter select
  STARTER_SELECT: { apadMenu: ["시작", "Start"] },
  // C toggles the stats page in a Pokédex entry
  POKEDEX_PAGE: { apadOpenFilters: ["능력치", "Stats"] },
  // F / R / E in a past run's details
  RUN_INFO: {
    apadCycleForm: ["엔딩", "Ending"],
    apadCycleShiny: ["전당", "Fame"],
    apadCycleAbility: ["도구", "Items"],
  },
};

export class TouchControl {
  readonly events: Phaser.Events.EventEmitter;
  private buttonLock: string[] = [];
  private readonly inputInterval: NodeJS.Timeout[] = [];
  /** Whether touch controls are disabled */
  private disabled = false;
  /** Whether the last touch event has finished before disabling */
  private finishedLastTouch = false;

  constructor() {
    this.events = globalScene.game.events;
    this.init();
  }

  /**
   * Disable touch controls
   */
  disable() {
    this.disabled = true;
    this.finishedLastTouch = false;
  }

  /**
   * Enable touch controls
   */
  enable() {
    this.disabled = false;
    this.finishedLastTouch = false;
  }

  /**
   * Initialize touch controls by binding keys to buttons.
   */
  init() {
    // Select all elements with the 'data-key' attribute and bind keys to them
    for (const button of document.querySelectorAll("[data-key]")) {
      // @ts-expect-error - Bind the key to the button using the dataset key
      this.bindKey(button, button.dataset.key);
    }
    this.initForkButtons();
  }

  /** Fork: the fullscreen and vibration toggles. They have no `data-key`, so they never reach the game's input. */
  private initForkButtons(): void {
    if (!hasTouchscreen()) {
      return;
    }
    // Some names depend on the screen (see forkModeLabels); ui.ts writes the screen into data-ui-mode
    const touchControls = document.getElementById("touchControls");
    if (touchControls) {
      new MutationObserver(() => this.applyForkLabels()).observe(touchControls, {
        attributes: true,
        attributeFilter: ["data-ui-mode"],
      });
    }

    // big buttons for the current menu's choices (step 3), pressing through this same touch path
    const choices = document.getElementById("touchChoices");
    if (choices) {
      new TouchChoicePanel(choices, button => {
        const key = Button[button];
        if (this.simulateKeyboardEvent("keydown", key)) {
          this.simulateKeyboardEvent("keyup", key);
        }
      });
    }

    const fullscreen = document.getElementById("apadFullscreen");
    if (fullscreen) {
      if (document.fullscreenEnabled) {
        fullscreen.addEventListener("click", event => {
          event.preventDefault();
          // not while the controls are being moved (Settings > Move Touch Controls)
          if (this.disabled) {
            return;
          }
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
          }
        });
        document.addEventListener("fullscreenchange", () => this.applyForkLabels());
      } else {
        fullscreen.remove();
      }
    }

    const vibrate = document.getElementById("apadVibrate");
    if (vibrate) {
      if (typeof navigator.vibrate === "function") {
        vibrate.addEventListener("click", event => {
          event.preventDefault();
          // not while the controls are being moved (Settings > Move Touch Controls)
          if (this.disabled) {
            return;
          }
          const enable = !settings.general.enableVibration;
          settings.update("general", "enableVibration", enable);
          if (enable) {
            navigator.vibrate(40);
          }
          this.applyForkLabels();
        });
      } else {
        vibrate.remove();
      }
    }
  }

  /** Fork: writes the readable button names (and the toggle states) into `data-long` for the portrait layout. */
  private applyForkLabels(): void {
    const language = i18next.resolvedLanguage ?? i18next.language ?? navigator.language ?? "en";
    const ko = language.startsWith("ko");
    const setLabel = (id: string, text: string) => {
      const label = document.querySelector<HTMLElement>(`#${id} > .apad-label`);
      if (label) {
        label.dataset.long = text;
      }
    };
    const mode = document.getElementById("touchControls")?.dataset.uiMode ?? "";
    const labels = { ...forkButtonLabels, ...forkModeLabels[mode] };
    for (const [id, [koText, enText]] of Object.entries(labels)) {
      setLabel(id, ko ? koText : enText);
    }
    const pick = ([koText, enText]: readonly [string, string]) => (ko ? koText : enText);
    const isFullscreen = !!document.fullscreenElement;
    setLabel("apadFullscreen", pick(isFullscreen ? ["창 모드", "Window"] : ["전체화면", "Fullscreen"]));
    const vibrationOn = settings.general.enableVibration;
    setLabel("apadVibrate", pick(vibrationOn ? ["진동 켬", "Vibe on"] : ["진동 끔", "Vibe off"]));
    document.getElementById("apadVibrate")?.classList.toggle("apad-off", !vibrationOn);
  }

  /**
   * Binds a node to a specific key to simulate keyboard events on touch.
   *
   * @param node - The DOM element to bind the key to.
   * @param key - The key to simulate.
   * @param events - The event emitter for handling input events.
   *
   * @remarks
   * This function binds touch events to a node to simulate 'keydown' and 'keyup' keyboard events.
   * It adds the key to the keys map and tracks the keydown state. When a touch starts, it simulates
   * a 'keydown' event and adds an 'active' class to the node. When the touch ends, it simulates a 'keyup'
   * event, removes the keydown state, and removes the 'active' class from the node and the last touched element.
   */
  bindKey(node: HTMLElement, key: string) {
    node.addEventListener("touchstart", (event: TouchEvent) => {
      // Handle touch events for touch devices
      this.touchButtonDown(node, key);
      event.preventDefault();

      // prevent pointer event from also firing (undefined just sets presence of custom attribute)
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.dataset.skipPointerEvent = undefined;
      }
    });
    node.addEventListener("pointerdown", event => {
      const currentTarget = event.currentTarget;
      if (currentTarget instanceof HTMLElement && "skipPointerDown" in currentTarget.dataset) {
        return;
      }
      event.preventDefault();
      this.touchButtonDown(node, key);
    });

    node.addEventListener("touchcancel", (event: TouchEvent) => {
      if (event.currentTarget instanceof HTMLElement && "skipPointerDown" in event.currentTarget.dataset) {
        delete event.currentTarget.dataset.skipPointerEvent;
      }
    });

    node.addEventListener("touchend", (event: TouchEvent) => {
      event.preventDefault();
      this.touchButtonUp(node, key, event.target?.["id"]);
      if (event.currentTarget instanceof HTMLElement && "skipPointerDown" in event.currentTarget.dataset) {
        // allow pointer event to once again fire
        delete event.currentTarget.dataset.skipPointerEvent;
        event.currentTarget.dataset.skipPointerUp = undefined;
      }
    });

    node.addEventListener("pointerup", event => {
      if (event.currentTarget instanceof HTMLElement && "skipPointerUp" in event.currentTarget.dataset) {
        delete event.currentTarget.dataset.skipPointerUp;
        return;
      }
      event.preventDefault();
      this.touchButtonUp(node, key, event.target?.["id"]);
    });
  }

  touchButtonDown(node: HTMLElement, key: string) {
    if (this.buttonLock.includes(key)) {
      return;
    }
    if (!this.simulateKeyboardEvent("keydown", key)) {
      return;
    }
    // Fork: a short buzz on every touch button press (not on held repeats) when "Vibration" is on
    if (settings.general.enableVibration && typeof navigator.vibrate === "function") {
      navigator.vibrate(touchVibrationMillis);
    }
    clearInterval(this.inputInterval[key]);
    // Fork: toggles (Menu, and C = filter / stats) fire once per press; repeating them while held flipped them back
    if (!nonRepeatingKeys.has(key)) {
      this.inputInterval[key] = setInterval(() => {
        if (!this.simulateKeyboardEvent("keydown", key)) {
          clearInterval(this.inputInterval[key]);
        }
      }, repeatInputDelayMillis);
    }
    this.buttonLock.push(key);
    node.classList.add("active");
  }

  touchButtonUp(node: HTMLElement, key: string, id: string) {
    if (!this.buttonLock.includes(key) || (this.disabled && this.finishedLastTouch)) {
      return;
    }
    this.finishedLastTouch = true;
    this.simulateKeyboardEvent("keyup", key);
    node.classList.remove("active");

    document.getElementById(id)?.classList.remove("active");
    const index = this.buttonLock.indexOf(key);
    this.buttonLock.splice(index, 1);
    clearInterval(this.inputInterval[key]);
  }

  /**
   * Simulates a keyboard event on the canvas if the button is not disabled.
   *
   * @param eventType - The type of the keyboard event ('keydown' or 'keyup').
   * @param key - The key to simulate.
   * @returns Whether the simulation was successful.
   * @remarks
   * This function checks if the key exists in the Button enum. If it does, it retrieves the corresponding button
   * and emits the appropriate event ('input_down' or 'input_up') based on the event type.
   */
  simulateKeyboardEvent(eventType: string, key: string): boolean {
    if (!Object.hasOwn(Button, key) || this.disabled) {
      return false;
    }
    const button = Button[key];

    switch (eventType) {
      case "keydown":
        this.events.emit("input_down", {
          controller_type: "keyboard",
          button,
          isTouch: true,
        });
        break;
      case "keyup":
        this.events.emit("input_up", {
          controller_type: "keyboard",
          button,
          isTouch: true,
        });
        break;
    }
    return true;
  }

  /** Deactivates all currently pressed keys. */
  deactivatePressedKey(): void {
    for (const key of Object.keys(this.inputInterval)) {
      clearInterval(this.inputInterval[key]);
    }
    for (const button of document.querySelectorAll("[data-key]")) {
      button.classList.remove("active");
    }
    this.buttonLock = [];
  }

  public render(): void {
    if (!hasTouchscreen() || !settings.general.enableTouchControls) {
      return;
    }

    document.documentElement.dataset.uiTheme = UiTheme[settings.display.uiTheme];
    document.documentElement.dataset.windowType = enumValueToKey(UiWindowStyle, settings.display.uiWindowStyle);
    this.applyForkLabels();
    const touchControls = document.getElementById("touchControls");
    if (touchControls) {
      touchControls.classList.add("visible");
    }
  }
}

const doubleTapThresholdMillis = 500;

/**
 * Installs a single document-level listener that suppresses the native double-tap-to-zoom
 * gesture everywhere on the page, including elements added after this is called. Intended
 * to be called once at startup.
 * @see {@link https://stackoverflow.com/a/39778831/4622620 | Source}
 */
export function preventDoubleTapZoom(): void {
  let lastTouchTimeStamp = 0;

  document.addEventListener(
    "touchstart",
    (event: TouchEvent) => {
      // Fork: the choice panel scrolls and has its own double-pick guard; a quick second touch there must stay
      // a scroll or a native tap, not become an instant click (it also doesn't count as a first tap)
      if (event.target instanceof Element && event.target.closest("#touchChoices")) {
        return;
      }
      const currentTouchTimeStamp = event.timeStamp;
      const timeStampDifference = currentTouchTimeStamp - lastTouchTimeStamp;
      lastTouchTimeStamp = currentTouchTimeStamp;

      if (!timeStampDifference || timeStampDifference > doubleTapThresholdMillis || event.touches.length > 1) {
        return; // not a double-tap
      }

      event.preventDefault();

      if (event.target instanceof HTMLElement) {
        event.target.click();
      }
    },
    { capture: true, passive: false },
  );
}

/**
 * Check if the device is a mobile device.
 *
 * @returns `true` if the device is a mobile device, otherwise `false`.
 */
export function isMobile(): boolean {
  let ret = false;
  (a => {
    // Check the user agent string against a regex for mobile devices
    if (
      /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(
        a,
      )
      || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw-(n|u)|c55\/|capi|ccwa|cdm-|cell|chtm|cldc|cmd-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc-s|devi|dica|dmob|do(c|p)o|ds(12|-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(-|_)|g1 u|g560|gene|gf-5|g-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd-(m|p|t)|hei-|hi(pt|ta)|hp( i|ip)|hs-c|ht(c(-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i-(20|go|ma)|i230|iac( |-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|-[a-w])|libw|lynx|m1-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|-([1-8]|c))|phil|pire|pl(ay|uc)|pn-2|po(ck|rt|se)|prox|psio|pt-g|qa-a|qc(07|12|21|32|60|-[2-7]|i-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h-|oo|p-)|sdk\/|se(c(-|0|1)|47|mc|nd|ri)|sgh-|shar|sie(-|m)|sk-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h-|v-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl-|tdg-|tel(i|m)|tim-|t-mo|to(pl|sh)|ts(70|m-|m3|m5)|tx-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas-|your|zeto|zte-/i.test(
        a.slice(0, 4),
      )
    ) {
      ret = true;
    }
  })(navigator.userAgent || navigator.vendor || window["opera"]);
  return ret;
}

/**
 * Detect if the current device is running iOS (iPhone, iPad, or iPod)
 * @returns Whether the current device is running iOS.
 */
export function isIos(): boolean {
  const userAgent = navigator.userAgent || navigator.vendor || (window as any)["opera"];
  // Check for iPhone, iPad, or iPod
  const userAgentCheck = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
  const iPadSpecificCheck = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return userAgentCheck || iPadSpecificCheck;
}
