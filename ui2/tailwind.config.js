/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ------------------------------------------------------------
        // shadcn-compatible HSL bridge — projection of `--bf-*` tokens.
        // ------------------------------------------------------------
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },

        // ------------------------------------------------------------
        // Canonical Brainflow tokens — Design.md §3.1 (`bf-*`).
        // Use these directly: bg-bf-bg-panel, text-bf-text-secondary,
        // border-bf-border-subtle, ring-bf-border-focus, etc.
        // ------------------------------------------------------------
        bf: {
          // Backgrounds
          'bg-app': 'var(--bf-bg-app)',
          'bg-shell': 'var(--bf-bg-shell)',
          'bg-panel': 'var(--bf-bg-panel)',
          'bg-panel-raised': 'var(--bf-bg-panel-raised)',
          'bg-panel-sunken': 'var(--bf-bg-panel-sunken)',
          'bg-canvas': 'var(--bf-bg-canvas)',
          'bg-input': 'var(--bf-bg-input)',
          'bg-hover': 'var(--bf-bg-hover)',
          'bg-active': 'var(--bf-bg-active)',
          'bg-selected': 'var(--bf-bg-selected)',
          // Borders & dividers
          'border-subtle': 'var(--bf-border-subtle)',
          border: 'var(--bf-border)',
          'border-strong': 'var(--bf-border-strong)',
          'border-focus': 'var(--bf-border-focus)',
          divider: 'var(--bf-divider)',
          // Text
          'text-primary': 'var(--bf-text-primary)',
          'text-secondary': 'var(--bf-text-secondary)',
          'text-muted': 'var(--bf-text-muted)',
          'text-faint': 'var(--bf-text-faint)',
          'text-inverse': 'var(--bf-text-inverse)',
          // Brand & interaction
          brand: 'var(--bf-brand)',
          accent: 'var(--bf-accent)',
          'accent-hover': 'var(--bf-accent-hover)',
          'accent-active': 'var(--bf-accent-active)',
          'accent-soft': 'var(--bf-accent-soft)',
          // Semantic
          success: 'var(--bf-success)',
          'success-soft': 'var(--bf-success-soft)',
          warning: 'var(--bf-warning)',
          'warning-soft': 'var(--bf-warning-soft)',
          danger: 'var(--bf-danger)',
          'danger-soft': 'var(--bf-danger-soft)',
          info: 'var(--bf-info)',
          // Anatomical orientation
          axial: 'var(--bf-axial)',
          sagittal: 'var(--bf-sagittal)',
          coronal: 'var(--bf-coronal)',
          crosshair: 'var(--bf-crosshair)',
          // Plot
          'plot-line': 'var(--bf-plot-line)',
          'plot-grid': 'var(--bf-plot-grid)',
          'plot-axis': 'var(--bf-plot-axis)',
        },
      },
      // Spacing scale aligned with Design.md §3.1 / §5
      spacing: {
        'control-xs': 'var(--app-control-height-xs)',
        'control-sm': 'var(--app-control-height-sm)',
        'control-md': 'var(--app-control-height-md)',
        'dock-min': 'var(--app-dock-min-height)',
        'dock-default': 'var(--app-dock-default-height)',
        'colormap-strip': 'var(--app-layer-colormap-strip-height)',
        'bf-1': 'var(--bf-space-1)',
        'bf-2': 'var(--bf-space-2)',
        'bf-3': 'var(--bf-space-3)',
        'bf-4': 'var(--bf-space-4)',
        'bf-5': 'var(--bf-space-5)',
        'bf-6': 'var(--bf-space-6)',
        'bf-topbar': 'var(--bf-topbar-h)',
        'bf-statusbar': 'var(--bf-statusbar-h)',
        'bf-time-row': 'var(--bf-time-row-h)',
        'bf-control': 'var(--bf-control-h)',
        'bf-control-sm': 'var(--bf-control-sm-h)',
        'bf-panel-header': 'var(--bf-panel-header-h)',
      },
      borderRadius: {
        appsm: 'var(--app-radius-sm)',
        appmd: 'var(--app-radius-md)',
        applg: 'var(--app-radius-lg)',
        'bf-xs': 'var(--bf-radius-xs)',
        'bf-sm': 'var(--bf-radius-sm)',
        'bf-md': 'var(--bf-radius-md)',
        'bf-lg': 'var(--bf-radius-lg)',
        'bf-pill': 'var(--bf-radius-pill)',
      },
      boxShadow: {
        'bf-panel': 'var(--bf-shadow-panel)',
        'bf-inset': 'var(--bf-shadow-inset)',
      },
      transitionDuration: {
        'bf-fast': 'var(--bf-motion-fast)',
        'bf-normal': 'var(--bf-motion-normal)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'role-title': 'var(--app-role-title-size)',
        'role-section': 'var(--app-role-section-size)',
        'role-label': 'var(--app-role-label-size)',
        'role-body': 'var(--app-role-body-size)',
        'role-value': 'var(--app-role-value-size)',
      },
      letterSpacing: {
        'role-title': 'var(--app-role-title-tracking)',
        'role-section': 'var(--app-role-section-tracking)',
      },
      minHeight: {
        'control-xs': 'var(--app-control-height-xs)',
        'control-sm': 'var(--app-control-height-sm)',
        'control-md': 'var(--app-control-height-md)',
        'dock-min': 'var(--app-dock-min-height)',
      },
      height: {
        'control-xs': 'var(--app-control-height-xs)',
        'control-sm': 'var(--app-control-height-sm)',
        'control-md': 'var(--app-control-height-md)',
        'dock-default': 'var(--app-dock-default-height)',
        'colormap-strip': 'var(--app-layer-colormap-strip-height)',
      },
    },
  },
  plugins: [
    require('tailwind-scrollbar')({ nocompatible: true }),
    require('tailwindcss-animate'),
  ],
}
