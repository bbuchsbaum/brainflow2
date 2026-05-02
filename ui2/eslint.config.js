import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

// ──────────────────────────────────────────────────────────────────────────
// Brainflow UI design discipline — see docs/design-system/ui-contract.md §8.
//
// Warn (not error) when a TSX/TS file contains a raw 6-digit hex literal
// outside the allowlist. Components must read semantic tokens from
// `theme.css` / Tailwind's `bf-*` palette instead.
//
// Allowlist (rule disabled in these paths):
//   - src/styles/**          — token definitions
//   - src/types/**           — BIDS / filesystem domain data
//   - src/stores/fileBrowserStore.ts — file-type domain colors
//   - **/__tests__/**        — fixtures and snapshots
//   - **/*.test.{ts,tsx}     — test files
// ──────────────────────────────────────────────────────────────────────────
const designTokenRule = {
  // Match string literals that are exactly a 6-digit hex color (no alpha).
  // 8-digit (#rrggbbaa) is much rarer in this codebase; keep the rule simple.
  selector: "Literal[value=/^#[0-9a-fA-F]{6}$/]",
  message:
    'Raw hex color literal. Use a --bf-* token from theme.css or a bf-* Tailwind class (see resdesign/Design.md §3.1 and docs/design-system/ui-contract.md §2).',
}

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-restricted-syntax': ['warn', designTokenRule],
    },
  },
  // Allowlist: token definitions, domain data, tests.
  // See resdesign/HEX_TRIAGE.md for the categorization rationale.
  {
    files: [
      // Category A — token definitions and scientific palettes
      'src/styles/**',
      'src/types/**',
      'src/components/ui/colormapOptions.ts',
      // Category A — domain data stores
      'src/stores/fileBrowserStore.ts',
      'src/stores/crosshairSettingsStore.ts',
      // Category A — colorblind-safe categorical palette (Wong) for BIDS events
      'src/components/bids/BidsEventsTimeline.tsx',
      // Category B — annotation defaults (TODO: move to --bf-annotation-* tokens)
      'src/components/annotations/**',
      // Tests
      '**/__tests__/**',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
])
