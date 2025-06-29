<!--
  Error Boundary Component for GPU Operations
  Provides graceful error handling with recovery options
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getEventBus } from '$lib/events/EventBus';
  import type { ComponentType } from 'svelte';
  
  export let fallback: ComponentType | null = null;
  export let onError: ((error: Error, errorInfo: any) => void) | null = null;
  export let maxRetries = 3;
  export let retryDelay = 1000;
  
  let error: Error | null = null;
  let errorInfo: any = null;
  let retryCount = 0;
  let isRetrying = false;
  
  const eventBus = getEventBus();
  
  // Catch errors from child components
  function handleError(err: Error, info: any) {
    error = err;
    errorInfo = info;
    
    // Call custom error handler if provided
    onError?.(err, info);
    
    // Emit error event
    eventBus.emit('error.boundary.caught', {
      error: err,
      errorInfo: info,
      component: 'ErrorBoundary'
    });
    
    // Log for debugging
    console.error('Error caught by boundary:', err, info);
  }
  
  // Retry logic for GPU operations
  async function retry() {
    if (retryCount >= maxRetries) {
      eventBus.emit('error.boundary.max_retries', {
        error,
        retryCount,
        component: 'ErrorBoundary'
      });
      return;
    }
    
    isRetrying = true;
    retryCount++;
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount));
    
    // Clear error state
    error = null;
    errorInfo = null;
    isRetrying = false;
  }
  
  // Reset error state
  function reset() {
    error = null;
    errorInfo = null;
    retryCount = 0;
    isRetrying = false;
  }
  
  // Listen for global reset events
  onMount(() => {
    const unsubscribe = eventBus.on('error.boundary.reset', reset);
    return () => unsubscribe();
  });
  
  // Expose reset method to parent
  export { reset };
</script>

<div class="error-boundary">
  {#if error}
    <div class="error-container p-4 bg-red-50 border border-red-200 rounded-lg">
      <h3 class="text-lg font-semibold text-red-800 mb-2">
        {error.name || 'Error'}
      </h3>
      
      <p class="text-red-700 mb-4">
        {error.message}
      </p>
      
      {#if errorInfo?.componentStack}
        <details class="mb-4">
          <summary class="cursor-pointer text-sm text-red-600 hover:text-red-800">
            Component Stack
          </summary>
          <pre class="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
            {errorInfo.componentStack}
          </pre>
        </details>
      {/if}
      
      <div class="flex gap-2">
        {#if retryCount < maxRetries}
          <button
            on:click={retry}
            disabled={isRetrying}
            class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {isRetrying ? 'Retrying...' : `Retry (${retryCount}/${maxRetries})`}
          </button>
        {/if}
        
        <button
          on:click={reset}
          class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Reset
        </button>
      </div>
      
      {#if retryCount >= maxRetries}
        <p class="mt-4 text-sm text-red-600">
          Maximum retry attempts reached. Please refresh the page.
        </p>
      {/if}
    </div>
    
    {#if fallback}
      <div class="mt-4">
        <svelte:component this={fallback} {error} />
      </div>
    {/if}
  {:else}
    <slot />
  {/if}
</div>

<style>
  .error-boundary {
    position: relative;
    width: 100%;
    height: 100%;
  }
  
  .error-container {
    margin: 1rem;
    animation: slideIn 0.3s ease-out;
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>