import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-floating-particles',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './floating-particles.component.html',
  styleUrl: './floating-particles.component.scss'
})
export class FloatingParticlesComponent {
  particles = Array(25).fill(0).map((_, index) => ({
    id: index,
    size: this.getRandomSize(),
    layer: this.getRandomLayer(),
    animation: this.getRandomAnimation(),
    color: this.getRandomColor(),
    startPosition: this.getRandomStartPosition()
  }));

  trackByParticle(index: number, particle: any): number {
    return particle.id;
  }

  private getRandomSize(): string {
    const sizes = ['small', 'medium', 'large'];
    return sizes[Math.floor(Math.random() * sizes.length)];
  }

  private getRandomLayer(): number {
    return Math.floor(Math.random() * 3) + 1;
  }

  private getRandomAnimation(): number {
    return Math.floor(Math.random() * 5) + 1;
  }

  private getRandomColor(): string {
    const colors = ['amber', 'gold', 'warm', 'honey', 'light'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private getRandomStartPosition(): { left: string } {
    return {
      left: Math.random() * 100 + '%'
    };
  }
}