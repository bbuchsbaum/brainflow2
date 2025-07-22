/**
 * Tests for Mount Store
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { mountStore, FILE_PATTERNS, useMountStore, type MountedDirectory } from './mountStore';

describe('mountStore', () => {
	beforeEach(() => {
		// Reset store to initial state by creating new mounts map
		const state = get(mountStore);
		state.mounts.clear();
		state.activeMountId = null;
	});

	describe('File patterns', () => {
		it('should define correct file patterns', () => {
			expect(FILE_PATTERNS.nifti).toEqual(['.nii', '.nii.gz']);
			expect(FILE_PATTERNS.gifti).toEqual(['.gii', '.gii.gz']);
			expect(FILE_PATTERNS.image).toEqual(['.png', '.jpg', '.jpeg', '.bmp']);
			expect(FILE_PATTERNS.data).toEqual(['.csv', '.tsv', '.txt']);
			expect(FILE_PATTERNS.all).toEqual([]);
		});
	});

	describe('Mount directory', () => {
		it('should mount a directory with defaults', () => {
			const path = '/data/test';
			const id = mountStore.mountDirectory(path);

			expect(id).toMatch(/^mount-\d+-[a-z0-9]+$/);

			const mount = mountStore.getMountById(id);
			expect(mount).toBeDefined();
			expect(mount?.path).toBe(path);
			expect(mount?.label).toBe('test');
			expect(mount?.filePatterns).toEqual(FILE_PATTERNS.nifti);
			expect(mount?.isExpanded).toBe(true);
		});

		it('should mount a directory with custom label', () => {
			const id = mountStore.mountDirectory('/data/test', 'My Data');

			const mount = mountStore.getMountById(id);
			expect(mount?.label).toBe('My Data');
		});

		it('should mount a directory with custom file patterns', () => {
			const customPatterns = ['.dcm', '.dicom'];
			const id = mountStore.mountDirectory('/data/test', undefined, customPatterns);

			const mount = mountStore.getMountById(id);
			expect(mount?.filePatterns).toEqual(customPatterns);
		});

		it('should automatically set new mount as active', () => {
			const id = mountStore.mountDirectory('/data/test');

			expect(mountStore.getState().activeMountId).toBe(id);
		});

		it('should handle root directory path', () => {
			const id = mountStore.mountDirectory('/');

			const mount = mountStore.getMountById(id);
			expect(mount?.label).toBe('/');
		});

		it('should generate unique IDs', () => {
			const id1 = mountStore.mountDirectory('/data/test1');
			const id2 = mountStore.mountDirectory('/data/test2');

			expect(id1).not.toBe(id2);
		});
	});

	describe('Unmount directory', () => {
		it('should unmount a directory', () => {
			const id = mountStore.mountDirectory('/data/test');

			mountStore.unmountDirectory(id);

			const mount = mountStore.getMountById(id);
			expect(mount).toBeUndefined();
			expect(get(mountStore).mounts.size).toBe(0);
		});

		it('should update active mount when unmounting active', () => {
			const id1 = mountStore.mountDirectory('/data/test1');
			const id2 = mountStore.mountDirectory('/data/test2');

			// id2 is currently active
			expect(get(mountStore).activeMountId).toBe(id2);

			// Unmount active
			mountStore.unmountDirectory(id2);

			// Should switch to first available
			expect(get(mountStore).activeMountId).toBe(id1);
		});

		it('should clear active mount when unmounting last', () => {
			const id = mountStore.mountDirectory('/data/test');

			mountStore.unmountDirectory(id);

			expect(get(mountStore).activeMountId).toBe(null);
		});

		it('should not affect active mount when unmounting non-active', () => {
			const id1 = mountStore.mountDirectory('/data/test1');
			const id2 = mountStore.mountDirectory('/data/test2');

			// Set id1 as active
			mountStore.setActiveMountId(id1);

			// Unmount id2
			mountStore.unmountDirectory(id2);

			// Active should remain id1
			expect(get(mountStore).activeMountId).toBe(id1);
		});

		it('should handle unmounting non-existent mount', () => {
			mountStore.unmountDirectory('non-existent');

			// Should not throw
			expect(get(mountStore).mounts.size).toBe(0);
		});
	});

	describe('Active mount', () => {
		it('should set active mount ID', () => {
			const id = mountStore.mountDirectory('/data/test');
			const id2 = mountStore.mountDirectory('/data/test2');

			mountStore.setActiveMountId(id);

			expect(get(mountStore).activeMountId).toBe(id);
		});

		it('should clear active mount ID', () => {
			const id = mountStore.mountDirectory('/data/test');

			mountStore.setActiveMountId(null);

			expect(get(mountStore).activeMountId).toBe(null);
		});

		it('should allow setting non-existent mount as active', () => {
			mountStore.setActiveMountId('non-existent');

			expect(get(mountStore).activeMountId).toBe('non-existent');
		});
	});

	describe('Toggle mount expanded', () => {
		it('should toggle mount expanded state', () => {
			const id = mountStore.mountDirectory('/data/test');

			// Initially expanded
			expect(mountStore.getMountById(id)?.isExpanded).toBe(true);

			// Toggle to collapsed
			mountStore.toggleMountExpanded(id);
			expect(mountStore.getMountById(id)?.isExpanded).toBe(false);

			// Toggle back to expanded
			mountStore.toggleMountExpanded(id);
			expect(mountStore.getMountById(id)?.isExpanded).toBe(true);
		});

		it('should handle toggling non-existent mount', () => {
			const stateBefore = get(mountStore);

			mountStore.toggleMountExpanded('non-existent');

			const stateAfter = get(mountStore);
			expect(stateAfter).toEqual(stateBefore);
		});
	});

	describe('Update mount patterns', () => {
		it('should update mount file patterns', () => {
			const id = mountStore.mountDirectory('/data/test');
			const newPatterns = ['.mha', '.mhd'];

			mountStore.updateMountPatterns(id, newPatterns);

			const mount = mountStore.getMountById(id);
			expect(mount?.filePatterns).toEqual(newPatterns);
		});

		it('should handle updating patterns for non-existent mount', () => {
			const stateBefore = get(mountStore);

			mountStore.updateMountPatterns('non-existent', ['.txt']);

			const stateAfter = get(mountStore);
			expect(stateAfter).toEqual(stateBefore);
		});

		it('should allow empty patterns array', () => {
			const id = mountStore.mountDirectory('/data/test');

			mountStore.updateMountPatterns(id, []);

			const mount = mountStore.getMountById(id);
			expect(mount?.filePatterns).toEqual([]);
		});
	});

	describe('Get mount by ID', () => {
		it('should get mount by ID', () => {
			const id = mountStore.mountDirectory('/data/test', 'Test Mount');

			const mount = mountStore.getMountById(id);

			expect(mount).toBeDefined();
			expect(mount?.id).toBe(id);
			expect(mount?.path).toBe('/data/test');
			expect(mount?.label).toBe('Test Mount');
		});

		it('should return undefined for non-existent mount', () => {
			const mount = mountStore.getMountById('non-existent');

			expect(mount).toBeUndefined();
		});
	});

	describe('Get all mounts', () => {
		it('should get all mounts as array', () => {
			const id1 = mountStore.mountDirectory('/data/test1');
			const id2 = mountStore.mountDirectory('/data/test2');
			const id3 = mountStore.mountDirectory('/data/test3');

			const allMounts = mountStore.getAllMounts();

			expect(allMounts).toHaveLength(3);
			expect(allMounts.map((m) => m.id)).toContain(id1);
			expect(allMounts.map((m) => m.id)).toContain(id2);
			expect(allMounts.map((m) => m.id)).toContain(id3);
		});

		it('should return empty array when no mounts', () => {
			const allMounts = mountStore.getAllMounts();

			expect(allMounts).toEqual([]);
		});

		it('should return mounts in consistent order', () => {
			// Add mounts
			mountStore.mountDirectory('/data/a');
			mountStore.mountDirectory('/data/b');
			mountStore.mountDirectory('/data/c');

			const mounts1 = mountStore.getAllMounts();
			const mounts2 = mountStore.getAllMounts();

			expect(mounts1.map((m) => m.path)).toEqual(mounts2.map((m) => m.path));
		});
	});

	describe('useMountStore hook', () => {
		it('should return the store instance', () => {
			const id = mountStore.mountDirectory('/data/test');

			const store = useMountStore();

			// useMountStore returns the store instance itself
			expect(store).toBe(mountStore);
			expect(get(store).mounts.size).toBe(1);
			expect(get(store).activeMountId).toBe(id);
			expect(typeof store.mountDirectory).toBe('function');
		});
	});

	describe('Complex scenarios', () => {
		it('should handle multiple mounts with different configurations', () => {
			const id1 = mountStore.mountDirectory('/data/nifti', 'NIfTI Files', FILE_PATTERNS.nifti);
			const id2 = mountStore.mountDirectory('/data/images', 'Images', FILE_PATTERNS.image);
			const id3 = mountStore.mountDirectory('/data/all', 'All Files', FILE_PATTERNS.all);

			const mounts = mountStore.getAllMounts();
			expect(mounts).toHaveLength(3);

			const niftiMount = mountStore.getMountById(id1);
			expect(niftiMount?.filePatterns).toEqual(FILE_PATTERNS.nifti);

			const imageMount = mountStore.getMountById(id2);
			expect(imageMount?.filePatterns).toEqual(FILE_PATTERNS.image);

			const allMount = mountStore.getMountById(id3);
			expect(allMount?.filePatterns).toEqual([]);
		});

		it('should maintain mount state through updates', () => {
			const id = mountStore.mountDirectory('/data/test', 'Original');

			// Update various properties
			mountStore.toggleMountExpanded(id);
			mountStore.updateMountPatterns(id, ['.custom']);

			const mount = mountStore.getMountById(id);
			expect(mount?.label).toBe('Original'); // Unchanged
			expect(mount?.path).toBe('/data/test'); // Unchanged
			expect(mount?.isExpanded).toBe(false); // Changed
			expect(mount?.filePatterns).toEqual(['.custom']); // Changed
		});

		it('should handle mount lifecycle', () => {
			// Mount directories
			const id1 = mountStore.mountDirectory('/data/1');
			const id2 = mountStore.mountDirectory('/data/2');
			const id3 = mountStore.mountDirectory('/data/3');

			expect(get(mountStore).mounts.size).toBe(3);
			expect(get(mountStore).activeMountId).toBe(id3);

			// Update mounts
			mountStore.toggleMountExpanded(id1);
			mountStore.updateMountPatterns(id2, ['.txt']);

			// Unmount middle one
			mountStore.unmountDirectory(id2);
			expect(get(mountStore).mounts.size).toBe(2);

			// Set different active
			mountStore.setActiveMountId(id1);
			expect(get(mountStore).activeMountId).toBe(id1);

			// Unmount all
			mountStore.unmountDirectory(id1);
			mountStore.unmountDirectory(id3);

			expect(get(mountStore).mounts.size).toBe(0);
			expect(get(mountStore).activeMountId).toBe(null);
		});
	});

	describe('Store subscriptions', () => {
		it('should support subscriptions', () => {
			let storeChanges = 0;
			let lastState: any = null;

			// Subscribe to store changes
			const unsubscribe = mountStore.subscribe((state) => {
				storeChanges++;
				lastState = state;
			});

			// Initial subscription call
			expect(storeChanges).toBe(1);

			// This should trigger
			const id1 = mountStore.mountDirectory('/data/1');
			expect(storeChanges).toBe(2);
			expect(lastState.activeMountId).toBe(id1);

			// This should trigger
			mountStore.toggleMountExpanded(id1);
			expect(storeChanges).toBe(3);

			// This should trigger
			mountStore.setActiveMountId(null);
			expect(storeChanges).toBe(4);
			expect(lastState.activeMountId).toBe(null);

			unsubscribe();
		});
		
		it('should support getState for non-reactive access', () => {
			const id = mountStore.mountDirectory('/data/test');
			
			// getState() provides synchronous access
			const state = mountStore.getState();
			expect(state.mounts.size).toBe(1);
			expect(state.activeMountId).toBe(id);
		});
	});
});
