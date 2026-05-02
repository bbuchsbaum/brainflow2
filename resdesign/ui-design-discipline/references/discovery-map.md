# UI discovery map

Use this reference to locate the existing UI source of truth before changing code.

## 1. Framework and package manager

Check:

- `package.json`
- `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`, `bun.lock`
- `next.config.*`, `vite.config.*`, `remix.config.*`, `astro.config.*`, `svelte.config.*`, `angular.json`, `nuxt.config.*`
- `tsconfig.json`, `jsconfig.json`

Record:

- frontend framework;
- package manager;
- build, lint, typecheck, test, Storybook scripts;
- module aliases for UI imports.

## 2. Tokens and theme

Check:

- `tailwind.config.*`
- `postcss.config.*`
- `style-dictionary.config.*`, `tokens.json`, `tokens/*.json`
- `src/styles/*`, `styles/*`, `app/globals.css`, `src/index.css`
- `theme.ts`, `theme.css`, `tokens.ts`, `colors.ts`, `spacing.ts`
- CSS custom properties like `--color-*`, `--space-*`, `--radius-*`, `--shadow-*`
- Tailwind semantic class names such as `text-text-primary`, `bg-surface-1`, `border-border-subtle`

Record:

- primitive tokens: raw color/spacing/type/radius/shadow values;
- semantic tokens: surface, text, border, accent, danger, success, focus;
- theme modes: light, dark, high contrast, density;
- exceptions where raw values are allowed.

## 3. Shared components

Check:

- `src/components/ui/*`
- `components/ui/*`
- `src/ui/*`
- `packages/ui/*`
- `libs/ui/*`
- `shared/ui/*`
- wrappers around Radix, Headless UI, Ariakit, React Aria, MUI, Chakra, Mantine, shadcn/ui, custom primitives

Record:

- component names;
- public props for `variant`, `size`, `density`, `intent`, `state`;
- whether components use tokens or raw utilities;
- whether consumers style variants manually.

## 4. Composition primitives and templates

Check for:

- `Stack`, `HStack`, `VStack`, `Box`, `Grid`, `Container`, `PageShell`, `Section`, `Card`, `ListRow`, `TreeRow`, `Toolbar`, `FormField`, `EmptyState`
- route-level templates and layouts;
- repeated markup in feature folders.

Record:

- patterns that should be extracted;
- places where two screens should align but use different markup;
- repeated icon sizes, row heights, indentation, gaps, or button variants.

## 5. Documentation and examples

Check:

- `docs/design-system/*`
- `docs/style-guide*`, `docs/brand*`, `docs/ui*`, `docs/frontend*`
- `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`
- `.storybook/*`, `*.stories.*`, `*.mdx`
- design screenshots, mockups, Figma links, `design.md`

Record:

- current source of truth;
- missing docs;
- conflicts between docs and implementation.

## 6. Enforcement

Check:

- ESLint config files;
- Stylelint config files;
- Prettier config;
- Husky, Lefthook, pre-commit, lint-staged;
- CI workflow files;
- Chromatic, Playwright, Cypress, Vitest, Jest, Testing Library;
- visual regression scripts.

Record:

- existing guardrails;
- candidate guardrails;
- checks that should remain warnings during migration.
