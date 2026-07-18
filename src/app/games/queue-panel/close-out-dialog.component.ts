import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueueMember, CloseResult } from '../../services/queue-models';

export interface CloseOutData {
  gameTitle: string;
  roster: QueueMember[];
}

@Component({
  selector: 'app-close-out-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 class="title">Close out {{ data.gameTitle }}</h2>

    <ng-container *ngIf="step === 'winner?'">
      <p class="q">Did the game have a winner?</p>
      <div class="row">
        <button mat-stroked-button (click)="chooseHadWinner(true)">Yes</button>
        <button mat-stroked-button (click)="chooseHadWinner(false)">No</button>
      </div>
    </ng-container>

    <ng-container *ngIf="step === 'who?'">
      <p class="q">Who won?</p>
      <div class="mode">
        <button mat-stroked-button [class.sel]="mode === 'single'" (click)="mode = 'single'">Single winner</button>
        <button mat-stroked-button [class.sel]="mode === 'group'" (click)="mode = 'group'">Group victory (coop)</button>
      </div>
      <ul class="players" *ngIf="mode === 'single'">
        <li *ngFor="let m of data.roster">
          <button mat-stroked-button [class.sel]="winnerId === m.userId" (click)="winnerId = m.userId">
            {{ m.username || m.userId }}
          </button>
        </li>
      </ul>
      <div class="row end">
        <button mat-button (click)="step = 'winner?'">Back</button>
        <button mat-flat-button color="primary" [disabled]="!canConfirm()" (click)="confirm()">Confirm</button>
      </div>
    </ng-container>
  `,
  styles: [`
    .title { font-size: 18px; margin: 0 0 8px; }
    .q { font-weight: 600; margin: 12px 0 8px; }
    .row { display: flex; gap: 10px; }
    .row.end { justify-content: flex-end; margin-top: 16px; }
    .mode { display: flex; gap: 8px; flex-wrap: wrap; }
    .players { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; }
    .sel { background: var(--accent-color); color: #fff; }
  `],
})
export class CloseOutDialogComponent {
  step: 'winner?' | 'who?' = 'winner?';
  mode: 'single' | 'group' = 'single';
  winnerId: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<CloseOutDialogComponent, CloseResult | null>,
    @Inject(MAT_DIALOG_DATA) public data: CloseOutData,
  ) {}

  chooseHadWinner(had: boolean): void {
    if (!had) {
      this.dialogRef.close({ hadWinner: false });
      return;
    }
    this.step = 'who?';
  }

  canConfirm(): boolean {
    return this.mode === 'group' || this.winnerId !== null;
  }

  confirm(): void {
    if (this.mode === 'group') {
      this.dialogRef.close({ hadWinner: true, winnerType: 'group' });
    } else if (this.winnerId) {
      this.dialogRef.close({ hadWinner: true, winnerType: 'single', winnerId: this.winnerId });
    }
  }
}
