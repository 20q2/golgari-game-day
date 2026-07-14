import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VaultView } from '../services/undercity-models';
import { VAULT_SIGILS, VAULT_SLOTS } from '../data/vein-vault';

/**
 * The Guildvault modal: pick 3 distinct sigils, get Mastermind feedback, and
 * read every past attempt on the public ledger. Pure presentation — the
 * parent owns the shared vault state and the `vault-guess` action.
 */
@Component({
  selector: 'app-undercity-guildvault',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="vault-overlay" (click)="closed.emit()">
      <div class="vault-card" (click)="$event.stopPropagation()" [style.background-image]="washBg">
        <h3>🔐 The Guildvault</h3>
        <p class="vault-sub">
          Pot: <strong>{{ vault.pot }}</strong> Spores ·
          <strong>{{ picksLeft }}</strong> pick{{ picksLeft === 1 ? '' : 's' }} left this visit
        </p>

        <div class="slots">
          @for (i of slotIdx; track i) {
            <div class="slot" [class.filled]="picked()[i]">
              {{ picked()[i] ? emoji(picked()[i]) : '·' }}
            </div>
          }
        </div>

        <div class="sigils">
          @for (s of sigils; track s.id) {
            <button
              type="button"
              class="sigil"
              [class.used]="picked().includes(s.id)"
              [disabled]="busy || picksLeft < 1"
              (click)="toggle(s.id)"
              [title]="s.name"
            >
              {{ s.emoji }}
            </button>
          }
        </div>

        @if (picksLeft > 0) {
          <button
            class="uc-btn pick-btn"
            [disabled]="busy || picked().length !== SLOTS"
            (click)="submit()"
          >
            Pick the Lock
          </button>
          <p class="vault-hint">Tap {{ SLOTS }} different sigils in order, then pick.</p>
        } @else {
          <p class="vault-hint out">
            Your picks are blunted — come back next time you land here.
          </p>
        }

        <div class="ledger">
          <p class="ledger-title">Chalked on the wall</p>
          @if (!vault.history.length) {
            <p class="ledger-empty">No attempts yet. Untouched tumblers, seed pot.</p>
          }
          @for (h of ledger(); track $index) {
            <div class="ledger-row">
              <span class="who">{{ h.user }}</span>
              <span class="tries">
                @for (g of h.guess; track $index) {
                  {{ emoji(g) }}
                }
              </span>
              <span class="feedback">{{ h.exact }} placed · {{ h.near }} misplaced</span>
            </div>
          }
        </div>

        <button class="uc-btn close-btn" (click)="closed.emit()">Leave</button>
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
      h3 {
        margin: 0;
        color: #e0c088;
      }
      .vault-sub {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
      }
      .vault-sub strong {
        color: #e0c088;
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
        font-size: 1.5rem;
        color: #5a5142;
      }
      .slot.filled {
        border-style: solid;
        background: #241f16;
      }
      .sigils {
        display: flex;
        gap: 6px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .sigil {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        border: 1px solid rgba(0, 0, 0, 0.5);
        background: #26221a;
        font-size: 1.3rem;
        cursor: pointer;
        transition:
          transform 0.08s ease,
          filter 0.12s ease;
      }
      .sigil:not(:disabled):hover {
        filter: brightness(1.25);
        transform: translateY(-1px);
      }
      .sigil.used {
        outline: 2px solid rgba(224, 192, 136, 0.8);
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
        border-top: 1px solid rgba(170, 130, 70, 0.35);
        padding-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
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
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-size: 0.82rem;
      }
      .who {
        color: #cbd5ce;
        min-width: 64px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tries {
        letter-spacing: 0.12em;
      }
      .feedback {
        margin-left: auto;
        color: #9aa79a;
        white-space: nowrap;
      }
      .close-btn {
        margin-top: 4px;
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

  protected emoji(id: string): string {
    return VAULT_SIGILS.find((s) => s.id === id)?.emoji ?? '?';
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
