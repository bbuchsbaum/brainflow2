import type { Preview } from '@storybook/react-vite'

// Load the canonical Brainflow theme so every story renders against
// the real --bf-* tokens. See resdesign/Design.md §3.
import '../src/index.css'

const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: 'var(--bf-bg-app)' },
        { name: 'shell', value: 'var(--bf-bg-shell)' },
        { name: 'panel', value: 'var(--bf-bg-panel)' },
        { name: 'canvas', value: 'var(--bf-bg-canvas)' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
