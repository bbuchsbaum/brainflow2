// ──────────────────────────────────────────────────────────────────────────
// Brainflow chrome ratchet (docs/plans/ui-redesign-phase2.md §C).
//
// Each rule is an alias of ESLint's core `no-restricted-syntax`, registered
// under the local `bf-ratchet` plugin so it can run at `error` severity next
// to the existing hex-literal warning and be allowlisted per rule, per file.
//
// Scope: src/**/*.{ts,tsx}, excluding the primitives (src/components/ui/bf),
// dev harnesses, tests and stories. Files that legitimately violate a rule
// (scientific/categorical palettes, data colours) are listed with a reason in
// eslint.ratchet-allowlist.json. That list may only shrink:
// src/__tests__/ratchetAllowlist.test.ts fails when an entry no longer fires.
// ──────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { builtinRules } from 'eslint/use-at-your-own-risk';

const restrictedSyntax = builtinRules.get('no-restricted-syntax');

// A class token starts at string start, whitespace, a variant colon or `!`.
const TOKEN_START = '(^|[\\s:!])';
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PROPS = 'text|bg|border|ring|fill|stroke|outline|from|to|via';

// Prose attributes (title, aria-*, alt, placeholder …) hold words, not classes.
const NOT_PROSE =
  ":not(JSXAttribute[name.name=/^(title|alt|placeholder|label|description|aria-[a-z]+)$/] > Literal)"

/** Selectors for a regex tested against string literals and template chunks. */
function inStrings(regex, message) {
  return [
    { selector: `Literal[value=/${regex}/]${NOT_PROSE}`, message },
    { selector: `TemplateElement[value.raw=/${regex}/]`, message },
  ]
}

export const RATCHET_RULES = {
  'no-palette-class': inStrings(
    `${TOKEN_START}(${PROPS})-(${PALETTE})-\\d+`,
    'Raw Tailwind palette colour class. Use a bf-* token class (theme.css) or a ui/bf primitive.',
  ),
  'no-px-text': inStrings(
    'text-\\[\\d+(\\.\\d+)?px\\]',
    'Arbitrary text-[Npx] size. Use the type scale (text-2xs/xs/sm …) from the design tokens.',
  ),
  'no-uppercase-tracking': inStrings(
    `${TOKEN_START}(uppercase|tracking-\\[|tracking-wide)`,
    'Tracked/uppercase label styling is retired (sentence case, no tracking). See .hillclimb/p2c/HYBRID.md.',
  ),
  'no-style-hex': [
    {
      selector: "JSXAttribute[name.name='style'] Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
      message: 'Hex colour in a JSX style prop. Use var(--bf-*) tokens.',
    },
    {
      selector: "JSXAttribute[name.name='style'] TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
      message: 'Hex colour in a JSX style prop. Use var(--bf-*) tokens.',
    },
  ],
  'no-raw-range': [
    {
      selector:
        "JSXOpeningElement[name.name='input']:has(JSXAttribute[name.name='type'][value.value='range'])",
      message: 'Raw <input type="range">. Use the Slider primitive from components/ui/bf.',
    },
  ],
  'no-handrolled-roles': [
    {
      selector: "JSXAttribute[name.name='role'][value.value=/^(tablist|radiogroup)$/]",
      message:
        'Hand-rolled tablist/radiogroup. Use Tabs or SegmentedControl from components/ui/bf.',
    },
  ],
  'no-raw-accent': inStrings(
    'var\\(--bf-accent[,)]',
    'Direct var(--bf-accent). Accent usage belongs to ui/bf primitives (or text-primary/border-primary).',
  ),
};

export const ratchetPlugin = {
  meta: { name: 'bf-ratchet' },
  rules: Object.fromEntries(Object.keys(RATCHET_RULES).map((name) => [name, restrictedSyntax])),
};

export const RATCHET_FILES = ['src/**/*.{ts,tsx}'];
export const RATCHET_IGNORES = [
  'src/components/ui/bf/**',
  'src/devHarness/**',
  'src/tests/**',
  '**/__tests__/**',
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.stories.{ts,tsx}',
  'src/test-setup.ts',
];

export const ratchetRuleConfig = Object.fromEntries(
  Object.entries(RATCHET_RULES).map(([name, selectors]) => [
    `bf-ratchet/${name}`,
    ['error', ...selectors],
  ]),
);

/** @type {{ file: string, rules: string[], reason: string }[]} */
export const ratchetAllowlist = JSON.parse(
  readFileSync(new URL('./eslint.ratchet-allowlist.json', import.meta.url), 'utf8'),
).entries;

/** Config blocks: the ratchet, then one `off` block per allowlist entry. */
export function ratchetConfigs({ ignoreAllowlist = false } = {}) {
  const blocks = [
    {
      files: RATCHET_FILES,
      ignores: RATCHET_IGNORES,
      plugins: { 'bf-ratchet': ratchetPlugin },
      rules: ratchetRuleConfig,
    },
  ];
  if (!ignoreAllowlist) {
    for (const entry of ratchetAllowlist) {
      blocks.push({
        files: [entry.file],
        rules: Object.fromEntries(entry.rules.map((r) => [`bf-ratchet/${r}`, 'off'])),
      });
    }
  }
  return blocks;
}
