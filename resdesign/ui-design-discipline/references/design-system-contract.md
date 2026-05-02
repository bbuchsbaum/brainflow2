# Design-system contract rules

A design-system contract turns taste into repo rules. It should be short enough to read, specific enough to review against, and updated when the UI changes.

## Required sections

1. **Authority map**
   - Where tokens live.
   - Where theme config lives.
   - Where shared components live.
   - Where stories live.
   - Where lint rules live.

2. **Design principles**
   - 3–5 statements that guide tradeoffs.
   - Example: "Prefer calm hierarchy over decorative contrast."

3. **Token model**
   - Primitive tokens: raw values.
   - Semantic tokens: usage-based names.
   - Component tokens when needed.
   - Allowed exceptions.

4. **Component contract**
   - Naming conventions.
   - Required props: `variant`, `size`, `intent`, `density` where useful.
   - State requirements: hover, focus, active, disabled, loading, selected, invalid.
   - Accessibility requirements.

5. **Composition patterns**
   - List rows.
   - Tree rows.
   - Cards/panels.
   - Forms.
   - Page shells.
   - Empty/loading/error states.

6. **Storybook coverage**
   - Which components require stories.
   - Required story states.
   - Visual regression policy if applicable.

7. **Lint and review rules**
   - Raw values policy.
   - Arbitrary utility policy.
   - Inline style policy.
   - New dependency policy.
   - New variant policy.

8. **Decision log**
   - Dated changes.
   - Reasoning.
   - Migration notes.

## Naming guidance

Prefer semantic names:

- `--color-text-primary`, not `--gray-950` in components.
- `--color-surface-raised`, not `--white` in components.
- `--color-border-subtle`, not `--gray-200` in components.
- `--space-2`, `--space-3`, or theme spacing utilities, not local pixel values.
- `variant="outline"`, `size="sm"`, not repeated utility strings on every screen.

Primitive tokens may use palette names. Semantic tokens should use purpose names.

## Decision rule

When two screens disagree, ask which layer should own the decision:

- Is it a value? Token.
- Is it a reusable class vocabulary? Theme/utility config.
- Is it an interactive element? Component.
- Is it a repeated layout? Composition primitive.
- Is it a convention? Documentation.
- Is it easy to regress? Lint/CI.
