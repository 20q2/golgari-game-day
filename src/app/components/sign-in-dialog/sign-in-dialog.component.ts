import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-sign-in-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './sign-in-dialog.component.html',
  styleUrls: ['./sign-in-dialog.component.scss'],
})
export class SignInDialogComponent {
  name = '';
  readonly maxLength = 32;

  constructor(
    private dialogRef: MatDialogRef<SignInDialogComponent, string | null>,
    private userService: UserService
  ) {}

  get trimmed(): string {
    return this.name.trim();
  }

  get isValid(): boolean {
    return this.trimmed.length >= 1 && this.trimmed.length <= this.maxLength;
  }

  save(): void {
    if (!this.isValid) return;
    this.userService.setUsername(this.trimmed);
    this.dialogRef.close(this.trimmed);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
