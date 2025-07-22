<!--
  State Helpers Example Component
  Demonstrates practical usage of state helpers for common UI patterns
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getService } from '$lib/di/Container';
	import type { VolumeService } from '$lib/services/VolumeService';
	import {
		createLoadingState,
		createPaginatedState,
		createDebouncedState,
		createFormState,
		createToggleState,
		createRetryableState
	} from '$lib/utils/stateHelpers';

	// Services
	let volumeService: VolumeService | null = null;

	// Example 1: Loading state for volume
	const volumeLoader = createLoadingState<any>();

	// Example 2: Paginated file list
	const fileList = createPaginatedState<any>(10);

	// Example 3: Debounced search
	const searchInput = createDebouncedState('', 500);

	// Example 4: Form with validation
	const loginForm = createFormState(
		{
			email: '',
			password: ''
		},
		{
			email: (value: string) => {
				if (!value) return 'Email is required';
				if (!value.includes('@')) return 'Invalid email format';
				return null;
			},
			password: (value: string) => {
				if (!value) return 'Password is required';
				if (value.length < 8) return 'Password must be at least 8 characters';
				return null;
			}
		}
	);

	// Example 5: Dark mode toggle with persistence
	const darkMode = createToggleState(false, 'brainflow-dark-mode');

	// Example 6: Retryable API call
	const apiLoader = createRetryableState<any>(3, 1000);

	// Mock functions for demonstration
	async function loadVolume() {
		await volumeLoader.load(async () => {
			// Simulate API call
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (Math.random() > 0.7) throw new Error('Random failure');
			return { id: '123', name: 'Brain_T1.nii', size: 1024000 };
		});
	}

	async function loadFiles(page: number, size: number) {
		// Simulate paginated API
		await new Promise((resolve) => setTimeout(resolve, 500));
		const files = [];
		for (let i = 0; i < size; i++) {
			const index = page * size + i;
			if (index >= 47) break; // Total of 47 files
			files.push({
				id: `file-${index}`,
				name: `scan_${index}.nii`,
				size: Math.floor(Math.random() * 5000000)
			});
		}
		return files;
	}

	async function searchFiles(query: string) {
		// Simulate search API
		await new Promise((resolve) => setTimeout(resolve, 300));
		return [
			{ id: '1', name: `${query}_result1.nii` },
			{ id: '2', name: `${query}_result2.nii` }
		];
	}

	async function submitLogin() {
		await loginForm.submit(async (values) => {
			console.log('Logging in with:', values);
			await new Promise((resolve) => setTimeout(resolve, 1000));
			// Simulate success
		});
	}

	async function unreliableApiCall() {
		// Fails 70% of the time
		await new Promise((resolve) => setTimeout(resolve, 500));
		if (Math.random() > 0.3) {
			throw new Error('API temporarily unavailable');
		}
		return { status: 'success', data: 'Important data' };
	}

	// React to search changes
	$effect(() => {
		if (searchInput.debouncedValue) {
			console.log('Searching for:', searchInput.debouncedValue);
			searchFiles(searchInput.debouncedValue);
		}
	});

	// Apply dark mode
	$effect(() => {
		document.documentElement.classList.toggle('dark', darkMode.value);
	});

	onMount(async () => {
		volumeService = await getService<VolumeService>('volumeService');

		// Load initial file list
		await fileList.load(loadFiles);
	});
</script>

<div class="state-helpers-example">
	<h2>State Helpers Examples</h2>

	<!-- Example 1: Loading State -->
	<section class="example-section">
		<h3>1. Loading State Helper</h3>
		<p>Simplifies async operations with built-in state management</p>

		<div class="example-content">
			<button onclick={loadVolume} disabled={volumeLoader.isLoading} class="btn-primary">
				Load Volume
			</button>

			{#if volumeLoader.isLoading}
				<div class="loading">Loading volume...</div>
			{:else if volumeLoader.error}
				<div class="error">
					Error: {volumeLoader.error.message}
					<button onclick={() => volumeLoader.reset()} class="btn-sm"> Reset </button>
				</div>
			{:else if volumeLoader.data}
				<div class="success">
					<h4>Volume Loaded!</h4>
					<p>Name: {volumeLoader.data.name}</p>
					<p>Size: {(volumeLoader.data.size / 1024 / 1024).toFixed(1)} MB</p>
					<p>Loaded {((Date.now() - volumeLoader.lastLoadTime) / 1000).toFixed(0)}s ago</p>
				</div>
			{:else}
				<p class="hint">Click button to load a volume</p>
			{/if}
		</div>

		<details class="code-snippet">
			<summary>View Code</summary>
			<pre><code
					>{`const volumeLoader = createLoadingState<Volume>();

await volumeLoader.load(() => volumeService.load(path));

{#if volumeLoader.isLoading}
  <Spinner />
{:else if volumeLoader.error}
  <Error {error} />
{:else if volumeLoader.data}
  <VolumeView volume={volumeLoader.data} />
{/if}`}</code
				></pre>
		</details>
	</section>

	<!-- Example 2: Paginated State -->
	<section class="example-section">
		<h3>2. Paginated State Helper</h3>
		<p>Handles pagination, loading more, and refresh patterns</p>

		<div class="example-content">
			<div class="file-list">
				{#each fileList.items as file}
					<div class="file-item">
						<span>{file.name}</span>
						<span class="file-size">{(file.size / 1024).toFixed(0)} KB</span>
					</div>
				{/each}
			</div>

			{#if fileList.isEmpty}
				<p class="empty">No files found</p>
			{/if}

			<div class="pagination-controls">
				<button
					onclick={() => fileList.loadMore(loadFiles)}
					disabled={!fileList.hasMore || fileList.isLoadingMore}
					class="btn-secondary"
				>
					{fileList.isLoadingMore ? 'Loading...' : 'Load More'}
				</button>

				<button
					onclick={() => fileList.refresh(loadFiles)}
					disabled={fileList.isLoading}
					class="btn-secondary"
				>
					Refresh
				</button>

				<span class="info">
					{fileList.items.length} items loaded
					{fileList.hasMore ? ' (more available)' : ' (all loaded)'}
				</span>
			</div>
		</div>
	</section>

	<!-- Example 3: Debounced State -->
	<section class="example-section">
		<h3>3. Debounced State Helper</h3>
		<p>Perfect for search inputs and real-time validation</p>

		<div class="example-content">
			<input
				type="text"
				placeholder="Search files..."
				bind:value={searchInput.value}
				class="search-input"
			/>

			<div class="search-info">
				<p>Current value: "{searchInput.value}"</p>
				<p>
					Debounced value: "{searchInput.debouncedValue}"
					{#if searchInput.isDebouncing}
						<span class="debouncing">(updating...)</span>
					{/if}
				</p>
			</div>
		</div>
	</section>

	<!-- Example 4: Form State -->
	<section class="example-section">
		<h3>4. Form State Helper</h3>
		<p>Simplifies form handling with built-in validation</p>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				submitLogin();
			}}
			class="example-form"
		>
			<div class="form-field">
				<label for="email">Email</label>
				<input
					id="email"
					type="email"
					value={loginForm.fields.email.value}
					oninput={(e) => loginForm.setFieldValue('email', e.currentTarget.value)}
					onblur={() => loginForm.setFieldTouched('email')}
					class:error={loginForm.fields.email.error && loginForm.fields.email.touched}
				/>
				{#if loginForm.fields.email.error && loginForm.fields.email.touched}
					<span class="field-error">{loginForm.fields.email.error}</span>
				{/if}
			</div>

			<div class="form-field">
				<label for="password">Password</label>
				<input
					id="password"
					type="password"
					value={loginForm.fields.password.value}
					oninput={(e) => loginForm.setFieldValue('password', e.currentTarget.value)}
					onblur={() => loginForm.setFieldTouched('password')}
					class:error={loginForm.fields.password.error && loginForm.fields.password.touched}
				/>
				{#if loginForm.fields.password.error && loginForm.fields.password.touched}
					<span class="field-error">{loginForm.fields.password.error}</span>
				{/if}
			</div>

			<div class="form-actions">
				<button
					type="submit"
					disabled={loginForm.isSubmitting || !loginForm.isValid}
					class="btn-primary"
				>
					{loginForm.isSubmitting ? 'Logging in...' : 'Login'}
				</button>

				<button type="button" onclick={() => loginForm.reset()} class="btn-secondary">
					Reset
				</button>
			</div>

			{#if loginForm.submitError}
				<div class="form-error">
					{loginForm.submitError.message}
				</div>
			{/if}
		</form>
	</section>

	<!-- Example 5: Toggle State -->
	<section class="example-section">
		<h3>5. Toggle State Helper</h3>
		<p>Simple toggle with optional persistence</p>

		<div class="example-content">
			<label class="toggle-label">
				<input type="checkbox" checked={darkMode.value} onchange={() => darkMode.toggle()} />
				Dark Mode (persisted to localStorage)
			</label>

			<p>Current theme: {darkMode.value ? 'Dark' : 'Light'}</p>
		</div>
	</section>

	<!-- Example 6: Retryable State -->
	<section class="example-section">
		<h3>6. Retryable State Helper</h3>
		<p>Automatic retry with exponential backoff</p>

		<div class="example-content">
			<button
				onclick={() => apiLoader.loadWithRetry(unreliableApiCall)}
				disabled={apiLoader.isLoading}
				class="btn-primary"
			>
				Call Unreliable API
			</button>

			{#if apiLoader.isLoading}
				<div class="loading">
					{apiLoader.isRetrying ? `Retrying... (attempt ${apiLoader.retryCount}/3)` : 'Loading...'}
				</div>
			{/if}

			{#if apiLoader.error}
				<div class="error">
					Failed after {apiLoader.retryCount} attempts: {apiLoader.error.message}
				</div>
			{/if}

			{#if apiLoader.data}
				<div class="success">
					<h4>Success!</h4>
					<p>{apiLoader.data.status}: {apiLoader.data.data}</p>
				</div>
			{/if}

			{#if apiLoader.nextRetryTime}
				<p class="retry-info">
					Next retry in {Math.ceil((apiLoader.nextRetryTime - Date.now()) / 1000)}s
				</p>
			{/if}
		</div>
	</section>
</div>

<style>
	.state-helpers-example {
		padding: 20px;
		max-width: 1200px;
		margin: 0 auto;
	}

	h2 {
		margin: 0 0 30px;
		color: var(--color-text-primary, #e0e0e0);
	}

	.example-section {
		background: var(--color-surface-900, #1a1a1a);
		border-radius: 8px;
		padding: 24px;
		margin-bottom: 24px;
	}

	h3 {
		margin: 0 0 8px;
		color: var(--color-primary, #3b82f6);
		font-size: 18px;
	}

	.example-section > p {
		margin: 0 0 20px;
		color: var(--color-text-secondary, #999);
		font-size: 14px;
	}

	.example-content {
		background: var(--color-surface-800, #2a2a2a);
		border-radius: 6px;
		padding: 20px;
	}

	/* Buttons */
	.btn-primary,
	.btn-secondary {
		padding: 10px 20px;
		border: none;
		border-radius: 6px;
		font-size: 14px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-primary {
		background: var(--color-primary, #3b82f6);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover, #2563eb);
	}

	.btn-secondary {
		background: var(--color-surface-700, #3a3a3a);
		color: var(--color-text-primary, #e0e0e0);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-surface-600, #4a4a4a);
	}

	.btn-sm {
		padding: 4px 8px;
		font-size: 12px;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* States */
	.loading {
		padding: 16px;
		background: var(--color-info-bg, #1e3a5f);
		color: var(--color-info, #60a5fa);
		border-radius: 4px;
		margin-top: 16px;
	}

	.error {
		padding: 16px;
		background: var(--color-error-bg, #450a0a);
		color: var(--color-error, #ff6b6b);
		border-radius: 4px;
		margin-top: 16px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.success {
		padding: 16px;
		background: var(--color-success-bg, #14532d);
		color: var(--color-success, #51cf66);
		border-radius: 4px;
		margin-top: 16px;
	}

	.success h4 {
		margin: 0 0 8px;
		color: var(--color-success, #51cf66);
	}

	.hint {
		color: var(--color-text-tertiary, #666);
		font-style: italic;
		margin-top: 16px;
	}

	/* File list */
	.file-list {
		max-height: 200px;
		overflow-y: auto;
		border: 1px solid var(--color-surface-700, #3a3a3a);
		border-radius: 4px;
		margin-bottom: 16px;
	}

	.file-item {
		padding: 8px 12px;
		display: flex;
		justify-content: space-between;
		border-bottom: 1px solid var(--color-surface-700, #3a3a3a);
		font-size: 14px;
	}

	.file-item:last-child {
		border-bottom: none;
	}

	.file-size {
		color: var(--color-text-tertiary, #666);
		font-size: 12px;
	}

	.pagination-controls {
		display: flex;
		gap: 12px;
		align-items: center;
	}

	.info {
		color: var(--color-text-secondary, #999);
		font-size: 14px;
	}

	/* Search */
	.search-input {
		width: 100%;
		padding: 10px;
		background: var(--color-surface-700, #3a3a3a);
		border: 1px solid var(--color-surface-600, #4a4a4a);
		color: var(--color-text-primary, #e0e0e0);
		border-radius: 4px;
		font-size: 14px;
	}

	.search-info {
		margin-top: 12px;
		font-size: 14px;
		color: var(--color-text-secondary, #999);
	}

	.search-info p {
		margin: 4px 0;
	}

	.debouncing {
		color: var(--color-warning, #ffd93d);
		font-style: italic;
	}

	/* Form */
	.example-form {
		max-width: 400px;
	}

	.form-field {
		margin-bottom: 16px;
	}

	.form-field label {
		display: block;
		margin-bottom: 4px;
		font-size: 14px;
		color: var(--color-text-secondary, #999);
	}

	.form-field input {
		width: 100%;
		padding: 8px 12px;
		background: var(--color-surface-700, #3a3a3a);
		border: 1px solid var(--color-surface-600, #4a4a4a);
		color: var(--color-text-primary, #e0e0e0);
		border-radius: 4px;
		font-size: 14px;
	}

	.form-field input.error {
		border-color: var(--color-error, #ff6b6b);
	}

	.field-error {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		color: var(--color-error, #ff6b6b);
	}

	.form-actions {
		display: flex;
		gap: 12px;
		margin-top: 20px;
	}

	.form-error {
		margin-top: 16px;
		padding: 12px;
		background: var(--color-error-bg, #450a0a);
		color: var(--color-error, #ff6b6b);
		border-radius: 4px;
		font-size: 14px;
	}

	/* Toggle */
	.toggle-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 14px;
	}

	/* Retry info */
	.retry-info {
		margin-top: 8px;
		color: var(--color-warning, #ffd93d);
		font-size: 14px;
	}

	/* Code snippet */
	.code-snippet {
		margin-top: 16px;
		background: var(--color-surface-700, #3a3a3a);
		border-radius: 4px;
		padding: 12px;
	}

	.code-snippet summary {
		cursor: pointer;
		color: var(--color-text-secondary, #999);
		font-size: 14px;
	}

	.code-snippet pre {
		margin: 12px 0 0;
		overflow-x: auto;
	}

	.code-snippet code {
		font-family: 'Fira Code', monospace;
		font-size: 12px;
		color: var(--color-text-secondary, #999);
	}

	/* Dark mode support */
	:global(.dark) {
		--color-surface-900: #0a0a0a;
		--color-surface-800: #1a1a1a;
		--color-surface-700: #2a2a2a;
		--color-surface-600: #3a3a3a;
	}
</style>
