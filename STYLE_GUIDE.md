# 🎨 Golgari Palace Design System & Style Guide

> A modern, mobile-first design system for gaming communities built with Angular Material

## 🎯 Design Philosophy

### Core Principles
- **Gaming-First**: Designed for board game enthusiasts with MTG-inspired branding
- **Mobile-Native**: Mobile-first responsive design that scales beautifully to desktop
- **Content-Focused**: Clean, minimal interface that highlights games and photos
- **Community-Driven**: Encourages interaction through comments, ratings, and photo sharing
- **Performance-Optimized**: Fast loading with PWA capabilities for offline use

---

## 🎨 Color Palette

### Primary Colors
```scss
--primary-color: #1976d2;        // Material Blue 700 - Trust, reliability
--primary-light: #63a4ff;        // Lighter blue for hover states
--primary-dark: #1565c0;         // Darker blue for emphasis

--accent-color: #e91e63;         // Material Pink A400 - Energy, excitement
--accent-light: #ff6090;         // Lighter pink for backgrounds
--accent-dark: #c2185b;          // Darker pink for active states
```

### Neutral Colors
```scss
--background-primary: #fafafa;    // Off-white background
--background-secondary: #ffffff;  // Pure white for cards
--background-tertiary: #f5f7fa;   // Light gray for info sections

--text-primary: rgba(0, 0, 0, .87);   // High emphasis text
--text-secondary: rgba(0, 0, 0, .54); // Medium emphasis text
--text-disabled: rgba(0, 0, 0, .38);  // Low emphasis text
```

### Semantic Colors
```scss
--success: #4caf50;              // Green for positive actions
--warning: #ff9800;              // Orange for warnings
--error: #f44336;                // Red for errors/validation
--info: #2196f3;                 // Blue for informational content
```

### Gaming Theme Colors
```scss
--golgari-green: #006442;        // MTG Golgari guild green
--golgari-black: #2d2d2d;        // MTG Golgari guild black
--rating-gold: #ffd700;          // Star ratings and highlights
```

---

## 📱 Responsive Breakpoints

```scss
// Mobile First Approach
$mobile: 480px;     // Small phones
$tablet: 768px;     // Tablets and large phones
$desktop: 1024px;   // Desktop and laptops
$large: 1200px;     // Large screens
$xlarge: 1440px;    // Extra large screens

// Usage Example
@media (max-width: $tablet) {
  .desktop-only { display: none; }
}

@media (min-width: $desktop) {
  .mobile-only { display: none; }
}
```

---

## 🎯 Typography Scale

### Font Families
```scss
--font-primary: 'Roboto', 'Helvetica Neue', sans-serif;
--font-icons: 'Material Icons';
--font-display: 'Roboto', system-ui, sans-serif;
```

### Type Scale
```scss
// Headings
.display-1 { font-size: 3rem; font-weight: 700; }      // 48px - Hero titles
.display-2 { font-size: 2.5rem; font-weight: 600; }    // 40px - Page titles
.heading-1 { font-size: 2rem; font-weight: 600; }      // 32px - Section headers
.heading-2 { font-size: 1.5rem; font-weight: 600; }    // 24px - Subsections
.heading-3 { font-size: 1.25rem; font-weight: 600; }   // 20px - Card titles

// Body Text
.body-large { font-size: 1.125rem; line-height: 1.6; } // 18px - Intro text
.body-medium { font-size: 1rem; line-height: 1.5; }    // 16px - Body text
.body-small { font-size: 0.875rem; line-height: 1.4; } // 14px - Captions

// UI Text
.label-large { font-size: 0.875rem; font-weight: 500; } // 14px - Button text
.label-small { font-size: 0.75rem; font-weight: 500; }  // 12px - Tags, labels
```

---

## 🎴 Component Patterns

### Cards
```scss
.game-card, .photo-card {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  overflow: hidden;
  
  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }
}
```

### Buttons
```scss
// Primary Action
.btn-primary {
  background: var(--primary-color);
  color: white;
  border-radius: 8px;
  padding: 12px 24px;
  font-weight: 500;
  text-transform: none;
  
  &:hover {
    background: var(--primary-dark);
  }
}

// Secondary Action
.btn-secondary {
  background: transparent;
  color: var(--primary-color);
  border: 2px solid var(--primary-color);
  border-radius: 8px;
  
  &:hover {
    background: var(--primary-color);
    color: white;
  }
}
```

### Navigation
```scss
.navbar {
  position: sticky;
  top: 0;
  z-index: 1000;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 8px 16px;
  border-radius: 6px;
  transition: background-color 0.2s ease;
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
  
  &.active {
    background-color: rgba(255, 255, 255, 0.15);
    font-weight: 500;
  }
}
```

---

## 📐 Spacing System

### Spacing Scale (rem-based)
```scss
--spacing-xs: 0.25rem;    // 4px
--spacing-sm: 0.5rem;     // 8px
--spacing-md: 1rem;       // 16px
--spacing-lg: 1.5rem;     // 24px
--spacing-xl: 2rem;       // 32px
--spacing-2xl: 3rem;      // 48px
--spacing-3xl: 4rem;      // 64px

// Component Spacing
.container { padding: var(--spacing-md); max-width: 1200px; margin: 0 auto; }
.section { margin-bottom: var(--spacing-2xl); }
.card-content { padding: var(--spacing-lg); }
```

---

## 🎨 Visual Effects

### Shadows
```scss
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.15);
--shadow-xl: 0 16px 32px rgba(0, 0, 0, 0.2);
```

### Gradients
```scss
--gradient-primary: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
--gradient-accent: linear-gradient(135deg, #e91e63 0%, #c2185b 100%);
--gradient-background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
--gradient-overlay: linear-gradient(to bottom, 
  rgba(0, 0, 0, 0.7) 0%, 
  rgba(0, 0, 0, 0.3) 50%, 
  rgba(0, 0, 0, 0.7) 100%);
```

### Animations
```scss
// Hover Transforms
.hover-lift {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  &:hover {
    transform: translateY(-2px);
  }
}

// Loading States
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.loading {
  animation: pulse 1.5s ease-in-out infinite;
}

// Smooth Transitions
.smooth-transition {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 🎮 Gaming-Specific Components

### Game Cards
```scss
.game-card {
  .game-image {
    aspect-ratio: 1;
    object-fit: cover;
    transition: transform 0.3s ease;
  }
  
  .rating-overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 4px 8px;
    border-radius: 8px;
    font-size: 0.875rem;
  }
  
  .rating-stars {
    color: var(--rating-gold);
    font-size: 0.75rem;
  }
}
```

### Photo Gallery
```scss
.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
  
  @media (max-width: $tablet) {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
}

.photo-overlay {
  opacity: 0;
  transition: opacity 0.3s ease;
  background: var(--gradient-overlay);
  
  .photo-card:hover & {
    opacity: 1;
  }
}
```

---

## 🎯 Accessibility Guidelines

### Color Contrast
- Ensure 4.5:1 contrast ratio for normal text
- Ensure 3:1 contrast ratio for large text
- Use semantic colors consistently

### Interactive Elements
```scss
// Focus States
.focusable {
  outline: 2px solid transparent;
  outline-offset: 2px;
  
  &:focus-visible {
    outline-color: var(--primary-color);
    outline-offset: 2px;
  }
}

// Touch Targets (44px minimum)
.touch-target {
  min-height: 44px;
  min-width: 44px;
  
  @media (max-width: $tablet) {
    min-height: 48px;
    min-width: 48px;
  }
}
```

---

## 🎨 Icon Usage

### Material Icons
```scss
.icon-sm { font-size: 1rem; width: 1rem; height: 1rem; }
.icon-md { font-size: 1.25rem; width: 1.25rem; height: 1.25rem; }
.icon-lg { font-size: 1.5rem; width: 1.5rem; height: 1.5rem; }
.icon-xl { font-size: 2rem; width: 2rem; height: 2rem; }

// Context-Specific Icons
.nav-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
.card-icon { font-size: 1rem; width: 1rem; height: 1rem; color: var(--text-secondary); }
.avatar-icon { font-size: 1.5rem; background: var(--primary-light); color: var(--primary-color); }
```

---

## 📱 Mobile-First Guidelines

### Layout Patterns
```scss
// Container Queries for Components
.responsive-container {
  padding: var(--spacing-md);
  max-width: 1200px;
  margin: 0 auto;
  
  @media (max-width: $tablet) {
    padding: var(--spacing-sm);
  }
}

// Grid Responsiveness
.responsive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
  
  @media (max-width: $tablet) {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
```

### Touch Interactions
```scss
// Hover States (Desktop Only)
@media (hover: hover) {
  .hover-effect:hover {
    background-color: var(--primary-light);
  }
}

// Touch-Friendly Spacing
.mobile-friendly {
  @media (max-width: $tablet) {
    padding: var(--spacing-lg);
    gap: var(--spacing-md);
  }
}
```

---

## 🏗️ Implementation Notes

### CSS Custom Properties Usage
```scss
// Always use CSS custom properties for theme values
.component {
  background: var(--background-primary);
  color: var(--text-primary);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-md);
}
```

### SCSS Organization
```
styles/
├── abstracts/
│   ├── _variables.scss    // Color palette, spacing, breakpoints
│   ├── _mixins.scss       // Reusable mixins
│   └── _functions.scss    // SCSS functions
├── base/
│   ├── _reset.scss        // CSS reset
│   ├── _typography.scss   // Font families and scales
│   └── _global.scss       // Global styles
├── components/
│   ├── _buttons.scss      // Button variations
│   ├── _cards.scss        // Card components
│   └── _navigation.scss   // Navigation styles
└── themes/
    ├── _light.scss        // Light theme variables
    └── _dark.scss         // Dark theme (future)
```

### Component Architecture
```typescript
// Standalone Component Pattern
@Component({
  selector: 'app-feature',
  standalone: true,
  imports: [CommonModule, MaterialModules...],
  templateUrl: './feature.component.html',
  styleUrls: ['./feature.component.scss']
})
export class FeatureComponent implements OnInit {
  // Implementation
}
```

---

## 🎯 Future Enhancements

### Dark Mode Support
```scss
// CSS Custom Properties for Theme Switching
:root {
  --theme-background: var(--background-primary);
  --theme-text: var(--text-primary);
}

[data-theme="dark"] {
  --theme-background: var(--dark-background);
  --theme-text: var(--dark-text);
}
```

### Animation Library
```scss
// Entrance Animations
@keyframes slideInUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.animate-slide-in {
  animation: slideInUp 0.3s ease-out;
}
```

---

## 🎮 Gaming Community Patterns

### Engagement Elements
- **Rating Systems**: Always use 1-10 scale with star visualization
- **Comment Threads**: Encourage community interaction
- **Photo Sharing**: Make uploading and viewing photos seamless
- **Game Discovery**: Emphasize filtering and search functionality

### Content Hierarchy
1. **Hero Section**: Big, bold introduction with clear CTA
2. **Feature Cards**: Equal prominence for Games and Photos
3. **Interactive Elements**: Filters, search, and social features
4. **Community Content**: User-generated ratings and photos

---

*This style guide serves as the foundation for all future Golgari Palace development and can be adapted for other gaming community websites.*

**Created for: Game Day at the Golgari Palace** 🏰🎲✨