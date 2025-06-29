import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 45_000,
	use: {
		baseURL: process.env.PW_BASE_URL ?? 'http://localhost:5173',
		headless: true,
	},
	webServer: {
		command: 'pnpm --filter ui dev',
		port: 5173,
		reuseExistingServer: !process.env.CI,
	}
});
