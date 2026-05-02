# Linting and guardrails

Use lint rules to enforce documented decisions, not to invent rules the design system has not agreed on.

## Rollout model

1. Document the rule in `docs/design-system/ui-contract.md`.
2. Add a warning-only check.
3. Fix high-signal violations.
4. Add an allowlist for genuine exceptions.
5. Turn the rule into CI enforcement only after the team has a clean baseline.

## Common guardrails

### Raw color values

Disallow raw hex values outside token files.

Allowed:

- token definition files;
- generated token output;
- third-party CSS resets when documented.

Flag:

- `#fff`, `#000000`, `#f3f4f6` in components or screens;
- raw `rgb()`, `hsl()`, or named colors in components when semantic tokens exist.

### Raw spacing, radii, and shadows

Flag:

- `style={{ padding: 13 }}`;
- `borderRadius: 7`;
- CSS values like `box-shadow: 0 1px 7px ...` outside token files;
- Tailwind arbitrary values like `p-[13px]`, `rounded-[7px]`, `shadow-[...]` unless allowlisted.

### Component bypass

When `Button`, `IconButton`, `Input`, or `Card` exists, flag repeated bespoke equivalents.

Examples:

- clickable `div` styled as a button;
- `button` with local class recipe duplicating a known variant;
- icons wrapped in one-off circular containers when `IconButton` exists.

### Inline style objects

Allow for dynamic values only:

- measured dimensions;
- CSS variable assignment from data;
- canvas/SVG/dynamic chart values.

Flag static styling that should be a token or class.

### Story coverage

For files under the shared UI component directory, require a nearby `*.stories.*` file or a documented exception.

## Suggested tools

- Stylelint for CSS-level checks such as disallowing raw hex colors.
- ESLint custom rules for JSX/TSX patterns such as inline style objects and component bypass.
- `eslint-plugin-tailwindcss` or custom checks for Tailwind class policies.
- Pre-commit/lint-staged for fast local feedback.
- CI for final enforcement.

## Example warning text

```text
UI token violation: raw color "#2563eb" used in src/components/Button.tsx.
Use a semantic token such as --color-accent or a theme utility such as bg-accent.
```

## Allowlist comment pattern

Use a consistent comment for temporary exceptions:

```ts
// ui-discipline-allow: measured runtime value, not a design token
```

Review allowlist comments during design-system cleanup.
