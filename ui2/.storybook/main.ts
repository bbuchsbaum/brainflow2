import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.@(ts|tsx|mdx)',
    '../src/**/__stories__/**/*.@(ts|tsx|mdx)',
  ],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
  },
}

export default config
