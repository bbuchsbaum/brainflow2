// .storybook/preview.ts template. Merge with an existing preview file.
import type { Preview } from '@storybook/react'
import '../src/styles/tokens.css'
import '../src/styles/globals.css'

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    backgrounds: {
      default: 'surface',
      values: [
        { name: 'surface', value: 'var(--color-surface-1)' },
        { name: 'surface-2', value: 'var(--color-surface-2)' },
      ],
    },
  },
}

export default preview
