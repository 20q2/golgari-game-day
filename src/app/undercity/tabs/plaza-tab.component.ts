import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { UndercityStateService } from '../services/undercity-state.service';
import { PlazaCanvas, PlazaCreature } from '../engine/plaza-canvas';
import { PublicPlayer, evolveGlowActive, isShielded } from '../services/undercity-models';

@Component({
  selector: 'app-undercity-plaza-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './plaza-tab.component.html',
  styleUrls: ['./plaza-tab.component.scss'],
})
export class PlazaTabComponent implements AfterViewInit, OnDestroy {
  @ViewChild('plazaCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly store = inject(UndercityStateService);
  private plaza: PlazaCanvas | null = null;

  protected readonly selected = signal<PlazaCreature | null>(null);
  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);

  constructor() {
    effect(() => {
      const players = this.store.players();
      if (!this.plaza) return;
      this.plaza.updatePartners(players.map((p) => this.toCreature(p)));
    });
    effect(() => {
      const diff = this.store.rosterDiff();
      if (!this.plaza) return;
      for (const id of diff.departed) this.plaza.fadeOutDino(id);
      for (const id of diff.arrived) this.plaza.dropInDino(id);
      for (const id of diff.restyled) this.plaza.boingDino(id);
    });
  }

  private toCreature(p: PublicPlayer): PlazaCreature {
    return {
      userId: p.userId,
      username: p.username,
      form: p.form,
      formName: p.formName,
      level: p.level,
      paint: p.paint ?? {},
      hat: p.hat,
      shielded: isShielded(p),
      evolveGlow: evolveGlowActive(p as { evolvedAt?: string }),
    };
  }

  ngAfterViewInit(): void {
    this.plaza = new PlazaCanvas(
      this.canvasRef.nativeElement,
      this.store.players().map((p) => this.toCreature(p)),
      (creature) => this.selected.set(creature),
      this.store.ownUserId,
    );
    this.plaza.start();
  }

  ngOnDestroy(): void {
    this.plaza?.stop();
    this.plaza = null;
  }

  async poke(): Promise<void> {
    const target = this.selected();
    if (!target || this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('poke', { targetUserId: target.userId });
      this.plaza?.boingDino(target.userId);
      this.showToast(
        resp.granted
          ? `You poked ${target.username} — they gained a roll! 🎲`
          : `You poked ${target.username}.`,
      );
      this.selected.set(null);
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Poke failed');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3000);
  }
}
