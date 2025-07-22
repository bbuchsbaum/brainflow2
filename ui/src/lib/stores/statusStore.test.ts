/**
 * Tests for Status Store
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { statusStore } from './statusStore';

describe('statusStore', () => {
	beforeEach(() => {
		// Reset store to initial state
		statusStore.setMouseWorldCoord(null);
		statusStore.setFov(null);
		statusStore.setIntensity(null);
		statusStore.setCrosshairWorldCoord(null);
	});

	describe('Mouse world coordinates', () => {
		it('should set mouse world coordinates', () => {
			const coords: [number, number, number] = [10.5, 20.3, 30.7];

			statusStore.setMouseWorldCoord(coords);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toEqual(coords);
		});

		it('should clear mouse world coordinates', () => {
			statusStore.setMouseWorldCoord([1, 2, 3]);
			statusStore.setMouseWorldCoord(null);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toBe(null);
		});

		it('should update mouse coordinates without affecting other values', () => {
			// Set initial values
			statusStore.setFov(45);
			statusStore.setIntensity(128);

			// Update mouse coords
			statusStore.setMouseWorldCoord([5, 10, 15]);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toEqual([5, 10, 15]);
			expect(state.fov).toBe(45);
			expect(state.intensity).toBe(128);
		});
	});

	describe('Field of view', () => {
		it('should set field of view', () => {
			statusStore.setFov(90);

			const state = get(statusStore);
			expect(state.fov).toBe(90);
		});

		it('should handle decimal FOV values', () => {
			statusStore.setFov(45.5);

			const state = get(statusStore);
			expect(state.fov).toBe(45.5);
		});

		it('should clear field of view', () => {
			statusStore.setFov(60);
			statusStore.setFov(null);

			const state = get(statusStore);
			expect(state.fov).toBe(null);
		});

		it('should handle zero FOV', () => {
			statusStore.setFov(0);

			const state = get(statusStore);
			expect(state.fov).toBe(0);
		});
	});

	describe('Intensity', () => {
		it('should set intensity value', () => {
			statusStore.setIntensity(255);

			const state = get(statusStore);
			expect(state.intensity).toBe(255);
		});

		it('should handle decimal intensity values', () => {
			statusStore.setIntensity(127.5);

			const state = get(statusStore);
			expect(state.intensity).toBe(127.5);
		});

		it('should clear intensity', () => {
			statusStore.setIntensity(100);
			statusStore.setIntensity(null);

			const state = get(statusStore);
			expect(state.intensity).toBe(null);
		});

		it('should handle negative intensity', () => {
			statusStore.setIntensity(-50);

			const state = get(statusStore);
			expect(state.intensity).toBe(-50);
		});

		it('should handle zero intensity', () => {
			statusStore.setIntensity(0);

			const state = get(statusStore);
			expect(state.intensity).toBe(0);
		});
	});

	describe('Crosshair world coordinates', () => {
		it('should set crosshair world coordinates', () => {
			const coords: [number, number, number] = [-10, 0, 25];

			statusStore.setCrosshairWorldCoord(coords);

			const state = get(statusStore);
			expect(state.crosshairWorldCoord).toEqual(coords);
		});

		it('should clear crosshair world coordinates', () => {
			statusStore.setCrosshairWorldCoord([0, 0, 0]);
			statusStore.setCrosshairWorldCoord(null);

			const state = get(statusStore);
			expect(state.crosshairWorldCoord).toBe(null);
		});

		it('should handle negative coordinates', () => {
			const coords: [number, number, number] = [-100, -200, -300];

			statusStore.setCrosshairWorldCoord(coords);

			const state = get(statusStore);
			expect(state.crosshairWorldCoord).toEqual(coords);
		});

		it('should handle fractional coordinates', () => {
			const coords: [number, number, number] = [0.5, 1.5, 2.5];

			statusStore.setCrosshairWorldCoord(coords);

			const state = get(statusStore);
			expect(state.crosshairWorldCoord).toEqual(coords);
		});
	});

	describe('Multiple updates', () => {
		it('should handle rapid sequential updates', () => {
			// Perform multiple rapid updates
			statusStore.setMouseWorldCoord([1, 1, 1]);
			statusStore.setFov(30);
			statusStore.setIntensity(50);
			statusStore.setCrosshairWorldCoord([2, 2, 2]);
			statusStore.setMouseWorldCoord([3, 3, 3]);
			statusStore.setFov(60);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toEqual([3, 3, 3]);
			expect(state.fov).toBe(60);
			expect(state.intensity).toBe(50);
			expect(state.crosshairWorldCoord).toEqual([2, 2, 2]);
		});

		it('should update all values to non-null', () => {
			statusStore.setMouseWorldCoord([10, 20, 30]);
			statusStore.setFov(45);
			statusStore.setIntensity(128);
			statusStore.setCrosshairWorldCoord([0, 0, 0]);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toEqual([10, 20, 30]);
			expect(state.fov).toBe(45);
			expect(state.intensity).toBe(128);
			expect(state.crosshairWorldCoord).toEqual([0, 0, 0]);
		});

		it('should clear all values', () => {
			// Set values
			statusStore.setMouseWorldCoord([1, 2, 3]);
			statusStore.setFov(90);
			statusStore.setIntensity(255);
			statusStore.setCrosshairWorldCoord([4, 5, 6]);

			// Clear all
			statusStore.setMouseWorldCoord(null);
			statusStore.setFov(null);
			statusStore.setIntensity(null);
			statusStore.setCrosshairWorldCoord(null);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toBe(null);
			expect(state.fov).toBe(null);
			expect(state.intensity).toBe(null);
			expect(state.crosshairWorldCoord).toBe(null);
		});
	});

	describe('Store subscription', () => {
		it('should notify subscribers on changes', () => {
			const values: any[] = [];

			const unsubscribe = statusStore.subscribe((state) => {
				values.push({ ...state });
			});

			statusStore.setMouseWorldCoord([1, 2, 3]);
			statusStore.setFov(45);

			// Should have initial state + 2 updates
			expect(values).toHaveLength(3);
			expect(values[0]).toEqual({
				mouseWorldCoord: null,
				fov: null,
				intensity: null,
				crosshairWorldCoord: null
			});
			expect(values[1].mouseWorldCoord).toEqual([1, 2, 3]);
			expect(values[2].fov).toBe(45);

			unsubscribe();
		});

		it('should stop notifying after unsubscribe', () => {
			let callCount = 0;

			const unsubscribe = statusStore.subscribe(() => {
				callCount++;
			});

			statusStore.setFov(30);
			expect(callCount).toBe(2); // Initial + update

			unsubscribe();

			statusStore.setFov(60);
			expect(callCount).toBe(2); // No change
		});
	});

	describe('Edge cases', () => {
		it('should handle very large coordinate values', () => {
			const largeCoords: [number, number, number] = [1e6, -1e6, 1e9];

			statusStore.setMouseWorldCoord(largeCoords);
			statusStore.setCrosshairWorldCoord(largeCoords);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toEqual(largeCoords);
			expect(state.crosshairWorldCoord).toEqual(largeCoords);
		});

		it('should handle very small coordinate values', () => {
			const smallCoords: [number, number, number] = [1e-6, -1e-6, 1e-9];

			statusStore.setMouseWorldCoord(smallCoords);
			statusStore.setCrosshairWorldCoord(smallCoords);

			const state = get(statusStore);
			expect(state.mouseWorldCoord).toEqual(smallCoords);
			expect(state.crosshairWorldCoord).toEqual(smallCoords);
		});

		it('should handle Infinity and NaN', () => {
			statusStore.setFov(Infinity);
			statusStore.setIntensity(NaN);

			const state = get(statusStore);
			expect(state.fov).toBe(Infinity);
			expect(state.intensity).toBeNaN();
		});

		it('should store references to coordinate arrays', () => {
			const coords1: [number, number, number] = [1, 2, 3];
			const coords2: [number, number, number] = [4, 5, 6];

			statusStore.setMouseWorldCoord(coords1);
			statusStore.setCrosshairWorldCoord(coords2);

			const state = get(statusStore);
			// Store keeps references to the original arrays
			expect(state.mouseWorldCoord).toBe(coords1);
			expect(state.crosshairWorldCoord).toBe(coords2);

			// Changes to original arrays are reflected
			coords1[0] = 999;
			coords2[0] = 888;

			const state2 = get(statusStore);
			expect(state2.mouseWorldCoord).toEqual([999, 2, 3]);
			expect(state2.crosshairWorldCoord).toEqual([888, 5, 6]);
		});
	});
});
