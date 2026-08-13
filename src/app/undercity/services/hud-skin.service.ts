import { Injectable, computed, signal } from '@angular/core';

/** localStorage key for the board HUD skin preference. */
const HUD_SKIN_KEY = 'uc-hud-skin';

/** `band` = the classic bottom action bar. `dial` = the radial turn dial. */
export type HudSkin = 'band' | 'dial';

/**
 * Board HUD skin preference, remembered per device.
 *
 * A service rather than a component signal because the toggle button lives in
 * the page header (`undercity-page.component`) while the dial it controls
 * renders inside the board tab. Deliberately not a general settings framework —
 * the app has no settings UI and inventing one is out of scope.
 */
@Injectable({ providedIn: 'root' })
export class HudSkinService {
  private readonly current = signal<HudSkin>(
    localStorage.getItem(HUD_SKIN_KEY) === 'dial' ? 'dial' : 'band',
  );

  readonly skin = this.current.asReadonly();

  /** True when the radial dial replaces the board's routine action row. */
  readonly isDial = computed(() => this.current() === 'dial');

  toggle(): void {
    this.set(this.current() === 'dial' ? 'band' : 'dial');
  }

  set(skin: HudSkin): void {
    this.current.set(skin);
    localStorage.setItem(HUD_SKIN_KEY, skin);
  }
}
