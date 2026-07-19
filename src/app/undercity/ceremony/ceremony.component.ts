import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { HallOfFameNight, SeasonResult, Standing } from '../services/undercity-models';
import { formSprite } from '../data/species';
import { getRecoloredWithHatDataUrl } from '../engine/sprite-engine';

/** End-of-night ceremony: champion center-stage, podium, full Renown table. */
@Component({
  selector: 'app-undercity-ceremony',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './ceremony.component.html',
  styleUrls: ['./ceremony.component.scss'],
})
export class CeremonyComponent {
  private readonly _result = signal<SeasonResult | null>(null);
  @Input() set result(value: SeasonResult | null) {
    this._result.set(value);
  }
  @Input() hallOfFame: HallOfFameNight[] = [];

  protected readonly standings = computed(() => this._result()?.standings ?? []);
  protected readonly champion = computed(() => this._result()?.champion ?? null);
  protected readonly podium = computed(() => this.standings().slice(0, 3));

  spriteUrl(s: Standing): string | null {
    const spr = formSprite(s.form);
    return getRecoloredWithHatDataUrl(spr.sprite, s.paint ?? {}, spr.regions, s.hat);
  }

  protected creatureTitle(s: Standing): string {
    return s.creatureName && s.creatureName !== s.formName
      ? `${s.creatureName} the ${s.formName}`
      : s.formName;
  }
}
