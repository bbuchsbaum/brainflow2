import type { Meta, StoryObj } from '@storybook/react-vite'
import { Activity, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { PanelHeader } from './PanelHeader'

// `PanelHeader` is the canonical `bf-panel-header` per Design.md §5.3 / §7.
// Headers are 34px (`--bf-panel-header-h`), uppercase section title with the
// `bf-role-section` typography role, and host a single primary action plus
// an overflow menu. See ui-contract §5.
const meta = {
  title: 'UI/PanelHeader',
  component: PanelHeader,
  parameters: {
    layout: 'padded',
    backgrounds: { default: 'panel' },
  },
  args: {
    title: 'Layers',
  },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 360,
          background: 'var(--bf-bg-panel)',
          border: '1px solid var(--bf-border-subtle)',
          borderRadius: 'var(--bf-radius-md)',
          overflow: 'hidden',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PanelHeader>

export default meta

type Story = StoryObj<typeof meta>

export const TitleOnly: Story = {}

export const WithIcon: Story = {
  args: { icon: <Activity className="h-3.5 w-3.5" /> },
}

export const WithPrimaryAction: Story = {
  args: {
    primaryAction: {
      label: 'Reload',
      onClick: () => {},
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      title: 'Reload layer registry',
    },
  },
}

export const WithOverflow: Story = {
  args: {
    primaryAction: {
      label: 'Reload',
      onClick: () => {},
    },
    overflowActions: [
      {
        id: 'settings',
        label: 'Layer settings…',
        icon: <Settings className="h-3.5 w-3.5" />,
        onClick: () => {},
      },
      {
        id: 'remove',
        label: 'Remove all',
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onClick: () => {},
        danger: true,
      },
    ],
  },
}
