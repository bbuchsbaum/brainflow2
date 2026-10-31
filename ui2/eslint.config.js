import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';
import { readdirSync } from 'node:fs';
import { ratchetConfigs } from './eslint.ratchet.js';

// ──────────────────────────────────────────────────────────────────────────
// Module boundaries (docs/plans/module-architecture.md, Guardrails;
// src/modules/AGENTS.md). Every folder under src/modules/ except `api` and
// `__tests__` is a module.
//   - Module code imports only `@/modules/api` (incl. `@/modules/api/host`),
//     `@/components/ui/bf`, `@brainflow/api`, packages, and its own folder:
//     `./x` siblings or `@/modules/<id>/…` (no `../`, so nothing can climb out).
//     Never `@tauri-apps/*`: the bridge goes through `@/modules/api/host`.
//   - Core code never imports a module's folder; it uses the framework files
//     at the top of src/modules (registry, settingsStore, runtime, …) and
//     `@/modules/api`. The dev harness drives module stores directly, so it is
//     exempt. Module tests may import test utilities but follow the same rule.
// ──────────────────────────────────────────────────────────────────────────
const MODULE_IDS = readdirSync(new URL('./src/modules/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'api' && entry.name !== '__tests__')
  .map((entry) => entry.name);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function moduleBoundaryConfig(id) {
  const own = escapeRegex(id);
  return {
    files: [`src/modules/${id}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^@/(?!modules/api(/|$)|components/ui/bf(/|$)|modules/${own}(/|$))`,
              message:
                'A module imports only @/modules/api, @/components/ui/bf and its own folder (src/modules/AGENTS.md).',
            },
            {
              regex: '^\\.\\./',
              message: `Import across the module folder as @/modules/${id}/…, never with ../.`,
            },
            {
              regex: '^@tauri-apps/',
              message: 'Modules reach the bridge through @/modules/api/host, not Tauri directly.',
            },
          ],
        },
      ],
    },
  };
}

const coreBoundaryConfig = MODULE_IDS.length
  ? [
      {
        files: ['src/**/*.{ts,tsx}'],
        ignores: ['src/modules/**', 'src/devHarness/**'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  regex: `(^@/|/)modules/(${MODULE_IDS.map(escapeRegex).join('|')})(/|$)`,
                  message:
                    "Core code never imports a module's folder; use @/modules/registry or @/modules/api.",
                },
              ],
            },
          ],
        },
      },
    ]
  : [];

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
  selector: 'Literal[value=/^#[0-9a-fA-F]{6}$/]',
  message:
    'Raw hex color literal. Use a --bf-* token from theme.css or a bf-* Tailwind class (see resdesign/Design.md §3.1 and docs/design-system/ui-contract.md §2).',
};

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
  // Chrome ratchet (errors) and its shrink-only allowlist; see eslint.ratchet.js.
  // BF_RATCHET_IGNORE_ALLOWLIST=1 drops the allowlist (used by the shrink test).
  ...ratchetConfigs({ ignoreAllowlist: process.env.BF_RATCHET_IGNORE_ALLOWLIST === '1' }),
  ...MODULE_IDS.map(moduleBoundaryConfig),
  ...coreBoundaryConfig,
]);
