# Panel Header Action Taxonomy (bd-2fs.4.1)

## Scope
- Files panel (`FileBrowserPanel`)
- Right-sidebar panel headers (at minimum `SurfaceLayerPanel`; GoldenLayout tab header controls also included)

## Problem
- Panel header actions currently mix high-frequency and low-frequency controls in the same visual weight.
- GoldenLayout exposes `popout`, `maximize`, and `close` inline for every panel, creating icon clutter.
- Files panel has no explicit semantic header model; controls are split between GL chrome and local strips.

## Taxonomy
- `P0 Primary Inline`: high-frequency, low-risk, should always be visible.
- `P1 Secondary Inline`: contextual/important, visible if space allows.
- `P2 Overflow`: low-frequency or potentially disruptive actions; keep in overflow menu with labels.
- `D Destructive`: always labeled (never icon-only in overflow), confirm before execution.

## Action Inventory + Placement

### GoldenLayout Header Controls
- `close tab`: `P0 Primary Inline` (keep visible)
- `maximize`: `P2 Overflow`
- `popout`: `P2 Overflow`

Rationale: `close` is common and local; `maximize/popout` are niche and consume valuable chrome space.

### Files Panel
- `search`: `P0 Primary Inline` (already inline in control strip)
- `sort key`: `P1 Secondary Inline`
- `sort order`: `P1 Secondary Inline`
- `mount directory`: `P0 Primary Inline` (when no directory mounted)
- `open file`: `P1 Secondary Inline` (when no directory mounted)
- `refresh tree`: `P2 Overflow` (proposed)
- `reveal selected in finder/explorer`: `P2 Overflow` (proposed)

Rationale: search + sorting are continuous tasks; maintenance/navigation commands should be labeled in overflow.

### Surfaces Panel (Right Sidebar)
- `load surface`: `P0 Primary Inline` (already in custom header)
- `expand/collapse all`: `P2 Overflow` (proposed)
- `show hidden surfaces`: `P2 Overflow` (proposed)
- `clear surface errors`: `P2 Overflow` (proposed)

Rationale: loading is the primary user intent; list-management utilities are occasional.

## Proposed Header Schema

Use a shared schema that determines visual placement before rendering:

```ts
type HeaderActionPriority = 'primary' | 'secondary' | 'destructive';
type HeaderActionPlacement = 'inline' | 'overflow';

interface PanelHeaderAction {
  id: string;
  label: string;
  icon?: string;
  priority: HeaderActionPriority;
  placement: HeaderActionPlacement;
  tooltip?: string;
  shortcut?: string;
}

interface PanelHeaderSpec {
  panelId: string;
  title: string;
  inlineLimit: number;
  actions: PanelHeaderAction[];
}
```

## Rendering Rules
- Render `placement = inline` actions left-to-right by priority (`primary`, then `secondary`).
- If inline actions exceed `inlineLimit`, demote lowest-priority `secondary` actions to overflow.
- Overflow menu must show text labels and tooltips.
- Destructive actions in overflow require explicit confirmation.

## Files + Surfaces Baseline Specs (for 4.2 implementation)
- Files: keep `search/sort` inline in local strip; expose panel-level secondary actions through overflow entry point.
- Surfaces: keep `load surface` inline; move other header utilities to overflow.
- GoldenLayout: hide inline `maximize/popout`; keep `close` inline.

## Acceptance Mapping (bd-2fs.4.1)
- Action list categorized into primary vs overflow with rationale: **done**.
- Proposed schema documented and reviewable: **done**.
- Covers Files and right-sidebar headers: **done**.
