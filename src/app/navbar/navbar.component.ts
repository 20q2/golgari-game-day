import { Component, inject, isDevMode } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent {
  protected readonly userService = inject(UserService);

  // True under `ng serve` / `npm start`, false in production builds. Gates
  // the rename / sign-out menu so it never ships to the live site.
  protected readonly isDev = isDevMode();

  async openSignIn(): Promise<void> {
    await this.userService.requireSignIn();
  }

  async rename(): Promise<void> {
    this.userService.signOut();
    await this.userService.requireSignIn();
  }

  signOut(): void {
    this.userService.signOut();
  }
}
