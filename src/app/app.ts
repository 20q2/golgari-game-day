import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { NavbarComponent } from './navbar/navbar.component';
import { FloatingParticlesComponent } from './floating-particles/floating-particles.component';
import { UserService } from './services/user.service';
import { UC_SVG_ICONS } from './undercity/data/icons';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, FloatingParticlesComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('golgari-palace-gameday');

  constructor(
    private userService: UserService,
    iconRegistry: MatIconRegistry,
    sanitizer: DomSanitizer,
  ) {
    // Register custom Undercity SVG icons once; MatIconRegistry is app-wide.
    for (const [name, svg] of Object.entries(UC_SVG_ICONS)) {
      iconRegistry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(svg));
    }
  }

  ngOnInit(): void {
    if (this.userService.legacyIdentityCleared()) {
      void this.userService.requireSignIn();
    }
  }
}
