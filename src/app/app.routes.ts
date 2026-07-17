import { Routes } from '@angular/router';
import { GamesComponent } from './games/games.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: GamesComponent },
  {
    // The TV: a self-running spectator broadcast of the live Undercity game.
    // Lazy-loaded so the heavy board engine stays out of the main bundle.
    path: 'tv',
    loadComponent: () =>
      import('./undercity/spectator/spectator.component').then((m) => m.SpectatorComponent),
  },
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
  {
    path: 'undercity/map-editor',
    loadComponent: () =>
      import('./undercity/map-editor/map-editor.component').then((m) => m.MapEditorComponent),
  },
  {
    path: 'undercity/admin',
    loadComponent: () =>
      import('./undercity/admin/admin-panel.component').then((m) => m.AdminPanelComponent),
  },
  { path: '**', redirectTo: '/home' }
];
