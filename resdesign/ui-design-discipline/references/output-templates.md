# Output templates

Use these response formats for consistency.

## Audit response

```md
## UI authority map

- Tokens/theme: ...
- Shared components: ...
- Composition primitives: ...
- Docs/source of truth: ...
- Storybook/examples: ...
- Lint/CI guardrails: ...

## Maturity assessment

Emerging / ad hoc / mature / no UI.

Why: ...

## Consistency risks

1. ...
2. ...
3. ...

## Recommended path

Primary strategy: stabilize / consolidate / tokenize / document / enforce / redesign.

Rationale: ...

## First implementation slice

- ...

## Guardrails

- ...

## Verification

- `...`
```

## Implementation response

```md
## What changed

- `path/to/file`: why it changed.

## Design-system decision

The visual decision now lives at the ... layer instead of the ... layer.

## Storybook/docs

- ...

## Guardrails

- ...

## Verification

- Ran `...`: passed.
- Not run: `...` because ...
```

## No-UI interview response

```md
I do not see a stable UI system yet. I can help create one from a preset direction or from scratch.

Preset directions:

- Linear-inspired minimal productivity
- Vercel-inspired monochrome developer tool
- Stripe-inspired polished SaaS
- Calm enterprise dashboard
- Editorial/content-heavy
- Playful consumer app

I will use these as broad inspiration only, not exact copies.

To create the first UI contract, answer these:

1. ...
2. ...
3. ...
```

## Drift diagnosis response

```md
## Likely root cause

This was built at the utility layer instead of the component/composition layer.

## Evidence

- ...

## Fix

Extract/update `<SharedPrimitive>` so the decision lives in one place.

## Prevention

- Add story: ...
- Add contract rule: ...
- Add lint/review guardrail: ...
```
