import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './navbar/navbar.component';
import { FloatingParticlesComponent } from './floating-particles/floating-particles.component';
import { UserService } from './services/user.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, FloatingParticlesComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('golgari-palace-gameday');

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    if (this.userService.legacyIdentityCleared()) {
      void this.userService.requireSignIn();
    }
  }
}
