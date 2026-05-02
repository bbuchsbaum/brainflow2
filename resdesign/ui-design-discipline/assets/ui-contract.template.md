# UI design-system contract

Last updated: {{DATE}}

## Authority map

| Layer | Source of truth | Notes |
|---|---|---|
| Design principles | `docs/design-system/ui-contract.md` | This file |
| Tokens | TBD | Colors, spacing, type, radius, shadow |
| Theme/utilities | TBD | Tailwind/theme/CSS-in-JS config |
| Components | TBD | Shared primitives and wrappers |
| Composition patterns | TBD | Rows, cards, forms, page shells |
| Stories/examples | TBD | Storybook/MDX/examples |
| Guardrails | TBD | ESLint/Stylelint/CI/review checklist |

## Design principles

1. TBD
2. TBD
3. TBD

## Token model

### Primitive tokens

Primitive tokens define raw values and should not be consumed directly by app screens.

- `--palette-*`
- `--space-*`
- `--font-*`
- `--radius-*`
- `--shadow-*`

### Semantic tokens

Semantic tokens describe use.

- `--color-text-primary`
- `--color-text-secondary`
- `--color-surface-1`
- `--color-surface-raised`
- `--color-border-subtle`
- `--color-border-strong`
- `--color-accent`
- `--color-accent-contrast`
- `--color-danger`
- `--color-focus-ring`

## Component contract

Shared components own visual variants. Screens should not recreate variants with local class recipes.

Required baseline components:

- `Button`
- `IconButton`
- `Input` / `TextField`
- `Select` / `DropdownMenu`
- `Card` / `Panel`
- `Badge` / `StatusPill`
- `ListRow` / `TreeRow`
- `PageHeader`
- `EmptyState`

## Composition patterns

Document repeated layout decisions here.

### List row

- Height: TBD
- Padding: TBD
- Icon size: TBD
- Title/subtitle typography: TBD
- Action placement: TBD

### Tree row

- Indentation model: TBD
- Expand/collapse affordance: TBD
- Icon treatment: TBD

### Page shell

- Max width: TBD
- Header spacing: TBD
- Section spacing: TBD

## Storybook coverage

Stories required for shared components:

- default;
- variants;
- sizes;
- disabled/loading/error states where applicable;
- realistic composition examples.

## Lint and review rules

- No raw colors outside token files.
- No static inline styles when tokens/classes can express the value.
- No arbitrary utility values without a documented exception.
- No bespoke button/input/card equivalents when shared components exist.
- New variants require docs and stories.

## Decision log

| Date | Decision | Reason | Follow-up |
|---|---|---|---|
| {{DATE}} | Created UI contract | Establish a source of truth | Fill TBD sections |
