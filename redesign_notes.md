# UI Redesign Notes (Desert Modern x Bauhaus)

Source prompt: evoke Josef Albers (interaction of color), Richard Neutra (glass/steel/horizontal lines), Finn Juhl (organic warmth within structure). Move away from generic DevTools blue-black toward a “Desert Modern” palette (Deep Charcoal, Stone, Teal, Burnt Orange) with Bauhaus typography (hierarchy, geometry).

## 1) Palette & Theme (ui2/src/styles/theme.css)
- Replace the cool gray theme with the architectural palette below.
- HSL values tuned for matte, mid-century finish; Bauhaus-tight radius (4px).

```css
@layer base {
  :root {
    /* DEFAULT (Light Mode - "The Kaufmann House") */
    --background: 40 10% 96%;      /* Warm White/Stone */
    --foreground: 20 10% 20%;      /* Dark Umber text */
    
    --card: 0 0% 100%;             /* Pure White */
    --card-foreground: 20 10% 20%;

    --popover: 0 0% 100%;
    --popover-foreground: 20 10% 20%;

    /* PRIMARY: Palm Springs Turquoise */
    --primary: 175 60% 40%;
    --primary-foreground: 0 0% 100%;

    /* SECONDARY: Neutral Concrete */
    --secondary: 40 10% 90%;
    --secondary-foreground: 20 10% 20%;

    /* MUTED: Architectural Gray */
    --muted: 40 10% 92%;
    --muted-foreground: 25 5% 45%;

    /* ACCENT: Solar Orange (Albers Interaction) */
    --accent: 25 90% 55%;
    --accent-foreground: 0 0% 100%;

    --destructive: 0 85% 60%;
    --destructive-foreground: 0 0% 100%;

    --border: 40 10% 85%;
    --input: 40 10% 85%;
    --ring: 175 60% 40%;

    --radius: 0.25rem; /* Tight, Bauhaus radii (4px) */
  }

  /* DARK MODE - "Midnight in the Desert" */
  .dark {
    --background: 220 15% 10%;     /* Deep Deep Blue-Grey (almost black) */
    --foreground: 40 10% 90%;      /* Warm Off-White */

    --card: 220 15% 14%;           /* Floating Panel Color */
    --card-foreground: 40 10% 90%;

    --popover: 220 15% 14%;
    --popover-foreground: 40 10% 90%;

    /* PRIMARY: Muted Cyan/Teal */
    --primary: 175 50% 50%;
    --primary-foreground: 220 15% 10%;

    /* SECONDARY: Darker element background */
    --secondary: 220 15% 18%;
    --secondary-foreground: 40 10% 90%;

    --muted: 220 15% 20%;
    --muted-foreground: 215 10% 65%;

    /* ACCENT: Burnt Orange for active states/sliders */
    --accent: 30 80% 55%;
    --accent-foreground: 0 0% 100%;

    --destructive: 0 60% 50%;
    --destructive-foreground: 0 0% 100%;

    --border: 220 15% 20%;         /* Low contrast borders */
    --input: 220 15% 20%;
    --ring: 175 50% 50%;
  }
}
```

## 2) GoldenLayout + Typography (ui2/src/index.css)
- Architectural labels: uppercase, wide tracking (Bauhaus).
- Splitters become negative space gaps; tabs float with color blocks for active state.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground font-sans antialiased;
    background-color: hsl(var(--background));
  }
  
  /* BAUHAUS TYPOGRAPHY UTILS */
  h1, h2, h3, h4, h5, h6 { @apply font-medium tracking-tight; }
  
  /* The "Blueprint" Label Style */
  .label-text { @apply text-[10px] uppercase tracking-widest text-muted-foreground font-semibold; }
}

/* --- GOLDEN LAYOUT OVERRIDES (The "Neutra" Look) --- */
.lm_header {
  background: hsl(var(--background)) !important;
  border-bottom: 1px solid hsl(var(--border));
  height: 32px !important;
  display: flex;
  align-items: center;
  padding-left: 4px;
}

.lm_tab {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  margin-right: 2px !important;
  color: hsl(var(--muted-foreground)) !important;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 12px !important;
  transition: all 0.2s ease;
  height: 30px !important;
  margin-top: 2px !important;
  border-radius: var(--radius) var(--radius) 0 0;
}

.lm_tab.lm_active {
  background: hsl(var(--card)) !important; /* Visual connection to content */
  color: hsl(var(--primary)) !important;
  border-top: 2px solid hsl(var(--accent)) !important; /* The pop of color */
  font-weight: 600;
  z-index: 10;
}

.lm_tab:hover:not(.lm_active) {
  background: hsl(var(--muted)) !important;
  color: hsl(var(--foreground)) !important;
}

.lm_close_tab { right: 8px !important; top: 8px !important; opacity: 0.5; }
.lm_close_tab:hover { opacity: 1; }

.lm_content { background: hsl(var(--card)) !important; }

.lm_splitter {
  background: hsl(var(--background)) !important; /* Match body bg to create gap */
  opacity: 1 !important;
  width: 6px !important;
  height: 6px !important;
}
.lm_splitter:hover, .lm_splitter.lm_dragging {
  background: hsl(var(--primary)) !important; /* Interaction feedback */
}
```

## 3) Sliders & Controls (ui2/src/styles/slider.css + shadcn.css)
- Precision over softness; Bauhaus geometry.

```css
/* The Track - Thin and precise */
.slider-track {
  background-color: hsl(var(--secondary));
  height: 2px;
  border-radius: 0;
}

/* The Range - High contrast */
.slider-range {
  background-color: hsl(var(--primary));
  height: 100%;
  border-radius: 0;
}

/* The Thumb - The "Object" in space */
.slider-thumb {
  background-color: hsl(var(--foreground));
  border: 2px solid hsl(var(--background));
  width: 14px;
  height: 14px;
  border-radius: 50%; /* swap to 0 for a brutalist square */
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  transition: transform 0.1s ease;
}

.slider-thumb:hover {
  transform: scale(1.2);
  background-color: hsl(var(--accent)); /* Interaction of color */
}
```

## 4) Component Visual Refactor (React)
- Swap borders for tonal separation. Panels float on `bg-card`.

```tsx
<div className="bg-card text-card-foreground rounded-md shadow-sm p-4 space-y-4">
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">
      Data Mapping
    </h3>
    <Icon className="w-4 h-4 opacity-50" />
  </div>
  <div className="space-y-6">
    {/* inputs */}
  </div>
</div>
```

## 5) Plot Polish (Histograms/Visx)
- Plot background transparent; let `hsl(var(--card))` show through.
- Grid lines: `hsl(var(--border))` low contrast.
- Bars: `hsl(var(--primary))` with ~80% opacity.
- Selection brush: `hsl(var(--accent))` at ~30% opacity.

## Summary
- Color: shift to Desert Midnight (charcoal + teal + burnt orange) from IDE dark.
- Space: borders → gaps; GoldenLayout panels float (Finn Juhl separation).
- Type: uppercase, wide-tracked labels (Bauhaus spec style).
- Controls: geometric sliders/inputs with high contrast (Albers interaction of color).
- First action: paste the palette block into `theme.css` and the GoldenLayout/typography overrides into `index.css`; most of the transformation happens there.
