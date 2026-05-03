import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { GamesHeroComponent } from '../games-hero/games-hero.component';
import { Game } from '../../models/game.model';
import { HeroSelection } from '../games.utils';

@Component({
  selector: 'app-games-featured-carousel',
  standalone: true,
  imports: [CommonModule, GamesHeroComponent],
  templateUrl: './games-featured-carousel.component.html',
  styleUrls: ['./games-featured-carousel.component.scss'],
})
export class GamesFeaturedCarouselComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) selections: HeroSelection[] = [];
  @Output() open = new EventEmitter<Game>();

  @ViewChildren('slide') slideRefs!: QueryList<ElementRef<HTMLElement>>;

  activeIndex = 0;
  private observer?: IntersectionObserver;

  ngAfterViewInit(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idx = this.slideRefs.toArray().findIndex(ref => ref.nativeElement === entry.target);
            if (idx >= 0) this.activeIndex = idx;
          }
        }
      },
      { threshold: [0.6] },
    );
    this.slideRefs.forEach(ref => this.observer!.observe(ref.nativeElement));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  scrollTo(index: number): void {
    const ref = this.slideRefs.get(index);
    ref?.nativeElement.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }
}
