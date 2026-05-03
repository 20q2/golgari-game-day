import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { GamesComponent } from './games/games.component';
import { TvComponent } from './tv/tv.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'games', component: GamesComponent },
  { path: 'tv', component: TvComponent },
  { path: '**', redirectTo: '/home' }
];
