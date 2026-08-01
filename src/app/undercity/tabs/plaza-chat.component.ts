import { Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { ChatMessage } from '../services/undercity-models';
import { formSprite } from '../data/species';
import { getRecoloredWithHatDataUrl } from '../engine/sprite-engine';

/**
 * Season-wide plaza chat: a floating chat-bubble button pinned to the
 * bottom-left of the plaza scene (just above the action band) that opens a
 * message panel. Messages ride the store's normal 10s poll; sending goes
 * through UndercityStateService.sendChat, which appends the echoed message
 * immediately. Unread tracking lives in the store so the badge survives this
 * component being torn down on a tab switch.
 */
@Component({
  selector: 'app-uc-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './plaza-chat.component.html',
  styleUrls: ['./plaza-chat.component.scss'],
})
export class UcChatComponent {
  protected readonly store = inject(UndercityStateService);

  /** Mirror of CHAT_MAX_LEN in infrastructure/lambda/undercity_db.py. */
  protected readonly CHAT_MAX = 140;

  protected readonly open = signal(false);
  protected readonly draft = signal('');
  protected readonly busy = signal(false);
  protected readonly errorMsg = signal<string | null>(null);
  protected readonly messages = this.store.chat;
  protected readonly unread = this.store.chatUnread;

  @ViewChild('chatList') private listRef?: ElementRef<HTMLDivElement>;

  /** Static recolored portraits for everyone in the roster; departed players
   * fall back to a generic icon in the template. */
  private readonly avatars = computed(() => {
    const map = new Map<string, string>();
    for (const p of this.store.players()) {
      const spr = formSprite(p.form, p.spriteVariant);
      const url = getRecoloredWithHatDataUrl(spr.sprite, p.paint ?? {}, spr.regions, p.hat);
      if (url) map.set(p.userId, url);
    }
    return map;
  });

  constructor() {
    // While the panel is open, arriving messages count as read and the list
    // stays pinned to the newest one.
    effect(() => {
      this.messages();
      if (!this.open()) return;
      this.store.markChatRead();
      this.scrollToBottomSoon();
    });
  }

  protected avatarUrl(userId: string): string | null {
    return this.avatars().get(userId) ?? null;
  }

  protected timeOf(m: ChatMessage): string {
    const d = new Date(m.ts + 'Z');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    this.errorMsg.set(null);
    void this.store.refresh();
    this.store.markChatRead();
    this.scrollToBottomSoon();
  }

  protected close(): void {
    this.open.set(false);
  }

  protected async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.busy()) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      await this.store.sendChat(text);
      this.draft.set('');
      this.scrollToBottomSoon();
    } catch (e) {
      // Keep the draft so a flaky network doesn't eat the message.
      this.errorMsg.set(e instanceof Error ? e.message : 'Could not send — try again.');
    } finally {
      this.busy.set(false);
    }
  }

  private scrollToBottomSoon(): void {
    setTimeout(() => {
      const el = this.listRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
