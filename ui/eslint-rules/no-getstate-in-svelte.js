/**
 * ESLint rule to prevent using store.getState() in Svelte components
 * This pattern causes memory leaks by creating static snapshots
 */

module.exports = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow getState() calls in Svelte components',
			category: 'Best Practices',
			recommended: true
		},
		messages: {
			noGetState:
				'Do not use store.getState() in Svelte components. Use zustandToReadable() to create a reactive Svelte store instead.',
			staticSnapshot:
				'Using $state(store.getState()) creates a static snapshot that never updates. Use zustandToReadable() for reactive subscriptions.'
		},
		fixable: 'code',
		schema: []
	},

	create(context) {
		// Check if we're in a Svelte file
		const filename = context.getFilename();
		if (!filename.endsWith('.svelte')) {
			return {};
		}

		return {
			// Check for direct getState() calls
			CallExpression(node) {
				if (
					node.callee.type === 'MemberExpression' &&
					node.callee.property.type === 'Identifier' &&
					node.callee.property.name === 'getState'
				) {
					// Check if it's likely a store
					const objectName = node.callee.object.name;
					if (objectName && objectName.toLowerCase().includes('store')) {
						context.report({
							node,
							messageId: 'noGetState',
							fix(fixer) {
								// Suggest using zustandToReadable
								const storeName = objectName;
								return [
									fixer.insertTextBefore(
										node,
										`/* Use zustandToReadable(${storeName}) instead */\n`
									)
								];
							}
						});
					}
				}
			},

			// Check for $state(store.getState()) pattern
			CallExpression(node) {
				if (
					node.callee.type === 'Identifier' &&
					node.callee.name === '$state' &&
					node.arguments.length > 0
				) {
					const arg = node.arguments[0];
					if (
						arg.type === 'CallExpression' &&
						arg.callee.type === 'MemberExpression' &&
						arg.callee.property.type === 'Identifier' &&
						arg.callee.property.name === 'getState'
					) {
						context.report({
							node,
							messageId: 'staticSnapshot',
							fix(fixer) {
								const storeName = arg.callee.object.name;
								if (storeName) {
									// Provide a more complete fix suggestion
									const fixes = [];

									// Find the variable declaration
									const parent = node.parent;
									if (parent && parent.type === 'VariableDeclarator') {
										const varName = parent.id.name;

										// Replace the entire declaration
										fixes.push(
											fixer.replaceText(
												parent.parent,
												`const ${storeName}Readable = zustandToReadable(${storeName});\n\t$: ${varName} = $${storeName}Readable;`
											)
										);
									}

									return fixes;
								}
							}
						});
					}
				}
			}
		};
	}
};
