# UI audit playbook

Use this playbook when a UI already exists.

## Audit levels

### Level 0 — no UI

No stable frontend or no visible conventions. Ask the style questionnaire before creating UI code.

### Level 1 — ad hoc UI

Symptoms:

- raw colors and one-off pixel values appear throughout screens;
- buttons, inputs, cards, and rows are hand-built repeatedly;
- Tailwind arbitrary values or inline styles are common;
- no Storybook or design-system docs;
- no semantic tokens.

Recommended path: create a UI contract, define starter tokens, extract the highest-churn components, add warnings.

### Level 2 — emerging UI system

Symptoms:

- shared components exist, but screens still bypass them;
- some tokens exist, but semantic naming is incomplete;
- variants are inconsistent or undocumented;
- Storybook exists but coverage is thin;
- lint rules catch generic issues but not design drift.

Recommended path: stabilize, consolidate, document, then enforce.

### Level 3 — mature UI system

Symptoms:

- semantic tokens and component variants are established;
- docs and stories exist for primitives;
- repeated layout patterns are centralized;
- lint/CI catches common drift;
- teams know where to add new variants.

Recommended path: follow the existing contract, update docs/stories for every change, and propose narrow improvements only.

## Scoring matrix

Score each category 0–3.

| Category | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Tokens | none | primitives only | semantic tokens partial | semantic tokens complete |
| Utilities/theme | raw values | framework defaults | customized theme | tokens feed utilities |
| Components | one-off markup | some wrappers | variants/sizes defined | component API prevents drift |
| Composition | no primitives | repeated layouts | partial layout primitives | shared templates/primitives |
| Docs | none | scattered notes | design contract exists | living docs + decisions |
| Storybook | none | installed only | key components | states, variants, composition |
| Guardrails | none | generic lint | UI warnings | CI/pre-commit enforcement |
| Accessibility | unknown | manual fixes | component-level states | documented and tested patterns |

## Drift finding format

Use this format for each issue:

```md
### Finding: inconsistent list row indentation

- Evidence: `src/features/a/StudyRow.tsx` uses `pl-6`; `src/features/b/ScreenRow.tsx` uses `pl-3`.
- Layer violated: composition primitive.
- Recommended fix: introduce `TreeRow` with `level`, `icon`, `title`, `subtitle`, and `actions` props.
- Guardrail: add Storybook examples for nested rows and ban bespoke tree-row spacing in review checklist.
```

## Common extraction candidates

- `Button`, `IconButton`, `LinkButton`
- `TextField`, `Select`, `Checkbox`, `Radio`, `Switch`, `FormField`
- `Card`, `Panel`, `Surface`
- `ListRow`, `TreeRow`, `TableRowAction`, `Toolbar`
- `PageHeader`, `PageShell`, `SidebarNav`, `Tabs`
- `Badge`, `Pill`, `StatusDot`, `Avatar`
- `EmptyState`, `LoadingState`, `ErrorState`
- `Stack`, `Inline`, `Cluster`, `Box`, `Container`

## Severity rubric

- **High**: drift affects repeated core components, accessibility, focus/disabled states, or brand-critical surfaces.
- **Medium**: drift affects a repeated layout or common screen pattern.
- **Low**: isolated visual mismatch with little reuse.

High and medium findings should usually be fixed at the component or composition layer, not with local class tweaks.
