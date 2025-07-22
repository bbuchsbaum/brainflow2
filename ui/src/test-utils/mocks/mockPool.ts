/**
 * Mock Pool - Reusable mock instances to reduce memory allocation
 */
import { vi } from 'vitest';

// Singleton GPU mock instances
let gpuDeviceMock: any = null;
let gpuAdapterMock: any = null;
let gpuRenderManagerMock: any = null;

export function getGpuDeviceMock() {
	if (!gpuDeviceMock) {
		gpuDeviceMock = {
			queue: {
				submit: vi.fn(),
				writeBuffer: vi.fn(),
				writeTexture: vi.fn()
			},
			createBuffer: vi.fn().mockReturnValue({
				destroy: vi.fn(),
				mapAsync: vi.fn().mockResolvedValue(undefined),
				getMappedRange: vi.fn().mockReturnValue(new ArrayBuffer(1024)),
				unmap: vi.fn()
			}),
			createTexture: vi.fn().mockReturnValue({
				destroy: vi.fn(),
				createView: vi.fn().mockReturnValue({ destroy: vi.fn() })
			}),
			createShaderModule: vi.fn().mockReturnValue({
				compilationInfo: vi.fn().mockResolvedValue({ messages: [] })
			}),
			createRenderPipeline: vi.fn().mockReturnValue({
				getBindGroupLayout: vi.fn()
			}),
			createCommandEncoder: vi.fn().mockReturnValue({
				beginRenderPass: vi.fn().mockReturnValue({
					setPipeline: vi.fn(),
					setBindGroup: vi.fn(),
					draw: vi.fn(),
					end: vi.fn()
				}),
				copyTextureToBuffer: vi.fn(),
				finish: vi.fn().mockReturnValue({})
			}),
			destroy: vi.fn(),
			lost: Promise.resolve({ reason: 'destroyed' }),
			features: { has: vi.fn().mockReturnValue(true) },
			limits: {}
		};
	}
	return gpuDeviceMock;
}

export function getGpuAdapterMock() {
	if (!gpuAdapterMock) {
		gpuAdapterMock = {
			requestDevice: vi.fn().mockResolvedValue(getGpuDeviceMock()),
			features: { has: vi.fn().mockReturnValue(true) },
			limits: {}
		};
	}
	return gpuAdapterMock;
}

export function getGpuRenderManagerMock() {
	if (!gpuRenderManagerMock) {
		gpuRenderManagerMock = {
			initialize: vi.fn().mockResolvedValue(undefined),
			render: vi.fn().mockResolvedValue({
				imageData: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header
			}),
			dispose: vi.fn(),
			isInitialized: vi.fn().mockReturnValue(true)
		};
	}
	return gpuRenderManagerMock;
}

// Reset all mock functions but keep instances
export function resetMockPool() {
	if (gpuDeviceMock) {
		Object.values(gpuDeviceMock).forEach((val) => {
			if (typeof val === 'function' && val.mockClear) {
				val.mockClear();
			} else if (typeof val === 'object' && val !== null) {
				Object.values(val).forEach((nestedVal) => {
					if (typeof nestedVal === 'function' && (nestedVal as any).mockClear) {
						(nestedVal as any).mockClear();
					}
				});
			}
		});
	}

	if (gpuAdapterMock) {
		Object.values(gpuAdapterMock).forEach((val) => {
			if (typeof val === 'function' && (val as any).mockClear) {
				(val as any).mockClear();
			}
		});
	}

	if (gpuRenderManagerMock) {
		Object.values(gpuRenderManagerMock).forEach((val) => {
			if (typeof val === 'function' && (val as any).mockClear) {
				(val as any).mockClear();
			}
		});
	}
}

// Dispose of all mocks (for cleanup)
export function disposeMockPool() {
	gpuDeviceMock = null;
	gpuAdapterMock = null;
	gpuRenderManagerMock = null;
}
