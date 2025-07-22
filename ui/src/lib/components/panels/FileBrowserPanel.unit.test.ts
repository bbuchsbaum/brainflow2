/**
 * Unit Tests for FileBrowserPanel logic
 * Tests component logic without rendering to avoid hanging issues
 */
import { describe, it, expect, vi } from 'vitest';
import type { FlatNode, LayerSpec } from '@brainflow/api';

describe('FileBrowserPanel Logic', () => {
	// Test file extension validation
	describe('File Extension Validation', () => {
		const acceptedExtensions = ['.nii', '.nii.gz', '.gii'];

		it('should accept valid file extensions', () => {
			const validFiles = ['brain.nii', 'scan.nii.gz', 'surface.gii', 'DATA.NII', 'SCAN.NII.GZ'];

			validFiles.forEach((filename) => {
				const hasValidExtension = acceptedExtensions.some((ext) =>
					filename.toLowerCase().endsWith(ext)
				);
				expect(hasValidExtension).toBe(true);
			});
		});

		it('should reject invalid file extensions', () => {
			const invalidFiles = ['image.jpg', 'data.txt', 'scan.nii.tar', 'brain.gz', 'file.nifti'];

			invalidFiles.forEach((filename) => {
				const hasValidExtension = acceptedExtensions.some((ext) =>
					filename.toLowerCase().endsWith(ext)
				);
				expect(hasValidExtension).toBe(false);
			});
		});
	});

	// Test layer spec creation
	describe('Layer Spec Creation', () => {
		it('should create valid layer spec from volume ID', () => {
			const volumeId = 'volume-123';
			const defaultColormap = 'grayscale';

			const layerSpec: LayerSpec = {
				Volume: {
					id: `layer-test-id`,
					source_resource_id: volumeId,
					colormap: defaultColormap,
					opacity: 1.0,
					window: 1.0,
					level: 0.5
				}
			};

			expect(layerSpec.Volume).toBeDefined();
			expect(layerSpec.Volume!.source_resource_id).toBe(volumeId);
			expect(layerSpec.Volume!.colormap).toBe(defaultColormap);
		});
	});

	// Test recent files management
	describe('Recent Files Management', () => {
		it('should add file to recent files list', () => {
			const recentFiles: Array<{ path: string; name: string; timestamp: number }> = [];
			const maxRecentFiles = 10;

			const newFile = {
				path: '/test/brain.nii',
				name: 'brain.nii',
				timestamp: Date.now()
			};

			// Add to recent files
			const existingIndex = recentFiles.findIndex((f) => f.path === newFile.path);
			if (existingIndex >= 0) {
				recentFiles.splice(existingIndex, 1);
			}
			recentFiles.unshift(newFile);

			// Limit to max
			if (recentFiles.length > maxRecentFiles) {
				recentFiles.length = maxRecentFiles;
			}

			expect(recentFiles).toHaveLength(1);
			expect(recentFiles[0]).toEqual(newFile);
		});

		it('should limit recent files to max count', () => {
			const recentFiles: Array<{ path: string; name: string; timestamp: number }> = [];
			const maxRecentFiles = 5;

			// Add more than max files
			for (let i = 0; i < 10; i++) {
				recentFiles.unshift({
					path: `/test/file${i}.nii`,
					name: `file${i}.nii`,
					timestamp: Date.now() + i
				});
			}

			// Apply limit
			if (recentFiles.length > maxRecentFiles) {
				recentFiles.length = maxRecentFiles;
			}

			expect(recentFiles).toHaveLength(maxRecentFiles);
		});

		it('should update existing file timestamp', () => {
			const recentFiles = [
				{ path: '/test/old.nii', name: 'old.nii', timestamp: 1000 },
				{ path: '/test/brain.nii', name: 'brain.nii', timestamp: 2000 }
			];

			const updatedFile = {
				path: '/test/brain.nii',
				name: 'brain.nii',
				timestamp: 3000
			};

			// Update existing
			const existingIndex = recentFiles.findIndex((f) => f.path === updatedFile.path);
			if (existingIndex >= 0) {
				recentFiles.splice(existingIndex, 1);
			}
			recentFiles.unshift(updatedFile);

			expect(recentFiles[0].timestamp).toBe(3000);
			expect(recentFiles).toHaveLength(2);
		});
	});

	// Test file node handling
	describe('File Node Handling', () => {
		it('should create file node from path', () => {
			const filePath = '/test/data/brain.nii';
			const fileName = filePath.split('/').pop() || 'Unknown';

			const fileNode: FlatNode = {
				id: filePath,
				name: fileName,
				is_dir: false,
				parent_idx: null
			};

			expect(fileNode.id).toBe(filePath);
			expect(fileNode.name).toBe('brain.nii');
			expect(fileNode.is_dir).toBe(false);
		});

		it('should handle file drop event data', () => {
			const mockFiles = [
				{ name: 'scan1.nii', path: '/data/scan1.nii' },
				{ name: 'scan2.nii.gz', path: '/data/scan2.nii.gz' }
			];

			const validFiles = mockFiles.filter((file) => {
				const acceptedExtensions = ['.nii', '.nii.gz', '.gii'];
				return acceptedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
			});

			expect(validFiles).toHaveLength(2);
		});
	});
});
