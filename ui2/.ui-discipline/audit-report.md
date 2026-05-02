# UI discipline audit report

Root: `/Users/bbuchsbaum/code/brainflow2/ui2`

## Summary

- Package manager: `npm`
- Frameworks/tools: React, Tailwind CSS, Radix UI, Vite
- Maturity estimate: **emerging**
- Raw hex files: 47 (269 occurrences)
- Inline style files: 84 (375 occurrences)
- Arbitrary Tailwind files: 83 (381 occurrences)
- CSS variables defined: 181 unique (185 definitions)
- Storybook files: 0
- Design/doc files: 0

## UI authority map candidates

### Tokens/theme

- `src/index.css`
- `src/styles/modern-ui.css`
- `src/styles/shadcn.css`
- `src/styles/slider.css`
- `src/styles/theme.css`
- `tailwind.config.js`

### Shared component directories

- `src/components/ui`

### Storybook/examples

- Not detected

### Docs

- Not detected

### Lint/CI

- `eslint.config.js`

## Package scripts

- `dev`: `vite`
- `build`: `tsc -b && vite build`
- `lint`: `eslint .`
- `preview`: `vite preview`
- `test`: `vitest`
- `test:ui`: `vitest --ui`

## Top component-like exports

| Name | Count |
|---|---:|
| `STORAGE_KEY` | 5 |
| `Slider` | 5 |
| `Button` | 4 |
| `StatusBarSlot` | 3 |
| `Toggle` | 3 |
| `Chip` | 3 |
| `FieldRow` | 3 |
| `HEADER_HEIGHT` | 3 |
| `MEDICAL_COLOR_PRESETS` | 2 |
| `DEFAULT_SETTINGS` | 2 |
| `TEST_LAYOUT` | 2 |
| `SingleSlider` | 2 |
| `PanelHeader` | 2 |
| `Tooltip` | 2 |
| `RenderOverlays` | 2 |
| `RangeSlider` | 2 |
| `ColormapSelector` | 2 |
| `StatusBar` | 2 |
| `Badge` | 2 |
| `DropdownMenu` | 2 |
| `IconButton` | 2 |
| `Modal` | 2 |
| `ProSlider` | 2 |
| `LayerRow` | 2 |
| `Popover` | 2 |
| `PopoverTrigger` | 2 |
| `PopoverArrow` | 2 |
| `PopoverContent` | 2 |
| `Sheet` | 2 |
| `SheetTrigger` | 2 |
| `SheetClose` | 2 |
| `SheetPortal` | 2 |
| `SheetOverlay` | 2 |
| `SheetContent` | 2 |
| `SheetHeader` | 2 |
| `SheetFooter` | 2 |
| `SheetTitle` | 2 |
| `SheetDescription` | 2 |
| `Label` | 2 |
| `Switch` | 2 |

## Raw hex color findings

| File | Count | Examples |
|---|---:|---|
| `src/App.css` | 3 | `#646cffaa, #61dafbaa, #888` |
| `src/index.css` | 2 | `#000, #5C6370` |
| `src/types/surfaceLayers.ts` | 1 | `#888888` |
| `src/types/filesystem.ts` | 7 | `#3b82f6, #10b981, #f59e0b, #ef4444, #8b5cf6, #6b7280` |
| `src/stores/fileBrowserStore.ts` | 14 | `#3b82f6, #10b981, #6b7280, #f59e0b, #ef4444, #8b5cf6` |
| `src/stores/crosshairSettingsStore.ts` | 10 | `#e07830, #00ff00, #ff0000, #ffff00, #00ffff, #ff00ff, #ffffff, #0088ff` |
| `src/stores/surfaceStore.ts` | 3 | `#CCCCCC, #ffffff, #000000` |
| `src/stores/__tests__/surfaceStore.settings.test.ts` | 3 | `#112233, #ffffff` |
| `src/stores/__tests__/annotationStore.test.ts` | 4 | `#ff0000, #00ff00` |
| `src/utils/crosshairUtils.ts` | 2 | `#e07830, #808080` |
| `src/components/TooltipOverlay.tsx` | 1 | `#e5e7eb` |
| `src/components/ui/ProgressDrawer.tsx` | 15 | `#ef444420, #ef4444, #10b981, #6b7280, #94a3b8, #374151, #60a5fa` |
| `src/components/ui/TestProgress.tsx` | 3 | `#666, #3b82f6, #ef4444` |
| `src/components/ui/colormapOptions.ts` | 70 | `#000000, #ffffff, #440154, #31688e, #35b779, #fde725, #ff0000, #ffff00` |
| `src/components/ui/ProgressDrawer.css` | 2 | `#10b981, #374151` |
| `src/components/ui/Slider.module.css` | 8 | `#e5e7eb, #3b82f6, #2563eb, #9ca3af` |
| `src/components/ui/StatusBarProgress.tsx` | 5 | `#d1d5db, #60a5fa, #111827` |
| `src/components/ui/LayerRow.tsx` | 3 | `#f59e0b, #10b981, #3A3A3A` |
| `src/components/inspector/imaging/sections/RenderSection.tsx` | 4 | `#2a3344` |
| `src/components/bids/BidsEventsTimeline.tsx` | 8 | `#E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7, #888888` |
| ... | ... | 27 more files omitted |

## Inline style findings

| File | Count | Examples |
|---|---:|---|
| `src/components/TooltipOverlay.tsx` | 6 | `style={{ ... }}` |
| `src/components/ui/LayerList.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/SingleSlider.tsx` | 24 | `style={{ ... }}` |
| `src/components/ui/ProgressDrawer.tsx` | 20 | `style={{ ... }}` |
| `src/components/ui/ColormapPicker.tsx` | 4 | `style={{ ... }}` |
| `src/components/ui/NotificationToast.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/TransientOverlay.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/TestProgress.tsx` | 3 | `style={{ ... }}` |
| `src/components/ui/CrosshairSettingsPopover.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/StatusBarProgress.tsx` | 2 | `style={{ ... }}` |
| `src/components/ui/SliceSlider.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/RangeSlider.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/ContextMenu.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/StatusBarSlot.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/StatusBar.tsx` | 1 | `style={{ ... }}` |
| `src/components/ui/TopAppBar.tsx` | 6 | `style={{ ... }}` |
| `src/components/ui/DisplayModeSelector.tsx` | 2 | `style={{ ... }}` |
| `src/components/ui/MosaicToolbar.tsx` | 4 | `style={{ ... }}` |
| `src/components/ui/LayerRow.tsx` | 4 | `style={{ ... }}` |
| `src/components/ui/ProSlider.tsx` | 22 | `style={{ ... }}` |
| ... | ... | 60 more files omitted |

## Arbitrary Tailwind findings

| File | Count | Examples |
|---|---:|---|
| `src/index.css` | 1 | `text-[10px]` |
| `src/components/ui/ViewToolbar.tsx` | 3 | `bg-[var(--app-bg-secondary)], border-[var(--app-border)], bg-[var(--app-border)]` |
| `src/components/ui/LayerList.tsx` | 1 | `text-[13px]` |
| `src/components/ui/SingleSlider.tsx` | 21 | `text-[10px], h-[2px], w-[6px], h-[12px], top-[-5px], text-[9px], w-[8px], h-[16px]` |
| `src/components/ui/LayerTable.tsx` | 4 | `text-[13px], text-[9px], text-[10px]` |
| `src/components/ui/CrosshairToggle.tsx` | 6 | `bg-[var(--app-accent)], bg-[var(--app-accent-hover)], bg-[var(--app-bg-secondary)], text-[var(--app-text-secondary)], bg-[var(--app-bg-hover)], text-[var(--app-text-primary)]` |
| `src/components/ui/ColormapPicker.tsx` | 18 | `text-[10px], text-[var(--app-text-muted)], text-[11px], text-[var(--app-text-secondary)], rounded-[1px], border-[var(--app-border)], border-[var(--layer-accent)], min-w-[320px]` |
| `src/components/ui/NotificationToast.tsx` | 1 | `text-[11px]` |
| `src/components/ui/PanelHeader.tsx` | 1 | `text-[10px]` |
| `src/components/ui/CollapsibleSection.tsx` | 1 | `max-h-[2000px]` |
| `src/components/ui/PropertyRow.tsx` | 1 | `text-[11px]` |
| `src/components/ui/LayerDropdown.tsx` | 6 | `text-[13px], w-[var(--radix-popover-trigger-width)], max-h-[280px]` |
| `src/components/ui/WorkspacePresetSelector.tsx` | 2 | `text-[11px], text-[10px]` |
| `src/components/ui/LoadingQueueIndicator.tsx` | 1 | `min-w-[200px]` |
| `src/components/ui/MetadataDrawer.tsx` | 2 | `w-[28rem], max-w-[28rem]` |
| `src/components/ui/CrosshairSettingsPopover.tsx` | 4 | `border-[var(--app-accent)], border-[var(--app-border)], text-[var(--app-text-secondary)]` |
| `src/components/ui/StatusBarProgress.tsx` | 2 | `max-w-[200px], text-[10px]` |
| `src/components/ui/RenderOverlays.tsx` | 3 | `text-[10px], text-[9px]` |
| `src/components/ui/ContextMenu.tsx` | 2 | `rounded-[1px], text-[11px]` |
| `src/components/ui/MosaicToolbar.tsx` | 53 | `bg-[var(--app-bg-secondary)], border-[var(--app-border)], shadow-[var(--app-shadow-sm)], w-[100px], bg-[var(--app-bg-tertiary)], text-[var(--app-text-primary)], shadow-[var(--app-shadow-md)], bg-[var(--app-bg-hover)]` |
| ... | ... | 60 more files omitted |

## Button-like local markup signals

| File | Count | Examples |
|---|---:|---|
| `src/App.tsx` | 6 | `h-screen bg-gray-950 flex items-center justify-center, bg-red-900 border border-red-700 rounded-lg p-6 max-w-md, bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded, bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded` |
| `src/components/ui/ProgressDrawer.tsx` | 13 | `flex-1 py-1.5 px-3 text-xs rounded transition-colors, py-1.5 px-3 text-xs rounded transition-colors, fixed inset-0 bg-black/50 z-40 animate-fade-in, p-1 rounded hover:bg-gray-700/50 transition-colors` |
| `src/components/ui/LayerTable.tsx` | 7 | `h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground, px-0.5 shrink-0, shrink-0 rounded border border-border bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground, shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1 py-px text-[9px] font-medium uppercase tracking-[0.08em] text-destructi` |
| `src/components/ui/ColormapPicker.tsx` | 4 | `h-4 flex-1 rounded border, z-50 min-w-[320px] border-[var(--layer-divider)] bg-[var(--layer-bg)] p-3, h-4 w-12 rounded-[1px], h-4 w-16 rounded border` |
| `src/components/ui/PanelHeader.tsx` | 2 | `bf-control-sm rounded-appsm border border-border bg-background px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground , icon-btn rounded-appsm` |
| `src/components/ui/CollapsibleSection.tsx` | 1 | `w-full bf-control-md flex items-center justify-between px-1 py-1 hover:bg-muted/50 transition-colors group text-foreground rounded-appsm foc` |
| `src/components/ui/LayerDropdown.tsx` | 2 | `text-[13px] text-muted-foreground text-center py-4, w-px h-4 bg-border` |
| `src/components/ui/RenderErrorBoundary.tsx` | 4 | `flex flex-col items-center justify-center h-full bg-gray-900/50 text-gray-300 p-4, flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 
                     text-white rounded transition-colors text-sm, cursor-pointer hover:text-gray-400, mt-2 p-2 bg-gray-800 rounded overflow-auto max-h-32` |
| `src/components/ui/MetadataDrawer.tsx` | 2 | `px-6 py-4 border-b, px-3 pb-3 space-y-3 border-t` |
| `src/components/ui/StatusBarProgress.tsx` | 2 | `flex items-center gap-2 px-3 py-1 text-xs hover:bg-gray-700/50 transition-colors cursor-pointer, px-1.5 py-0.5 rounded text-[10px] font-medium` |
| `src/components/ui/ContextMenu.tsx` | 2 | `absolute min-w-48 rounded-[1px] border border-border bg-card py-1 shadow-lg outline-none, my-1 border-border` |
| `src/components/ui/DropdownMenu.tsx` | 1 | `my-1 border-border` |
| `src/components/ui/MosaicToolbar.tsx` | 13 | `h-8 w-[100px] text-xs bg-[var(--app-bg-tertiary)] border border-[var(--app-border)] text-[var(--app-text-primary)], bg-[var(--app-bg-secondary)] border border-[var(--app-border)] shadow-[var(--app-shadow-md)], text-[var(--app-text-primary)] hover:bg-[var(--app-bg-hover)] focus:bg-[var(--app-bg-hover)], h-8 w-[72px] text-xs bg-[var(--app-bg-tertiary)] border border-[var(--app-border)] text-[var(--app-text-primary)]` |
| `src/components/ui/LayerRow.tsx` | 4 | `relative flex items-center h-[28px] px-2 cursor-pointer transition-colors, w-2 h-2 rounded-full bg-[var(--layer-accent)], absolute right-[28px] w-[6px] h-[6px] rounded-full, w-5 h-5 flex items-center justify-center rounded transition-colors text-neutral-400 hover:text-white hover:bg-[#3A3A3A]` |
| `src/components/ui/TimeSlider.tsx` | 2 | `px-2 py-1 text-xs text-foreground bg-muted/80 rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted` |
| `src/components/ui/SurfaceMetadataDrawer.tsx` | 4 | `border rounded-lg overflow-hidden, w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors flex items-center justify-between, p-1 hover:bg-muted rounded transition-colors, mt-6 p-4 bg-muted/30 rounded-lg` |
| `src/components/ui/MetadataPopover.tsx` | 9 | `mb-4 pb-4 border-b border-border/50, flex items-center justify-between mx-2 px-3 py-2 rounded-md border border-accent/20 hover:border-accent/30 transition-colors, ml-2 p-1 rounded hover:bg-accent/30 transition-colors, h-3.5 w-3.5 text-muted-foreground hover:text-popover-foreground` |
| `src/components/studio/StudioLensSwitcher.tsx` | 4 | `flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2, inline-flex items-center rounded-md border border-border bg-background p-0.5, h-4 w-px bg-border, rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground` |
| `src/components/studio/InspectorPane.tsx` | 6 | `rounded-lg border border-border bg-background px-3 py-3, space-y-4 divide-y divide-border rounded-lg border border-border bg-background px-3 py-3, rounded-lg border border-border bg-background p-3, rounded-md border border-border bg-card px-3 py-2` |
| `src/components/studio/TsvImportWizard.tsx` | 13 | `rounded-lg border border-border bg-card p-4, mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:, rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-foreground, w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring` |
| ... | ... | 39 more files omitted |

## Suggested next step

Stabilize the existing system: document the authority map, consolidate repeated patterns, improve Storybook coverage, then add lint guardrails.
