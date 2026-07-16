import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VaultView } from '../services/undercity-models';
import { VAULT_SIGILS, VAULT_SLOTS } from '../data/vein-vault';
import { SigilIconComponent } from './sigil-icon.component';

/**
 * The Guildvault modal: guess the vault's secret combination (3 distinct
 * sigils in order), get Mastermind-style feedback, and read every past attempt
 * on the public ledger. Pure presentation — the parent owns the shared vault
 * state and the `vault-guess` action.
 */
@Component({
  selector: 'app-undercity-guildvault',
  standalone: true,
  imports: [CommonModule, SigilIconComponent],
  template: `
    <div class="vault-overlay" (click)="closed.emit()">
      <div class="vault-card" (click)="$event.stopPropagation()" [style.background-image]="washBg">
        <button type="button" class="close-x" (click)="closed.emit()" aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6 18 18M18 6 6 18" />
          </svg>
        </button>
        <h3 class="vault-title">
          <svg class="vault-dial" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2.5" stroke-width="1.6" />
            <circle cx="12" cy="12" r="5" stroke-width="1.6" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <path
              d="M12 7V4.5M12 19.5V17M7 12H4.5M19.5 12H17"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          The Guildvault
        </h3>
        <p class="vault-tagline">Crack the vault's {{ SLOTS }}-sigil combination.</p>
        <p class="vault-sub">
          Pot: <strong>{{ vault.pot }}</strong> Spores ·
          <strong>{{ picksLeft }}</strong> guess{{ picksLeft === 1 ? '' : 'es' }} left this visit
        </p>

        <div class="combo">
          <span class="combo-label">Your guess</span>
          <div class="slots">
            @for (i of slotIdx; track i) {
              <div
                class="slot"
                [class.filled]="picked()[i]"
                [class.clearable]="picked()[i] && !busy"
                (click)="removeAt(i)"
                [attr.role]="picked()[i] ? 'button' : null"
                [attr.title]="picked()[i] ? 'Tap to clear' : null"
              >
                @if (picked()[i]) {
                  <app-sigil-icon [id]="picked()[i]" [label]="nameFor(picked()[i])" />
                } @else {
                  <span class="slot-num">{{ i + 1 }}</span>
                }
              </div>
            }
          </div>
        </div>

        <div class="keypad">
          @for (s of sigils; track s.id) {
            <button
              type="button"
              class="sigil"
              [class.used]="picked().includes(s.id)"
              [disabled]="busy || picksLeft < 1"
              (click)="toggle(s.id)"
              [title]="s.name"
              [attr.aria-label]="s.name"
            >
              <app-sigil-icon [id]="s.id" [label]="s.name" />
            </button>
          }
        </div>

        @if (picksLeft > 0) {
          <button
            class="uc-btn pick-btn"
            [disabled]="busy || picked().length !== SLOTS"
            (click)="submit()"
          >
            Submit Guess
          </button>
          <p class="vault-hint">Choose {{ SLOTS }} different sigils in order, then submit your guess.</p>
        } @else {
          <p class="vault-hint out">Out of guesses — come back next time you land here.</p>
        }

        <div class="ledger">
          <p class="ledger-title">Guesses so far</p>
          @if (!vault.history.length) {
            <p class="ledger-empty">No guesses yet. The combination is untouched — seed the pot.</p>
          }
          @for (h of ledger(); track $index) {
            <div class="ledger-row">
              <span class="who" [title]="h.user">{{ h.user }}</span>
              <div class="tries">
                @for (g of h.guess; track $index) {
                  <span class="try-cell"><app-sigil-icon [id]="g" [label]="nameFor(g)" /></span>
                }
              </div>
              <span class="feedback">{{ h.exact }} placed · {{ h.near }} misplaced</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .vault-overlay {
        position: fixed;
        inset: 0;
        z-index: 1150;
        background: rgba(8, 6, 4, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .vault-card {
        position: relative;
        width: min(380px, 100%);
        max-height: 86vh;
        overflow-y: auto;
        background: #1a1712;
        border: 1px solid rgba(170, 130, 70, 0.55);
        border-radius: 14px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: center;
      }
      .close-x {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 30px;
        height: 30px;
        padding: 6px;
        border: none;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.3);
        color: #cbb784;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }
      .close-x:hover {
        background: rgba(0, 0, 0, 0.5);
        color: #f0dba8;
      }
      .close-x svg {
        width: 100%;
        height: 100%;
      }
      .vault-title {
        margin: 0;
        color: #e0c088;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .vault-dial {
        width: 1.15em;
        height: 1.15em;
        flex: none;
        color: #c8a25e;
      }
      .vault-tagline {
        margin: -4px 0 0;
        font-size: 0.86rem;
        color: #c9b487;
      }
      .vault-sub {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
      }
      .vault-sub strong {
        color: #e0c088;
      }
      .combo {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .combo-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #8a978a;
      }
      .slots {
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      .slot {
        width: 48px;
        height: 48px;
        border-radius: 10px;
        border: 1px dashed rgba(170, 130, 70, 0.6);
        background: #12100c;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.7rem;
        color: #cbb784;
      }
      .slot.filled {
        border-style: solid;
        background: #241f16;
      }
      .slot.clearable {
        cursor: pointer;
        transition:
          box-shadow 0.12s ease,
          transform 0.08s ease;
      }
      .slot.clearable:hover {
        box-shadow: inset 0 0 0 1px rgba(224, 192, 136, 0.7);
        transform: translateY(-1px);
      }
      .slot-num {
        font-size: 1rem;
        color: #4c4536;
      }
      .keypad {
        display: flex;
        gap: 8px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .sigil {
        width: 46px;
        height: 46px;
        border-radius: 10px;
        border: 1px solid rgba(0, 0, 0, 0.5);
        background: #26221a;
        color: #d7c497;
        font-size: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
          transform 0.08s ease,
          filter 0.12s ease,
          border-color 0.12s ease;
      }
      .sigil:not(:disabled):hover {
        filter: brightness(1.2);
        transform: translateY(-1px);
      }
      .sigil.used {
        outline: 2px solid rgba(224, 192, 136, 0.85);
        color: #f0dba8;
      }
      .sigil:disabled {
        cursor: default;
        filter: grayscale(0.4) brightness(0.7);
      }
      .pick-btn {
        font-size: 1rem;
      }
      .vault-hint {
        margin: 0;
        font-size: 0.78rem;
        color: #8a978a;
      }
      .vault-hint.out {
        color: #d08a6f;
      }
      .ledger {
        text-align: left;
        background: rgba(10, 8, 5, 0.82);
        border: 1px solid rgba(170, 130, 70, 0.3);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ledger-title {
        margin: 0;
        font-size: 0.8rem;
        color: #b09a6a;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .ledger-empty {
        margin: 0;
        font-size: 0.8rem;
        color: #8a978a;
      }
      .ledger-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 72px max-content;
        align-items: center;
        gap: 10px;
        font-size: 0.82rem;
      }
      .who {
        color: #cbd5ce;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tries {
        display: grid;
        grid-template-columns: repeat(3, 22px);
        gap: 3px;
      }
      .try-cell {
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
      }
      .feedback {
        color: #9aa79a;
        white-space: nowrap;
        font-size: 0.72rem;
      }
    `,
  ],
})
export class GuildvaultModalComponent {
  @Input({ required: true }) vault!: VaultView;
  @Input() picksLeft = 0;
  @Input() busy = false;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() guess = new EventEmitter<string[]>();
  @Output() closed = new EventEmitter<void>();

  protected readonly SLOTS = VAULT_SLOTS;
  protected readonly sigils = VAULT_SIGILS;
  protected readonly slotIdx = Array.from({ length: VAULT_SLOTS }, (_, i) => i);
  protected readonly picked = signal<string[]>([]);

  /** Newest attempts first — the intel you want is at the top. */
  protected ledger() {
    return this.vault.history.slice().reverse();
  }

  /** Display name for a sigil id (used as the icon's accessible label). */
  protected nameFor(id: string): string {
    return VAULT_SIGILS.find((s) => s.id === id)?.name ?? '?';
  }

  /** Tap a filled guess slot to pull that sigil back out. */
  protected removeAt(i: number): void {
    if (this.busy) return;
    const cur = this.picked();
    if (i < 0 || i >= cur.length) return;
    this.picked.set(cur.filter((_, idx) => idx !== i));
  }

  protected toggle(id: string): void {
    const cur = this.picked();
    if (cur.includes(id)) {
      this.picked.set(cur.filter((p) => p !== id));
    } else if (cur.length < this.SLOTS) {
      this.picked.set([...cur, id]);
    }
  }

  protected submit(): void {
    if (this.picked().length !== this.SLOTS) return;
    this.guess.emit(this.picked());
    this.picked.set([]);
  }
}
