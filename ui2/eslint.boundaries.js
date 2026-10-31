// ──────────────────────────────────────────────────────────────────────────
// Module boundaries (docs/plans/module-architecture.md, Guardrails;
// src/modules/AGENTS.md). Every folder under src/modules/ except `api` and
// `__tests__` is a module; the files at the top of src/modules/ and `api/`
// are the framework.
//
//   - Module code imports only `@/modules/api` (incl. `api/host`),
//     `@/components/ui/bf`, `@brainflow/api`, packages and its own folder
//     (`./x` or `@/modules/<id>/…`), never `@tauri-apps/*`, and no path may
//     contain a `..` segment (`../`, `./../`, `@/modules/<id>/../`). Dynamic
//     `import()` follows the same rules and needs a literal path.
//   - A manifest (`<id>/module.ts`) is static data the registry loads during
//     tab restore: it imports only `@/modules/api` (type-only imports aside)
//     and loads its code with `() => import('./…')`.
//   - The module API entry (`api/index.ts`, `api/types.ts`) has no runtime
//     dependencies: type-only imports only, no `import()`.
//   - Framework files import no module internals; `index.ts` imports only
//     manifests (`./<id>/module`).
//   - Core code never imports a module folder (statically, dynamically or
//     through `..`); the dev harness is exempt (scenarios drive module stores).
//
// `src/modules/__tests__/boundaries.test.ts` probes each rule.
// ──────────────────────────────────────────────────────────────────────────
import { readdirSync } from 'node:fs';
import { builtinRules } from 'eslint/use-at-your-own-risk';

/** Dynamic `import()` checks: ESLint's no-restricted-syntax under a local name. */
export const boundaryPlugin = {
  meta: { name: 'bf-boundaries' },
  rules: { 'dynamic-imports': builtinRules.get('no-restricted-syntax') },
};

export const MODULE_IDS = readdirSync(new URL('./src/modules/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'api' && entry.name !== '__tests__')
  .map((entry) => entry.name);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** esquery regex literals cannot contain `/`: spell it `\x2F`. */
const inSelector = (regex) => regex.replaceAll('/', '\\x2F');
/** `import(<string matching regex>)`. */
const dynamicImport = (regex, message) => ({
  selector: `ImportExpression[source.value=/${inSelector(regex)}/]`,
  message,
});

/** A `..` path segment anywhere. */
const DOT_DOT = '(^|/)\\.\\.(/|$)';
/** An alias path with a `..` segment. */
const ALIAS_DOT_DOT = '^@/(.*/)?\\.\\.(/|$)';

function moduleConfig(id) {
  const own = escapeRegex(id);
  const outside = `^@/(?!modules/api(/|$)|components/ui/bf(/|$)|modules/${own}(/|$))`;
  const outsideMessage =
    'A module imports only @/modules/api, @/components/ui/bf and its own folder (src/modules/AGENTS.md).';
  const dotDotMessage = `No .. in module imports: use ./x or @/modules/${id}/….`;
  const tauriMessage = 'Modules reach the bridge through @/modules/api/host, not Tauri directly.';
  return {
    files: [`src/modules/${id}/**/*.{ts,tsx}`],
    plugins: { 'bf-boundaries': boundaryPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: outside, message: outsideMessage },
            { regex: DOT_DOT, message: dotDotMessage },
            { regex: '^@tauri-apps/', message: tauriMessage },
          ],
        },
      ],
      'bf-boundaries/dynamic-imports': [
        'error',
        dynamicImport(outside, outsideMessage),
        dynamicImport(DOT_DOT, dotDotMessage),
        dynamicImport('^@tauri-apps/', tauriMessage),
        {
          selector: "ImportExpression:not([source.type='Literal'])",
          message: 'A module’s import() needs a literal path, so its boundary can be checked.',
        },
      ],
    },
  };
}

const manifestConfig = {
  files: ['src/modules/*/module.ts'],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: '^(?!@/modules/api$)',
            allowTypeImports: true,
            message:
              'A manifest is static data loaded with the registry: import only @/modules/api and load code with () => import(…).',
          },
        ],
      },
    ],
  },
};

const API_ENTRY_MESSAGE =
  'The module API entry has no runtime dependencies (manifests load it with the registry). Use type-only imports; app services belong in api/host.ts.';

/** `api/types.ts` imports types only; `api/index.ts` may re-export it as well. */
function apiEntryConfig(file, allowed) {
  return {
    files: [file],
    plugins: { 'bf-boundaries': boundaryPlugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ regex: allowed, allowTypeImports: true, message: API_ENTRY_MESSAGE }] },
      ],
      'bf-boundaries/dynamic-imports': ['error', { selector: 'ImportExpression', message: API_ENTRY_MESSAGE }],
    },
  };
}

function frameworkConfigs(ids) {
  const list = ids.map(escapeRegex).join('|');
  const internals = `(^\\./|^@/modules/|/modules/)(${list})(/|$)`;
  const internalsMessage = 'Framework files never import module internals; the registry loads modules.';
  const notManifest = `(^\\./|^@/modules/|/modules/)(${list})(/(?!module$)|$)`;
  const manifestMessage = 'index.ts lists module manifests only (./<id>/module).';
  return [
    {
      files: ['src/modules/*.{ts,tsx}'],
      ignores: ['src/modules/index.ts'],
      plugins: { 'bf-boundaries': boundaryPlugin },
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ regex: internals, message: internalsMessage }] }],
        'bf-boundaries/dynamic-imports': ['error', dynamicImport(internals, internalsMessage)],
      },
    },
    {
      files: ['src/modules/index.ts'],
      plugins: { 'bf-boundaries': boundaryPlugin },
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ regex: notManifest, message: manifestMessage }] }],
        'bf-boundaries/dynamic-imports': ['error', dynamicImport(internals, manifestMessage)],
      },
    },
  ];
}

function coreConfig(ids) {
  const list = ids.map(escapeRegex).join('|');
  const intoModule = `(^@/|/)modules/(${list})(/|$)`;
  const message = "Core code never imports a module's folder; use @/modules/registry or @/modules/api.";
  const dotDotMessage = 'No .. in @/ alias paths.';
  return {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/modules/**', 'src/devHarness/**'],
    plugins: { 'bf-boundaries': boundaryPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: intoModule, message },
            { regex: ALIAS_DOT_DOT, message: dotDotMessage },
          ],
        },
      ],
      'bf-boundaries/dynamic-imports': [
        'error',
        dynamicImport(intoModule, message),
        dynamicImport(ALIAS_DOT_DOT, dotDotMessage),
      ],
    },
  };
}

/** Config blocks for the module boundaries. */
export function boundaryConfigs(ids = MODULE_IDS) {
  return [
    ...ids.map(moduleConfig),
    manifestConfig,
    apiEntryConfig('src/modules/api/types.ts', '.*'),
    apiEntryConfig('src/modules/api/index.ts', '^(?!\\./types$)'),
    ...(ids.length ? [...frameworkConfigs(ids), coreConfig(ids)] : []),
  ];
}
