# Storybook playbook

Use this when adding or improving component documentation.

## When Storybook already exists

1. Find `.storybook/main.*` and `.storybook/preview.*`.
2. Identify the story file pattern used in the repo.
3. Add stories near the component using the repo convention.
4. Cover variants and states.
5. Run the existing Storybook build script if present.

## When Storybook does not exist

Do not install dependencies automatically unless the user requested implementation and the repo permits dependency changes. Propose setup first.

Recommended setup plan:

1. Confirm framework and package manager.
2. Run the official Storybook initializer for the package manager.
3. Configure global CSS/theme imports in `.storybook/preview.*`.
4. Add stories for foundational components.
5. Add `storybook` and `build-storybook` scripts if the initializer did not add them.
6. Add visual regression only after stories are stable.

## First stories to create

- `Button`
- `IconButton`
- `Input` or `TextField`
- `Select` or `DropdownMenu`
- `Card` or `Panel`
- `Badge` or `StatusPill`
- `ListRow` or `TreeRow`
- `PageHeader`
- `EmptyState`

## Required story states

For each shared component, include the states that apply:

- default;
- variants;
- sizes;
- disabled;
- loading;
- selected/active;
- invalid/error;
- focus-visible guidance;
- icon-leading/icon-trailing;
- long text / overflow;
- light and dark theme examples if supported.

## Story naming pattern

Use names that map to design decisions:

```tsx
export const Variants = {}
export const Sizes = {}
export const States = {}
export const WithIcons = {}
export const InToolbar = {}
export const InListRow = {}
```

## MDX documentation pattern

For mature systems, add MDX docs with:

- component purpose;
- when to use;
- when not to use;
- props table;
- accessibility notes;
- examples;
- related components.
