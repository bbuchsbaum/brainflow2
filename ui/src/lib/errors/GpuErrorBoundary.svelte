<!--
  GPU-specific Error Boundary
  Handles WebGPU context loss and recovery
-->
<script lang="ts">
  import ErrorBoundary from './ErrorBoundary.svelte';
  import { getEventBus } from '$lib/events/EventBus';
  import { onMount } from 'svelte';
  
  export let onContextLost: (() => void) | null = null;
  export let onContextRestored: (() => void) | null = null;
  
  let errorBoundary: ErrorBoundary;
  let contextLostError: Error | null = null;
  
  const eventBus = getEventBus();
  
  // GPU-specific error types
  const GPU_ERROR_TYPES = {
    CONTEXT_LOST: 'GPUContextLost',
    OUT_OF_MEMORY: 'GPUOutOfMemory',
    VALIDATION_ERROR: 'GPUValidationError',
    DEVICE_LOST: 'GPUDeviceLost'
  };
  
  // Check if error is GPU-related
  function isGpuError(error: Error): boolean {
    return error.name in GPU_ERROR_TYPES ||
           error.message.toLowerCase().includes('gpu') ||
           error.message.toLowerCase().includes('webgpu') ||
           error.message.toLowerCase().includes('context lost');
  }
  
  // Handle GPU-specific errors
  function handleGpuError(error: Error, errorInfo: any) {
    if (!isGpuError(error)) {
      return;
    }
    
    eventBus.emit('gpu.error', {
      error,
      errorInfo,
      type: error.name || 'Unknown'
    });
    
    // Handle context loss specifically
    if (error.name === GPU_ERROR_TYPES.CONTEXT_LOST || 
        error.message.includes('context lost')) {
      contextLostError = error;
      onContextLost?.();
      
      // Attempt automatic recovery
      attemptContextRecovery();
    }
  }
  
  // Attempt to recover GPU context
  async function attemptContextRecovery() {
    try {
      // Wait a bit before attempting recovery
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Request GPU reinitialization
      eventBus.emit('gpu.reinitialize.request', {});
      
      // Listen for successful reinitialization
      const unsubscribe = eventBus.on('gpu.reinitialize.success', () => {
        contextLostError = null;
        onContextRestored?.();
        errorBoundary?.reset();
        unsubscribe();
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        unsubscribe();
        if (contextLostError) {
          eventBus.emit('gpu.reinitialize.failed', {
            error: contextLostError
          });
        }
      }, 5000);
      
    } catch (err) {
      console.error('Failed to recover GPU context:', err);
      eventBus.emit('gpu.reinitialize.failed', {
        error: err
      });
    }
  }
  
  // Custom fallback for GPU errors
  const GpuErrorFallback = {
    render: (props: { error: Error }) => {
      const isOutOfMemory = props.error.name === GPU_ERROR_TYPES.OUT_OF_MEMORY ||
                           props.error.message.includes('out of memory');
      
      return {
        html: `
          <div class="gpu-error-fallback p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h4 class="text-lg font-semibold text-yellow-800 mb-2">
              GPU Error Detected
            </h4>
            <p class="text-yellow-700 mb-4">
              ${isOutOfMemory 
                ? 'The GPU has run out of memory. Try closing other GPU-intensive applications.'
                : 'A GPU error occurred. The system will attempt to recover automatically.'}
            </p>
            ${contextLostError ? `
              <div class="flex items-center gap-2 text-sm text-yellow-600">
                <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Attempting to recover GPU context...
              </div>
            ` : ''}
          </div>
        `,
        props: {}
      };
    }
  };
  
  // Monitor GPU device status
  onMount(() => {
    const unsubscribes = [
      eventBus.on('gpu.device.lost', () => {
        handleGpuError(
          new Error('GPU device was lost'),
          { type: GPU_ERROR_TYPES.DEVICE_LOST }
        );
      }),
      
      eventBus.on('gpu.validation.error', (data) => {
        handleGpuError(
          new Error(data.message || 'GPU validation error'),
          { type: GPU_ERROR_TYPES.VALIDATION_ERROR, ...data }
        );
      })
    ];
    
    return () => unsubscribes.forEach(fn => fn());
  });
</script>

<ErrorBoundary
  bind:this={errorBoundary}
  fallback={GpuErrorFallback}
  onError={handleGpuError}
  maxRetries={2}
  retryDelay={2000}
>
  <slot />
</ErrorBoundary>

<style>
  :global(.gpu-error-fallback) {
    animation: fadeIn 0.3s ease-out;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>