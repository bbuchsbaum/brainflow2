// Token colours with Tailwind opacity modifiers (e.g. border-bf-danger/40).
const withAlpha = (token) =>
  `color-mix(in srgb, var(${token}) calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  // The app is dark-only today; `dark:` variants must not follow the OS setting.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
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
          'bg-app': withAlpha('--bf-bg-app'),
          'bg-shell': withAlpha('--bf-bg-shell'),
          'bg-panel': withAlpha('--bf-bg-panel'),
          'bg-panel-raised': withAlpha('--bf-bg-panel-raised'),
          'bg-panel-sunken': withAlpha('--bf-bg-panel-sunken'),
          'bg-canvas': withAlpha('--bf-bg-canvas'),
          'bg-input': withAlpha('--bf-bg-input'),
          'bg-hover': withAlpha('--bf-bg-hover'),
          'bg-active': withAlpha('--bf-bg-active'),
          'bg-selected': withAlpha('--bf-bg-selected'),
          // Borders & dividers
          'border-subtle': withAlpha('--bf-border-subtle'),
          border: withAlpha('--bf-border'),
          'border-strong': withAlpha('--bf-border-strong'),
          'border-field': withAlpha('--bf-border-field'),
          'border-focus': withAlpha('--bf-border-focus'),
          divider: withAlpha('--bf-divider'),
          // Text
          'text-primary': withAlpha('--bf-text-primary'),
          'text-secondary': withAlpha('--bf-text-secondary'),
          'text-muted': withAlpha('--bf-text-muted'),
          'text-faint': withAlpha('--bf-text-faint'),
          'text-inverse': withAlpha('--bf-text-inverse'),
          // Brand & interaction
          brand: withAlpha('--bf-brand'),
          accent: withAlpha('--bf-accent'),
          'accent-hover': withAlpha('--bf-accent-hover'),
          'accent-active': withAlpha('--bf-accent-active'),
          'accent-soft': withAlpha('--bf-accent-soft'),
          // Semantic
          success: withAlpha('--bf-success'),
          'success-soft': withAlpha('--bf-success-soft'),
          warning: withAlpha('--bf-warning'),
          'warning-soft': withAlpha('--bf-warning-soft'),
          danger: withAlpha('--bf-danger'),
          'danger-soft': withAlpha('--bf-danger-soft'),
          info: withAlpha('--bf-info'),
          // Anatomical orientation
          axial: withAlpha('--bf-axial'),
          sagittal: withAlpha('--bf-sagittal'),
          coronal: withAlpha('--bf-coronal'),
          crosshair: withAlpha('--bf-crosshair'),
          // Plot
          'plot-line': withAlpha('--bf-plot-line'),
          'plot-grid': withAlpha('--bf-plot-grid'),
          'plot-axis': withAlpha('--bf-plot-axis'),
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
        sans: ['var(--bf-font-sans)'],
        mono: ['var(--bf-font-mono)'],
      },
      fontSize: {
        // Type scale: the only sizes UI chrome should use.
        'bf-2xs': ['var(--bf-text-2xs)', { lineHeight: '14px' }],
        'bf-xs': ['var(--bf-text-xs)', { lineHeight: '16px' }],
        'bf-sm': ['var(--bf-text-sm)', { lineHeight: '18px' }],
        'bf-md': ['var(--bf-text-md)', { lineHeight: '20px' }],
        'bf-lg': ['var(--bf-text-lg)', { lineHeight: '22px' }],
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
  plugins: [require('tailwind-scrollbar')({ nocompatible: true }), require('tailwindcss-animate')],
};
