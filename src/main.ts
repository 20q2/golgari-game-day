// Browser API shims must land before any lazy chunk that uses them is fetched.
import './polyfills/canvas-round-rect';

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
