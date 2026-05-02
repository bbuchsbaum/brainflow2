# TreeRow composition contract

Use this when two or more hierarchical lists need aligned indentation, icon sizing, text treatment, and actions.

## Purpose

`TreeRow` centralizes hierarchy row decisions so screens cannot drift by reimplementing row spacing and icon treatment.

## Props

```ts
type TreeRowProps = {
  level?: number
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  selected?: boolean
  disabled?: boolean
  expanded?: boolean
  actions?: React.ReactNode
  onToggle?: () => void
  onSelect?: () => void
}
```

## Visual rules

- Row height: TBD
- Horizontal padding: TBD
- Indentation per level: TBD
- Icon size: TBD
- Expand/collapse control size: TBD
- Title typography: TBD
- Subtitle typography: TBD
- Selected background: semantic token
- Focus ring: semantic focus token

## Required stories

- default row;
- with subtitle;
- selected;
- disabled;
- nested levels;
- with actions;
- long title overflow;
- keyboard/focus example.
