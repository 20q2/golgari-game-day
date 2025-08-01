import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GameDetailsDialogComponent } from './game-details-dialog.component';

describe('GameDetailsDialogComponent', () => {
  let component: GameDetailsDialogComponent;
  let fixture: ComponentFixture<GameDetailsDialogComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GameDetailsDialogComponent]
    });
    fixture = TestBed.createComponent(GameDetailsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
