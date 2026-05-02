# UI Design Discipline skill

A Claude/Codex-compatible skill for establishing UI theme discipline, design tokens, component consistency, Storybook documentation, and lint guardrails.

## What it does

This skill helps an agent:

- find the repo's UI source of truth;
- audit existing themes, components, tokens, stories, and lint rules;
- classify the UI system as mature, emerging, ad hoc, or absent;
- create a standard design-system contract location;
- propose a practical path forward;
- generate Storybook and linting scaffolds;
- prevent repeated UI drift by moving decisions up the stack.

## Install for Codex

For a single repository:

```bash
mkdir -p .agents/skills
cp -R ui-design-discipline .agents/skills/ui-design-discipline
```

Optional: add the contents of `AGENTS.md.snippet` to your repository `AGENTS.md`.

## Install for Claude Code

Recommended (personal, all projects):

```bash
./install.sh claude-user
# copies to ~/.claude/skills/ui-design-discipline/
```

For a single repository (committed alongside the project):

```bash
./install.sh claude-project .
# copies to .claude/skills/ui-design-discipline/
```

Optional: add the contents of `CLAUDE.md.snippet` to your repository `CLAUDE.md` or `.claude/CLAUDE.md`.

## Coexistence with other skills

This skill owns the *consistency / discipline / guardrails* niche. It is complementary to, and should defer to:

- `design-principles` — for opinionated visual style enforcement (typography, spacing rules, "every pixel is a decision").
- `frontend-design` — for creating new distinctive UIs from scratch with high design quality.

Use `ui-design-discipline` when an existing UI is drifting, when tokens/components/Storybook/lint need to be set up or audited, or when you need a UI source of truth — not when you need a fresh design direction.

## Suggested first prompts

```text
Use the ui-design-discipline skill to audit this repo's UI consistency and propose a path forward.
```

```text
Use the ui-design-discipline skill to create a design-system contract, starter tokens, and Storybook plan for this app.
```

```text
Use the ui-design-discipline skill to inspect why these two screens drifted visually and extract the right shared primitive.
```

## Optional scripts

Run the inventory scanner from a repository root:

```bash
python .agents/skills/ui-design-discipline/scripts/ui_inventory.py --root .
```

or, for Claude project installs:

```bash
python .claude/skills/ui-design-discipline/scripts/ui_inventory.py --root .
```

The scanner writes:

- `.ui-discipline/audit-report.md`
- `.ui-discipline/audit-report.json`

Create a starter UI contract when one does not exist:

```bash
python .agents/skills/ui-design-discipline/scripts/create_ui_contract.py --root .
```

## Files

- `SKILL.md` — main skill instructions.
- `references/` — detailed playbooks the agent can open when needed.
- `assets/` — templates for UI contracts, tokens, Storybook, and linting.
- `scripts/` — optional repo scanners/generators.
- `AGENTS.md.snippet` — Codex repo guidance.
- `CLAUDE.md.snippet` — Claude repo guidance.
