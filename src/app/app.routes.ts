import { Routes } from '@angular/router';
import { GamesComponent } from './games/games.component';
import { TvComponent } from './tv/tv.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: GamesComponent },
  { path: 'tv', component: TvComponent },
  {
    path: 'undercity',
    loadComponent: () =>
      import('./undercity/undercity-page.component').then((m) => m.UndercityPageComponent),
  },
  {
    path: 'undercity/color-test',
    loadComponent: () =>
      import('./undercity/color-test/color-test.component').then((m) => m.ColorTestComponent),
  },
  { path: '**', redirectTo: '/home' }
];
