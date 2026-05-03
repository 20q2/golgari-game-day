import { Injectable, computed, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

const USERNAME_STORAGE_KEY = 'gameday-username';
const USER_ID_STORAGE_KEY = 'gameday-user-id';

/**
 * Auto-generated names from the pre-rewrite identity scheme were one of these
 * five prefixes followed by a random integer (e.g. "GameMaster742"). Returning
 * users carrying such a name never picked it intentionally — treat them as
 * fresh and prompt for a real name. See plans/2026-05-03-legacy-identity-migration-spec.md.
 */
const LEGACY_USERNAME_PATTERN =
  /^(GameMaster|BoardGameFan|DiceRoller|CardShark|MeepleCollector)\d+$/;

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
  private readonly _legacyIdentityCleared = signal(false);

  readonly userId = this._userId.asReadonly();
  readonly username = this._username.asReadonly();
  readonly isSignedIn = computed(() => this._username() !== null);
  /**
   * True for the lifetime of this app load if the constructor wiped a legacy
   * auto-generated identity. Read once by the root component to auto-open the
   * sign-in dialog. Not persisted; resets to false on the next page load.
   */
  readonly legacyIdentityCleared = this._legacyIdentityCleared.asReadonly();

  constructor(private dialog: MatDialog) {
    const storedName = localStorage.getItem(USERNAME_STORAGE_KEY);
    if (storedName !== null && LEGACY_USERNAME_PATTERN.test(storedName)) {
      localStorage.removeItem(USERNAME_STORAGE_KEY);
      localStorage.removeItem(USER_ID_STORAGE_KEY);
      this._legacyIdentityCleared.set(true);
      return;
    }
    this._userId.set(localStorage.getItem(USER_ID_STORAGE_KEY));
    this._username.set(storedName);
  }

  /** Clear identity from localStorage and signals. Used by dev-mode rename / sign-out. */
  signOut(): void {
    localStorage.removeItem(USERNAME_STORAGE_KEY);
    localStorage.removeItem(USER_ID_STORAGE_KEY);
    this._username.set(null);
    this._userId.set(null);
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
