# TV / QR Display Page — Design Spec

## Goal

Add a desktop-only page that shows a large QR code encoding the deployed site URL, intended to be displayed on a TV during game day so guests can scan with a phone and reach the site.

## User flow

1. Host opens the site on a laptop hooked up to a TV.
2. Host clicks the new **TV** link in the navbar.
3. A dark, full-viewport page renders with a large centered QR code, the encoded URL printed below, and a short "Scan to join" heading.
4. Guests scan the QR with their phone camera and land on the site root.

## Scope

In scope:
- New route `/tv` and a `TvComponent`.
- New navbar link, visible on desktop (≥ 1024px) only.
- Client-side QR generation via the `qrcode` npm package.
- QR encodes a runtime-computed URL (`window.location.origin + '/golgari-game-day/'`).

Out of scope (deferred):
- Kiosk mode that hides the navbar.
- Fullscreen toggle.
- Copy-URL button.
- Adjustable QR size or color customization.
- Encoding deep links (game/photo URLs) — only the site root is encoded.

## Architecture

### New files

- `src/app/tv/tv.component.ts` — standalone component.
- `src/app/tv/tv.component.html` — heading, `<canvas>` for QR, URL caption.
- `src/app/tv/tv.component.scss` — full-viewport dark layout, centered column, large QR.

### Touched files

- `src/app/app.routes.ts` — add `{ path: 'tv', component: TvComponent }`.
- `src/app/navbar/navbar.component.html` — add a third `<a mat-button>` link with icon `qr_code_2`, label "TV", and class `desktop-only`.
- `src/app/navbar/navbar.component.scss` — add a `.desktop-only` rule that hides the element below the `$desktop` (1024px) breakpoint.
- `package.json` — add `qrcode` runtime dependency (and `@types/qrcode` dev dependency).

### Component behavior

`TvComponent`:
- Standalone Angular component (matches project convention).
- On `ngAfterViewInit`, computes `const url = window.location.origin + '/golgari-game-day/'` and calls `QRCode.toCanvas(this.canvasRef.nativeElement, url, { width: 480, margin: 2 })` from the `qrcode` package.
- Stores the URL string in a public field so the template can render it as a caption beneath the canvas.
- Uses `@ViewChild('qrCanvas')` to get the canvas element.

### Styling

- Page background: `var(--golgari-black)` (`#2d2d2d`) for TV-friendly contrast.
- Layout: flex column, centered horizontally and vertically, fills `100vh - 64px` (account for the sticky navbar).
- Heading: large white text, e.g. `font-size: 2.5rem`, "Scan to join Game Day".
- QR canvas: the `qrcode` library renders a white background with a built-in quiet zone (`margin: 2`), which is sufficient for scan reliability — no extra wrapper card needed.
- URL caption: monospace, `var(--rating-gold)` or white, `font-size: 1.25rem`, letter-spacing slightly increased.

### Navbar visibility

A new utility class `desktop-only` is added to `navbar.component.scss`:

```scss
.desktop-only {
  @media (max-width: 1023px) {
    display: none !important;
  }
}
```

Applied to the new TV nav-link `<a>` so it disappears on mobile and tablet. Home and Games links retain their existing responsive behavior unchanged.

## URL value

The encoded URL is computed at runtime, not hardcoded:

- In production (GitHub Pages): `https://<user>.github.io/golgari-game-day/` — what we want guests to scan.
- In `npm start` dev: `http://localhost:4200/golgari-game-day/` — useful for testing the page locally.

This avoids drift if the production URL ever changes (e.g., custom domain) and keeps the dev experience honest.

## Dependencies

- Add `qrcode` (^1.5.x) to `dependencies`.
- Add `@types/qrcode` to `devDependencies`.

`qrcode` is small (~50KB), has no runtime dependencies, and generates to canvas client-side — no network calls. Works offline, which matches the PWA story.

## Edge cases & non-concerns

- **PWA / service worker**: The page renders entirely from in-bundle code; no extra fetches needed. The service worker will cache it the same way it caches other routes — no special handling required.
- **Resize / responsive on the TV page itself**: The page is desktop-only by entry point, but if someone manually navigates to `/tv` on mobile, the page still renders — the QR just appears at fixed 480px and may overflow on a phone. Acceptable; the page is not intended for that.
- **Server-side rendering**: This Angular app is a client-only SPA (no SSR), so `window.location.origin` is safe to read directly in `ngAfterViewInit`.

## Testing

No unit tests — the project has no test runner wired up (per CLAUDE.md, Karma/Jasmine specs were removed). Manual verification:

1. `npm start` — confirm the TV link appears in the navbar at ≥1024px viewport, and disappears below.
2. Click the TV link — confirm `/tv` renders with a visible QR and the dev URL caption.
3. Scan the QR with a phone — confirm it opens the dev URL (or a configured production URL after deploy).
4. `npm run build:prod` — confirm no build errors and the bundle includes the qrcode package.
