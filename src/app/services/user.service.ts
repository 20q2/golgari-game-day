import { Injectable, computed, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

const USERNAME_STORAGE_KEY = 'gameday-username';
const USER_ID_STORAGE_KEY = 'gameday-user-id';

/** Lowercase, hyphen-separated; non-alphanumeric characters collapsed to single hyphens. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly _userId = signal<string | null>(null);
  private readonly _username = signal<string | null>(null);

  readonly userId = this._userId.asReadonly();
  readonly username = this._username.asReadonly();
  readonly isSignedIn = computed(() => this._username() !== null);

  constructor(private dialog: MatDialog) {
    this._userId.set(localStorage.getItem(USER_ID_STORAGE_KEY));
    this._username.set(localStorage.getItem(USERNAME_STORAGE_KEY));
  }

  /** One-shot. No-op if already signed in. */
  setUsername(rawName: string): void {
    if (this.isSignedIn()) {
      return;
    }
    const name = rawName.trim();
    if (name.length === 0) {
      return;
    }
    const slug = slugify(name);
    if (slug.length === 0) {
      return;
    }
    const userId = `user-${slug}`;
    localStorage.setItem(USERNAME_STORAGE_KEY, name);
    localStorage.setItem(USER_ID_STORAGE_KEY, userId);
    this._username.set(name);
    this._userId.set(userId);
  }

  async requireSignIn(): Promise<boolean> {
    if (this.isSignedIn()) {
      return true;
    }
    const { SignInDialogComponent } = await import(
      '../components/sign-in-dialog/sign-in-dialog.component'
    );
    const result = await this.dialog
      .open<InstanceType<typeof SignInDialogComponent>, void, string | null>(SignInDialogComponent, {
        width: '320px',
        disableClose: false,
      })
      .afterClosed()
      .toPromise();
    return result != null && this.isSignedIn();
  }
}
