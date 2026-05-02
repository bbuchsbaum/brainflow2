# Migration roadmap

Use this when moving a repo from ad hoc UI to a disciplined design system.

## Phase 1 — map and freeze

Goal: stop making drift worse.

- Build a UI authority map.
- Identify the top 5 repeated components or layouts.
- Create `docs/design-system/ui-contract.md` if missing.
- Add a review rule: new UI should use existing tokens/components or document why not.
- Do not enforce strict lint yet unless the baseline is already clean.

## Phase 2 — tokenize

Goal: define shared values.

- Extract palette primitives.
- Map semantic tokens for text, surface, border, accent, danger, success, warning, focus.
- Define spacing, radius, shadow, and type scales.
- Feed tokens into Tailwind/theme/CSS custom properties.
- Replace high-churn raw values first.

## Phase 3 — componentize

Goal: make common decisions hard to get wrong.

- Standardize `Button`, `IconButton`, inputs, cards, badges, menus.
- Define `variant`, `size`, `intent`, and `density` props.
- Remove screen-level class recipes that duplicate component variants.
- Add stories for variants and states.

## Phase 4 — compose

Goal: eliminate layout drift.

- Extract `Stack`, `Inline`, `PageShell`, `PageHeader`, `Toolbar`, `ListRow`, `TreeRow`, `EmptyState`.
- Replace repeated markup across feature folders.
- Add composition stories showing realistic usage.

## Phase 5 — document and enforce

Goal: make consistency sustainable.

- Update docs and decision log.
- Add warning-only lint checks.
- Fix violations in touched areas.
- Add CI enforcement when the baseline is clean.
- Consider visual regression after Storybook coverage is meaningful.

## Practical first slice

Choose one repeated problem that users or reviewers can see, such as inconsistent buttons or row alignment. Fix it by:

1. documenting the rule;
2. extracting or updating the shared component;
3. changing two or three representative screens;
4. adding stories;
5. adding a warning guardrail.

Avoid huge rewrites. Consistency work succeeds when every small change makes the next drift harder.
