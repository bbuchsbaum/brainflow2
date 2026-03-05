/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Support for CSS variables with opacity
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
          400: '#fbbf24', // Medical yellow
          500: '#f59e0b',
          600: '#d97706',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        // Neuroimaging-specific color palette
        brain: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        gray: {
          850: '#1e293b',
          950: '#0f172a',
        }
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
      spacing: {
        'control-xs': 'var(--app-control-height-xs)',
        'control-sm': 'var(--app-control-height-sm)',
        'control-md': 'var(--app-control-height-md)',
      },
      borderRadius: {
        appsm: 'var(--app-radius-sm)',
        appmd: 'var(--app-radius-md)',
        applg: 'var(--app-radius-lg)',
      },
      minHeight: {
        'control-xs': 'var(--app-control-height-xs)',
        'control-sm': 'var(--app-control-height-sm)',
        'control-md': 'var(--app-control-height-md)',
      },
      height: {
        'control-xs': 'var(--app-control-height-xs)',
        'control-sm': 'var(--app-control-height-sm)',
        'control-md': 'var(--app-control-height-md)',
      },
    },
  },
  plugins: [
    require('tailwind-scrollbar')({ nocompatible: true }),
    require('tailwindcss-animate'),
  ],
}
