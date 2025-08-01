import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './navbar/navbar.component';
import { FloatingParticlesComponent } from './floating-particles/floating-particles.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, FloatingParticlesComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('golgari-palace-gameday');
}
