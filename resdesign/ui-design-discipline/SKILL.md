---
name: ui-design-discipline
description: Use when auditing UI consistency, establishing or hardening a design system, defining design tokens, taming visual drift, organizing component variants, setting up Storybook, configuring Tailwind/CSS theme, extracting shared primitives, or adding ESLint/Stylelint guardrails. Establishes a UI source of truth and prevents style drift by pushing decisions up the stack from utilities to tokens, components, composition primitives, docs, and lint.
---

# UI Design Discipline Skill

You are the repository's UI consistency steward. Your job is to make UI decisions explicit, central, documented, reusable, and enforceable.

## When to use this skill

Use when the user asks about: UI consistency, theming, design tokens, component variants, Storybook coverage, visual audits, Tailwind/CSS discipline, component libraries, layout primitives, lint rules, or whenever a UI change risks visual drift.

## When NOT to use this skill

- For opinionated style enforcement (typography rules, "every pixel is a decision") — defer to the `design-principles` skill.
- For creating a new distinctive UI from scratch with high design quality — defer to the `frontend-design` skill.
- For backend, API, or non-visual concerns.

This skill owns the *consistency / discipline / guardrails* niche, not green-field aesthetics.

## Quick start

On first invocation:

1. Build a UI authority map (where tokens, components, stories, and lint rules live).
2. Classify maturity: mature, emerging, ad hoc, or no UI.
3. Recommend a primary path: stabilize, consolidate, tokenize, document, enforce, or redesign.
4. Implement the smallest useful slice — one repeated drift, fixed at the right layer.
5. Add guardrails (story, contract rule, lint warning) so the drift cannot return.
6. Verify with the repo's existing lint, typecheck, test, and Storybook scripts.

## Core principle

Push decisions up the stack:

**tokens → utilities/theme → components → composition primitives/templates → documentation → lint/CI guardrails**

Never solve repeated UI drift by copying one-off markup unless you also identify the shared primitive or rule that would prevent the drift from returning.

## Standard source-of-truth locations

Prefer these unless the repository already has an equivalent convention:

- `docs/design-system/ui-contract.md` — canonical UI contract and review rules.
- `docs/design-system/component-index.md`, `tokens.md`, `patterns.md`, `decisions.md` — supporting docs.
- Token files in `src/styles/`, `app/globals.css`, `packages/ui/tokens/*`, or `tailwind.config.*`.
- Component wrappers in `src/components/ui/*`, `packages/ui/src/*`, or the repo's established UI package.
- Storybook in `.storybook/*` plus `*.stories.*`.
- ESLint, Stylelint, pre-commit, and CI configs for enforcement.

When another standard location already exists, map it in the authority map and do not create competing documents.

## First action: build a UI authority map

Before changing UI code, inspect the repo. Open `references/discovery-map.md` for the exact files and folders to inspect, and the questions to answer about framework, package manager, tokens, components, composition primitives, docs, and enforcement.

Bundled references (open on demand):

- `references/discovery-map.md` — exact files and folders to inspect.
- `references/ui-audit-playbook.md` — audit checklist, scoring matrix, drift finding format.
- `references/style-questionnaire.md` — questions to ask when no UI system exists.
- `references/design-system-contract.md` — required sections of the UI contract.
- `references/storybook-playbook.md` — Storybook setup and story generation.
- `references/linting-guardrails.md` — lint and CI rollout model.
- `references/migration-roadmap.md` — phased path from ad hoc UI to a system.
- `references/output-templates.md` — canonical response formats.

Bundled scripts (run only when appropriate):

- `scripts/ui_inventory.py` — scans a repo and writes `.ui-discipline/audit-report.md` and `.ui-discipline/audit-report.json`.
- `scripts/create_ui_contract.py` — creates `docs/design-system/ui-contract.md` from the template when missing.

Prefer `python3` when invoking scripts. If Python 3 is unavailable or the user prefers manual exploration, skip the scripts and fall back to Grep/Glob to gather the same signals: raw hex matches, inline `style={{ }}` attributes, arbitrary Tailwind values like `p-[13px]`, CSS variable definitions, and existing component directories. Do not run scripts that would overwrite existing files without preserving them first.

## Existing UI workflow

When a UI already exists, do not immediately replace it. Audit and propose.

1. **Inventory** — use repo search and, when useful, `scripts/ui_inventory.py`. Identify tokens, theme config, UI wrappers, stories, docs, and lint rules. Note conflicts and authoritative sources.
2. **Classify maturity** — `mature`, `emerging`, `ad hoc`, or `no UI`. See the scoring matrix in `references/ui-audit-playbook.md`.
3. **Find drift symptoms** — raw hex outside token files, inconsistent button/input/card variants, arbitrary Tailwind values, duplicated row/list/card markup, inconsistent focus/disabled states, layout spacing drift, variants implemented by class concatenation, missing stories. Full list in `references/ui-audit-playbook.md`.
4. **Recommend path** — choose one primary strategy: **Stabilize**, **Consolidate**, **Tokenize**, **Document**, **Enforce**, or **Redesign** (only when the user explicitly asks for redesign).
5. **Implement carefully** — prefer existing components, semantic tokens, and component props over screen-level recipes. Add or update stories for any shared component changed. Add lint rules only after the source of truth exists. Run available lint/test/typecheck/Storybook scripts when feasible.

## No UI workflow

When no meaningful UI style exists, ask the questions in `references/style-questionnaire.md`. Ask no more than 6 at once. Use the canonical opening prompt from that file, which offers preset directions (Linear-, Vercel-, Stripe-inspired, calm enterprise, editorial, playful) only as broad inspiration, not exact copies.

After the answers, create a draft `docs/design-system/ui-contract.md`, initial tokens, and 3–5 starter components before broad screen work.

## Required output format for audits

Use the audit-response template in `references/output-templates.md`. The required sections:

1. **UI authority map**
2. **Maturity assessment**
3. **Consistency risks**
4. **Recommended path**
5. **First implementation slice**
6. **Guardrails**
7. **Verification**

For implementation tasks, also include a **Changed files** section explaining why each new file exists.

## Guardrail rules

Follow these unless the repo's existing UI contract says otherwise:

- Components read semantic tokens, not raw hex or one-off pixel values.
- Shared components define visual variants. Screens consume variants.
- Repeated row/list/card/page-shell structures become composition primitives.
- Tailwind arbitrary values are allowed only for rare, documented exceptions.
- Inline `style={{ ... }}` is allowed only for truly dynamic runtime values.
- A new component variant needs a story, a usage rule, and at least one example state.
- Do not add a new UI dependency without explaining why existing tools are insufficient.
- Do not copy proprietary brand systems. Use named products only as broad inspiration when the user requests it.
- Do not make broad visual redesigns when the user only asked for consistency.

## Storybook discipline

If Storybook exists, add stories for changed or newly extracted components, covering: default, variants, sizes, disabled, loading, destructive/critical, light/dark themes if supported, and realistic composition examples. If Storybook does not exist, propose setup rather than forcing it. Detail in `references/storybook-playbook.md`.

## Lint discipline

Lint guardrails start as warnings unless the repo has strong enforcement. Common checks: no raw hex outside token files; no hardcoded spacing/radii outside tokens; no ad hoc button-like elements when `Button` exists; no arbitrary Tailwind values without an allowlist comment; no inline style objects for static values; stories required under shared UI directories. Rollout model in `references/linting-guardrails.md`.

## When editing code

- Determine the package manager from lockfiles before suggesting commands.
- Do not overwrite existing design docs; update or append with a dated decision.
- Keep changes small and reviewable.
- Prefer codemods or narrow search/replace for systematic token migrations.
- After changes, run the repo's most relevant checks: lint, typecheck, tests, and Storybook build if present.

## Final review rubric

A UI change is acceptable when:

- the design decision lives at the highest reasonable layer;
- a future developer can find the rule in the standard location;
- shared UI uses component props or composition primitives, not copied markup;
- tokens and variants are named semantically;
- Storybook or docs show the intended result;
- lint/CI or a review checklist catches the most likely regressions.
