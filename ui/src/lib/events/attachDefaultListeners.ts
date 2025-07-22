/**
 * Attach default event listeners to EventBus
 * This is called after the DI container is fully initialized
 * to avoid circular dependencies
 */
import type { EventBus } from './EventBus';
import type { DIContainer } from '$lib/di/Container';

export async function attachDefaultListeners(
	eventBus: EventBus,
	container: DIContainer
): Promise<void> {
	// Example: Add crosshair-related listeners if needed
	// const crosshairService = await container.resolve('crosshairService');

	// For now, we don't have any default listeners that need services
	// This function exists to provide a clean place to add them later
	// without creating circular dependencies

	console.log('[EventBus] Default listeners attached');
}
