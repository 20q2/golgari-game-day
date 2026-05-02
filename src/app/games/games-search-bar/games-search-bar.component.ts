import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-games-search-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './games-search-bar.component.html',
  styleUrls: ['./games-search-bar.component.scss'],
})
export class GamesSearchBarComponent {
  @Input() searchText = '';
  @Input() activeFilterCount = 0;

  @Output() searchTextChange = new EventEmitter<string>();
  @Output() openFilters = new EventEmitter<void>();

  onInput(value: string): void {
    this.searchText = value;
    this.searchTextChange.emit(value);
  }

  onClear(): void {
    if (!this.searchText) return;
    this.searchText = '';
    this.searchTextChange.emit('');
  }
}
