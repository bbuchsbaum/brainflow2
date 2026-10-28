interface Descriptor {
  requiredLimits?: Record<string, number>;
  [key: string]: unknown;
}
interface Adapter {
  limits: Record<string, number>;
  requestDevice(descriptor: Descriptor): Promise<{
    lost: Promise<{ reason: string; message: string }>;
    addEventListener(
      type: string,
      listener: (event: Event & { error?: { message?: string } }) => void,
    ): void;
  }>;
}

/** WGPU 0.20 predates Chromium 135's removal of this WebGPU dictionary member.
 * This adaptation lives only in our private worker, whose fixed slice shaders
 * use two inter-stage variables. Current WebGPU retains and validates the
 * replacement variable limit; every other requested limit stays unchanged.
 * Remove this adapter when upgrading the workspace's WGPU browser backend.
 * https://developer.chrome.com/blog/new-in-webgpu-133
 */
export function adaptWgpu20Descriptor(
  descriptor: Descriptor,
  limits: Record<string, number>,
): Descriptor {
  if (
    'maxInterStageShaderComponents' in limits ||
    !descriptor.requiredLimits ||
    !('maxInterStageShaderComponents' in descriptor.requiredLimits)
  )
    return descriptor;
  const requiredLimits = { ...descriptor.requiredLimits };
  delete requiredLimits.maxInterStageShaderComponents;
  requiredLimits.maxInterStageShaderVariables = Math.max(
    2,
    requiredLimits.maxInterStageShaderVariables ?? 0,
  );
  return { ...descriptor, requiredLimits };
}

export function installWgpu20Compatibility(onFatal: (message: string) => void) {
  // Some engines expose GPUAdapter's constructor only after adapter discovery.
  // Adapt returned instances, rather than depending on that global constructor.
  const gpu = (
    navigator as unknown as { gpu?: { requestAdapter(options?: unknown): Promise<Adapter | null> } }
  ).gpu;
  if (!gpu) return;
  const requestAdapter = gpu.requestAdapter;
  gpu.requestAdapter = async function (options?: unknown) {
    const adapter = await requestAdapter.call(this, options);
    if (adapter) {
      const requestDevice = adapter.requestDevice;
      adapter.requestDevice = async (descriptor) => {
        const device = await requestDevice.call(
          adapter,
          adaptWgpu20Descriptor(descriptor, adapter.limits),
        );
        device.addEventListener('uncapturederror', (event) => {
          onFatal(`WebGPU validation failed: ${event.error?.message ?? 'unknown device error'}`);
        });
        void device.lost.then((info) => {
          onFatal(
            `GPU device was lost (${info.reason}): ${info.message || 'device unavailable'}. Restart the viewer and reopen your files.`,
          );
        });
        return device;
      };
    }
    return adapter;
  };
}
