import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChild,
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

  @ViewChild('track') trackRef!: ElementRef<HTMLElement>;
  @ViewChildren('slide') slideRefs!: QueryList<ElementRef<HTMLElement>>;

  activeIndex = 0;
  private observer?: IntersectionObserver;
  private autoAdvanceTimer?: ReturnType<typeof setInterval>;
  private static readonly AUTO_ADVANCE_MS = 15_000;

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
    this.startAutoAdvance();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.stopAutoAdvance();
  }

  scrollTo(index: number): void {
    this.scrollTrackTo(index);
    this.startAutoAdvance();
  }

  private startAutoAdvance(): void {
    this.stopAutoAdvance();
    if (this.selections.length <= 1) return;
    this.autoAdvanceTimer = setInterval(() => {
      const next = (this.activeIndex + 1) % this.selections.length;
      this.scrollTrackTo(next);
    }, GamesFeaturedCarouselComponent.AUTO_ADVANCE_MS);
  }

  private stopAutoAdvance(): void {
    if (this.autoAdvanceTimer !== undefined) {
      clearInterval(this.autoAdvanceTimer);
      this.autoAdvanceTimer = undefined;
    }
  }

  // Scrolls the carousel's own overflow container, not ancestors. Using
  // scrollIntoView would walk up to the window and snap the page back to the
  // carousel whenever auto-advance fires.
  private scrollTrackTo(index: number): void {
    const track = this.trackRef?.nativeElement;
    const slide = this.slideRefs.get(index)?.nativeElement;
    if (!track || !slide) return;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
    this.activeIndex = index;
  }
}
