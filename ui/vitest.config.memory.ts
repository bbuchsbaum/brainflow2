import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'path';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		setupFiles: ['./src/test-utils/setup/vitest-setup.ts'],
		globals: true,
		// Aggressive memory management
		pool: 'forks',
		poolOptions: {
			forks: {
				singleFork: true,
				isolate: true,
				maxForks: 1,
				minForks: 1
			}
		},
		// Split tests into smaller chunks
		sequence: {
			shuffle: false,
			concurrent: false
		},
		// Lower timeouts to catch hanging tests
		testTimeout: 15000,
		teardownTimeout: 5000,
		// Run tests in smaller batches
		maxConcurrency: 1,
		// Clear module cache between tests
		clearMocks: true,
		mockReset: true,
		restoreMocks: true,
		unstubGlobals: true,
		// Disable coverage to save memory
		coverage: {
			enabled: false
		}
	},
	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: path.resolve('./src/lib'),
			'@test-utils': path.resolve('./src/test-utils')
		}
	},
	// Lower memory limits
	optimizeDeps: {
		force: true
	}
});
