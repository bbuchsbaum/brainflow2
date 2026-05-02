import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

// Visual reference for the canonical `--bf-*` token set defined in
// `ui2/src/styles/theme.css` (Design.md §3.1). This story is the entry
// point for designers and contributors who want to see what's available
// without grepping the CSS file.

const meta = {
  title: 'Design System/Tokens',
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'app' },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

interface SwatchProps {
  name: string
  cssVar: string
  description?: string
}

const Swatch: React.FC<SwatchProps> = ({ name, cssVar, description }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '64px 1fr',
      gap: 12,
      alignItems: 'center',
      padding: 8,
      borderRadius: 'var(--bf-radius-sm)',
      background: 'var(--bf-bg-panel)',
      border: '1px solid var(--bf-border-subtle)',
    }}
  >
    <div
      style={{
        width: 64,
        height: 40,
        borderRadius: 'var(--bf-radius-sm)',
        background: `var(${cssVar})`,
        border: '1px solid var(--bf-border-subtle)',
      }}
    />
    <div>
      <div
        style={{
          fontFamily: 'var(--bf-font-mono)',
          fontSize: 11,
          color: 'var(--bf-text-primary)',
        }}
      >
        {cssVar}
      </div>
      <div style={{ fontSize: 11, color: 'var(--bf-text-muted)' }}>{name}</div>
      {description && (
        <div style={{ fontSize: 10, color: 'var(--bf-text-faint)' }}>{description}</div>
      )}
    </div>
  </div>
)

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section style={{ display: 'grid', gap: 12 }}>
    <h2
      style={{
        margin: 0,
        fontSize: 11,
        fontWeight: 650,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--bf-text-secondary)',
      }}
    >
      {title}
    </h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
      {children}
    </div>
  </section>
)

export const ColorTokens: Story = {
  render: () => (
    <div
      style={{
        padding: 24,
        background: 'var(--bf-bg-app)',
        color: 'var(--bf-text-primary)',
        fontFamily: 'var(--bf-font-sans)',
        display: 'grid',
        gap: 24,
        minHeight: '100vh',
      }}
    >
      <header style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Brainflow color tokens
        </h1>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--bf-text-muted)' }}>
          Canonical <code>--bf-*</code> tokens from <code>theme.css</code>. See <code>resdesign/Design.md</code> §3.1.
        </p>
      </header>

      <Group title="Backgrounds">
        <Swatch name="App" cssVar="--bf-bg-app" />
        <Swatch name="Shell" cssVar="--bf-bg-shell" />
        <Swatch name="Panel" cssVar="--bf-bg-panel" />
        <Swatch name="Panel raised" cssVar="--bf-bg-panel-raised" />
        <Swatch name="Panel sunken" cssVar="--bf-bg-panel-sunken" />
        <Swatch name="Canvas" cssVar="--bf-bg-canvas" description="MRI/fMRI viewport background" />
        <Swatch name="Input" cssVar="--bf-bg-input" />
        <Swatch name="Hover" cssVar="--bf-bg-hover" />
        <Swatch name="Active" cssVar="--bf-bg-active" />
        <Swatch name="Selected" cssVar="--bf-bg-selected" />
      </Group>

      <Group title="Text">
        <Swatch name="Primary" cssVar="--bf-text-primary" description="WCAG AAA on bg-app" />
        <Swatch name="Secondary" cssVar="--bf-text-secondary" description="WCAG AAA on bg-panel" />
        <Swatch name="Muted" cssVar="--bf-text-muted" description="WCAG AA on bg-panel" />
        <Swatch name="Faint" cssVar="--bf-text-faint" description="Decorative only — fails AA" />
      </Group>

      <Group title="Brand &amp; interaction">
        <Swatch name="Brand" cssVar="--bf-brand" />
        <Swatch name="Accent" cssVar="--bf-accent" />
        <Swatch name="Accent hover" cssVar="--bf-accent-hover" />
        <Swatch name="Accent active" cssVar="--bf-accent-active" />
      </Group>

      <Group title="Semantic">
        <Swatch name="Success" cssVar="--bf-success" />
        <Swatch name="Warning" cssVar="--bf-warning" />
        <Swatch name="Danger" cssVar="--bf-danger" />
        <Swatch name="Info" cssVar="--bf-info" />
      </Group>

      <Group title="Anatomical orientation (reserved)">
        <Swatch name="Axial" cssVar="--bf-axial" description="Z plane" />
        <Swatch name="Sagittal" cssVar="--bf-sagittal" description="X plane" />
        <Swatch name="Coronal" cssVar="--bf-coronal" description="Y plane" />
        <Swatch name="Crosshair" cssVar="--bf-crosshair" />
      </Group>

      <Group title="Borders">
        <Swatch name="Subtle" cssVar="--bf-border-subtle" />
        <Swatch name="Default" cssVar="--bf-border" />
        <Swatch name="Strong" cssVar="--bf-border-strong" />
        <Swatch name="Focus" cssVar="--bf-border-focus" />
      </Group>
    </div>
  ),
}

export const Typography: Story = {
  render: () => (
    <div
      style={{
        padding: 24,
        background: 'var(--bf-bg-app)',
        color: 'var(--bf-text-primary)',
        fontFamily: 'var(--bf-font-sans)',
        display: 'grid',
        gap: 16,
        minHeight: '100vh',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
        Typography
      </h1>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--bf-text-muted)' }}>
        Type scale from Design.md §4.2. Use the role utility classes on text — never hand-roll
        font-size / letter-spacing.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>
          App title — 18 / 24, 700, -0.02em
        </div>
        <div style={{ fontSize: 12, lineHeight: '16px', fontWeight: 650, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Panel title — 12 / 16, 650, 0.04em uppercase
        </div>
        <div style={{ fontSize: 11, lineHeight: '16px', fontWeight: 650, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--bf-text-muted)' }}>
          Section title — 11 / 16, 650, 0.05em uppercase
        </div>
        <div style={{ fontSize: 12, lineHeight: '18px', fontWeight: 450 }}>
          Body — 12 / 18, 450. The MRI volume sub-01_task-rest_bold.nii.gz contains 240 frames.
        </div>
        <div style={{ fontSize: 11, lineHeight: '16px', fontWeight: 450, color: 'var(--bf-text-muted)' }}>
          Small — 11 / 16, 450. Use for secondary metadata.
        </div>
        <div style={{ fontFamily: 'var(--bf-font-mono)', fontSize: 12, lineHeight: '16px', fontVariantNumeric: 'tabular-nums' }}>
          Number — mono, tabular: X -2.000 Y 12.000 Z 18.000 mm | i 30 j 44 k 36 | t = 2.34
        </div>
      </div>
    </div>
  ),
}

export const RadiiAndSpacing: Story = {
  render: () => (
    <div
      style={{
        padding: 24,
        background: 'var(--bf-bg-app)',
        color: 'var(--bf-text-primary)',
        fontFamily: 'var(--bf-font-sans)',
        display: 'grid',
        gap: 24,
        minHeight: '100vh',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Radii &amp; spacing</h1>
      <Group title="Border radius">
        {(['xs', 'sm', 'md', 'lg', 'pill'] as const).map((r) => (
          <div
            key={r}
            style={{
              display: 'grid',
              gridTemplateColumns: '64px 1fr',
              gap: 12,
              alignItems: 'center',
              padding: 8,
              background: 'var(--bf-bg-panel)',
              borderRadius: 'var(--bf-radius-sm)',
              border: '1px solid var(--bf-border-subtle)',
            }}
          >
            <div
              style={{
                width: 64,
                height: 40,
                background: 'var(--bf-accent-soft)',
                borderRadius: `var(--bf-radius-${r})`,
                border: '1px solid var(--bf-accent)',
              }}
            />
            <div style={{ fontFamily: 'var(--bf-font-mono)', fontSize: 11 }}>--bf-radius-{r}</div>
          </div>
        ))}
      </Group>

      <Group title="Spacing">
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <div
            key={n}
            style={{
              display: 'grid',
              gridTemplateColumns: '64px 1fr',
              gap: 12,
              alignItems: 'center',
              padding: 8,
              background: 'var(--bf-bg-panel)',
              borderRadius: 'var(--bf-radius-sm)',
              border: '1px solid var(--bf-border-subtle)',
            }}
          >
            <div
              style={{
                width: `var(--bf-space-${n})`,
                height: 24,
                background: 'var(--bf-accent)',
              }}
            />
            <div style={{ fontFamily: 'var(--bf-font-mono)', fontSize: 11 }}>--bf-space-{n}</div>
          </div>
        ))}
      </Group>
    </div>
  ),
}
