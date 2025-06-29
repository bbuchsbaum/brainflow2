# UI Layout Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Header/Toolbar                              │
├─────────────────────────┬───────────────────────────────────────────┤
│                         │                                           │
│   TreeBrowser          │         OrthogonalView (GPU)             │
│   (File Explorer)      │                                           │
│                        │      ┌─────────┬─────────┬─────────┐     │
│   📁 /data             │      │ Sagittal│ Coronal │  Axial  │     │
│   ├── 📁 subjects     │      │         │         │         │     │
│   │   ├── 📄 T1.nii   │      │  Slice  │  Slice  │  Slice  │     │
│   │   └── 📄 T2.nii   │      │         │         │         │     │
│   └── 📁 atlases      │      └─────────┴─────────┴─────────┘     │
│                        │                                           │
├────────────────────────┤                                           │
│                        │                                           │
│   PlotPanel            ├───────────────────────────────────────────┤
│   (Time Series)        │        LayerPanel (Refactored)           │
│                        │                                           │
│   📊 Voxel: [45,67,89] │   ▼ Layers (3)                          │
│                        │   ┌─────────────────────────────────┐   │
│   [Graph visualization] │   │ ☑ T1.nii          👁️ 🗑️       │   │
│                        │   │ ☑ atlas.nii       👁️ 🗑️       │   │
│                        │   │ ☐ overlay.nii     👁️ 🗑️       │   │
│                        │   └─────────────────────────────────┘   │
│                        │                                           │
│                        │   ▼ Controls (Active Layer: T1.nii)      │
│                        │   ┌─────────────────────────────────┐   │
│                        │   │ Opacity:    ████████░░ 80%      │   │
│                        │   │ Colormap:   [Grayscale ▼]       │   │
│                        │   │ Window:     ████████░░          │   │
│                        │   │ Level:      ████████░░          │   │
│                        │   │ Threshold:  [0] ──────── [255]  │   │
│                        │   └─────────────────────────────────┘   │
│                        │                                           │
└────────────────────────┴───────────────────────────────────────────┘
                        Status Bar: Ready | GPU: 45MB | FPS: 60
```

## Component Hierarchy

```
App
├── Header
├── GoldenLayout Container
│   ├── Left Panel (25% width)
│   │   ├── TreeBrowser (60% height)
│   │   └── PlotPanel (40% height)
│   └── Right Panel (75% width)
│       ├── OrthogonalView (70% height)
│       └── LayerPanel (30% height)
│           ├── LayerList
│           └── LayerControls (collapsible)
└── StatusBar
```

## Key Improvements in New Design:

1. **Unified Layer Panel**: Single panel combining layer selection and controls
2. **Compact Controls**: Vertically arranged, space-efficient controls
3. **Collapsible Sections**: Layers and Controls can be collapsed
4. **Clean Layer List**: Simple checkboxes with visibility/delete icons
5. **Inline Controls**: Controls appear below layer list for active layer
6. **Modern Sliders**: Compact, labeled sliders with value display
7. **Status Bar**: System-wide status, GPU usage, and FPS counter