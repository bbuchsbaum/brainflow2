<!-- Parent: ../AGENTS.md -->

# UI modules

First-party features plug into the shell here. The design is in
`docs/plans/module-architecture.md`; the bridge half is in
`core/api_bridge/src/modules/AGENTS.md`.

## Files

| File | Role |
| --- | --- |
| `api/` | The module API: `defineModule`, manifest, contribution and `ModuleContext` types. No runtime dependencies, so manifests load nothing. |
| `api/host.ts` | App services for lazily loaded module code: `bridgeClient(id)`, layer selection hooks, file and surface openers. Add a thin facade here when a module needs one. |
| `index.ts` | The first-party module list. |
| `registry.ts` | Registers manifests and core entries at import, validates them, filters by enabled state and host, activates lazily, disposes on disable. |
| `coreContributions.ts` | Core tools (Set studio, BIDS), Inspector modes and dock tabs, so lists treat core and module entries alike. |
| `settingsStore.ts` | `brainflow-modules` v1: switches, pinned tools, startup tabs, applied proposals. |
| `runtime.ts` | Started by App: `set_enabled_modules`, native menu model, `module-command` clicks, keybindings, tab parking. |
| `context.ts` | Builds the `ModuleContext`; `state.app` stores (`brainflow-module:<id>:<name>`). |

## Adding a module

1. `src/modules/<id>/module.ts`: `export default defineModule({...})` with `id`,
   `title`, a one-sentence `description`, `version`, `stage: 'experimental'`,
   `hosts`, optional `requires.hostCapabilities`, `contributes` and
   `activate: () => import('./activate')`. Add it to `index.ts`.
2. `activate.ts` exports `activate(ctx)`: register a handler for every declared
   command (`ctx.commands.register`), and undo anything else through
   `ctx.disposables`, `ctx.events.listen` or `ctx.keybindings`.
3. A bridge section uses the same id; the stage and version must match the Rust
   descriptor (`__tests__/firstParty.test.ts`). Add dev-harness handlers for its
   commands (`devHarness/app/backend.ts`).
4. Add `<id>/AGENTS.md` with the module's own contracts.

## Contributions

- **Ids** are `<module>.<name>`. A workspace id already stored in saved
  workspaces keeps its form with `legacyId: true` (Analysis:
  `analysis-workbench`). The registry rejects duplicates at import.
- **commands** feed the palette, menus and keybindings; `when.workspace`
  scopes them to a tab type.
- **workspaces** are tool tabs: opened once, then refocused; `bottomDock`
  wraps the tab in the shared dock. `pinned`/`openAtStartup` only propose
  defaults, applied once; the user's Settings › Top bar always wins.
- **menus** place items at `view/workspace` (after the core tools). Rust keeps
  predefined items and accelerators (`src-tauri/src/menu_builder.rs`).
- **keybindings**, **inspectorModes**, **dockTabs**: registered while the module
  is on.

## Enabled state and teardown

- A module is on when its host supports it and the user's switch, or else its
  stage default, says so (experimental off, preview and stable on). Settings ›
  Modules lists every supported module with its stage.
- Off: no tabs, menu items, commands or shortcuts; its bridge commands reject
  with `ModuleDisabled` (12001). Its tabs are parked (kept in
  `brainflow2-workspace`) and come back when it is switched on; restore at
  launch parks tabs of modules that are off. Persisted module data is kept.
- A module activates on first use (its command or its tab), only after the
  bridge applied the latest switch. Switching it off disposes its context; an
  activation still running is undone when it finishes. Module stores must drop
  responses that arrive after a reset (see `analysis/stores/analysisStore.ts`).

## Boundaries (`eslint.config.js`)

- Module code imports only `@/modules/api` (and `api/host`),
  `@/components/ui/bf`, `@brainflow/api`, packages and its own folder (`./x`
  or `@/modules/<id>/…`, never `../`), and never `@tauri-apps/*`.
- Core code never imports a module folder. It uses the framework files above.
  The dev harness is exempt (scenarios drive module stores).
- Tests inside a module folder follow the module rule; tests that drive the
  shell live in `__tests__/` here (`analysis.integration.test.tsx`).

## Stage gates

The gates are in the plan ("Maturity stages"). The registry enforces two:
only stable modules bind global keys (others scope with `when.workspace`) and
only stable modules propose top-bar or startup defaults. Before promoting a
module, add the teardown, stale-result and persistence tests the gate lists.
