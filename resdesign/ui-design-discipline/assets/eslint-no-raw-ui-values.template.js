/**
 * Minimal ESLint custom rule template for UI discipline.
 * This is intentionally conservative. Adapt it before enforcing in CI.
 */

const HEX = /#[0-9a-fA-F]{3,8}\b/
const ARBITRARY_TAILWIND = /\b(?:m|mt|mr|mb|ml|mx|my|p|pt|pr|pb|pl|px|py|gap|w|h|min-w|min-h|max-w|max-h|rounded|text|bg|border|shadow)-\[[^\]]+\]/

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'discourage raw UI values outside design-system token files',
    },
    messages: {
      rawHex: 'Raw color "{{value}}" should be a semantic token or theme utility.',
      inlineStyle: 'Static inline styles should usually be tokens/classes. Use an allowlist comment for dynamic runtime values.',
      arbitraryTailwind: 'Arbitrary Tailwind value "{{value}}" should be a token/theme value or documented exception.',
    },
  },
  create(context) {
    const filename = context.getFilename()
    const isTokenFile = /tokens|theme|tailwind\.config|design-system/.test(filename)

    function checkString(node, value) {
      if (!isTokenFile) {
        const hex = value.match(HEX)
        if (hex) context.report({ node, messageId: 'rawHex', data: { value: hex[0] } })
      }
      const arbitrary = value.match(ARBITRARY_TAILWIND)
      if (arbitrary && !/ui-discipline-allow/.test(value)) {
        context.report({ node, messageId: 'arbitraryTailwind', data: { value: arbitrary[0] } })
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkString(node, node.value)
      },
      TemplateElement(node) {
        checkString(node, node.value.raw)
      },
      JSXAttribute(node) {
        if (node.name && node.name.name === 'style') {
          context.report({ node, messageId: 'inlineStyle' })
        }
      },
    }
  },
}
