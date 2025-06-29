import type { ComponentContainer } from 'golden-layout'; // Removed unused JsonValue, LayoutConfig, Registration
import { GoldenLayout } from 'golden-layout'; // Removed unused ComponentItem
import type { SvelteComponent, ComponentProps } from 'svelte';
import { coreApi } from '$lib/api'; // NOTE: This will still fail until BF-027 is done
import { getContext } from 'svelte'; // Removed unused setContext

// Define a context key
const GL_CONTAINER_CONTEXT_KEY = Symbol('gl-container');

/**
 * Registers a Svelte component factory with GoldenLayout.
 * Handles mounting, unmounting, and passing the GL container via context.
 * Also attempts backend resource cleanup on destroy.
 */
export function glRegister<T extends typeof SvelteComponent>(
    layoutManager: GoldenLayout,
    componentType: string,
    SvelteComp: T,
    defaultTitle: string = "Panel"
): void {
    layoutManager.registerComponentFactoryFunction(componentType, (container, initialState) => {
        const host = document.createElement('div');
        host.style.position = 'relative'; // Needed for absolute positioning within
        host.style.overflow = 'auto';    // Ensure content scrolls if needed
        host.style.height = '100%';
        host.style.width = '100%';      // Ensure div fills container
        container.element.append(host);

        // Provide container API via Svelte context within this component tree
        const context = new Map<symbol, ComponentContainer>([
            [GL_CONTAINER_CONTEXT_KEY, container]
        ]);

        const comp = new SvelteComp({
            target: host,
            // Ensure initialState is correctly typed or cast if needed
            props: { initialState: initialState as ComponentProps<InstanceType<T>>['initialState'] },
            context: context,
        });

        if (!container.title && defaultTitle) {
            container.setTitle(defaultTitle);
        }

        // --- Cleanup Hook ---
        container.on('destroy', () => {
            try {
                comp.$destroy(); // Ensures Svelte cleanup (onDestroy)
            } catch (e) { console.error(`Error destroying Svelte component '${componentType}':`, e); }

            // Best-effort backend cleanup using persisted state if available
            // State must be explicitly saved by the component using container.setState()
            const state = container.state as { id?: string, filePath?: string }; // Example state fields
            const resourceId = state?.id; // Assuming 'id' is the key used to store the backend resource identifier

            // Attempt to release resources if an ID is identifiable
            if (resourceId) {
                 console.log(`Attempting to release backend resources for component ID: ${resourceId}`);
                 // Ensure the Core API command name is correct ('release_view_resources')
                 coreApi.release_view_resources(resourceId) // Use resourceId from state
                    .then((result: unknown) => { // Explicitly type result
                         // Check if result is structured error or simple success/failure
                         if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
                            // Now TypeScript knows result might have 'reason' if it adheres to a specific error structure
                            const reason = (result as { reason?: string }).reason || 'Unknown reason';
                            console.warn(`Backend resource release failed for ${resourceId}: ${reason}`);
                             // TODO: Implement retry queue if needed
                         }
                         // Type guard for simple success/failure structure
                         else if(result && typeof result === 'object' && 'success' in result && result.success === false) {
                            // Now TypeScript knows result might have 'message'
                            const message = (result as { message?: string }).message || 'Unknown failure message';
                             console.warn(`Backend resource release failed for ${resourceId}: ${message}`);
                         } else {
                              console.log(`Backend resource release successful/acknowledged for ${resourceId}`);
                         }
                     })
                     .catch((e: unknown) => { // Use unknown for better type safety
                         console.error(`API call failed during resource release for ${resourceId}:`, e);
                          // TODO: Implement retry queue
                     });
            } else {
                console.warn(`Cannot release backend resources for component '${componentType}': No identifiable ID found in state or container.`);
            }
        });

        // Resize handling: Let components access the container via context and listen if needed.
        // Alternatively, use a global ResizeBus store.
        // container.on('resize', () => { ... });
    });

    // Return type might be needed if GL expects it, e.g., for unregistering
    // return { componentType: componentType, factory: SvelteComp };
}

/**
 * Helper function to retrieve the GoldenLayout ComponentContainer from Svelte context.
 * Must be called within a component initialized by glRegister.
 */
export function getGlContainer(): ComponentContainer {
    const container = getContext<ComponentContainer>(GL_CONTAINER_CONTEXT_KEY);
    if (!container) {
        throw new Error("`getGlContainer` must be called within a component managed by GoldenLayout (via `glRegister`).");
    }
    return container;
}

// Optional: Type guard for checking if an object is a potential structured error
// interface StructuredError {
//     ok: false;
//     reason: string;
//     // Add other potential fields like 'code' if applicable
// }
// function isStructuredError(obj: any): obj is StructuredError {
//     return obj && typeof obj === 'object' && obj.ok === false && typeof obj.reason === 'string';
// } 