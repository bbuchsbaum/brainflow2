/**
 * Stylelint guardrail template.
 * Merge with an existing Stylelint config and start as warnings during migration.
 */

module.exports = {
  rules: {
    // Disallow raw hex colors in CSS. Allow token files or generated output through ignore patterns in your real config.
    'color-no-hex': true,

    // Optional examples to adapt:
    // 'declaration-property-value-disallowed-list': {
    //   '/^border-radius$/': ['/^[0-9.]+px$/'],
    //   '/^box-shadow$/': ['/.+/'],
    // },
  },
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/*tokens*.css',
    '**/tokens/**',
  ],
}
