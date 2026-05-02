import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'

// `Button` is the canonical `bf-button` (Design.md §14.1, ui-contract §3).
// Variants here mirror the spec; if a screen needs a new variant, add it
// to `Button` first — never override styles via className.
const meta = {
  title: 'UI/Button',
  component: Button,
  args: {
    children: 'Run analysis',
  },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Canonical `bf-button` per Design.md §14.1. Add new variants on the component, not in screens.',
      },
    },
  },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger', 'ghost'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Delete layer' } }
export const Ghost: Story = { args: { variant: 'ghost', children: 'Cancel' } }

export const Small: Story = { args: { size: 'sm' } }
export const Large: Story = { args: { size: 'lg' } }

export const Disabled: Story = { args: { disabled: true } }
export const Loading: Story = { args: { loading: true } }

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3 p-4 bg-bf-bg-panel rounded-bf-md">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
}
