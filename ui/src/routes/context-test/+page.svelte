<script lang="ts">
	import { onMount } from 'svelte';
	import { isTauri } from '$lib/tauri-ready';
	
	let inTauri = $state(false);
	let userAgent = $state('');
	let windowProps = $state<string[]>([]);
	
	onMount(() => {
		// Check if we're in Tauri
		inTauri = isTauri();
		
		// Get user agent
		userAgent = navigator.userAgent;
		
		// Get window properties
		windowProps = Object.keys(window).filter(k => 
			k.includes('tauri') || 
			k.includes('TAURI') || 
			k.includes('__')
		).slice(0, 20);
		
		// Log for debugging
		console.log('In Tauri context:', inTauri);
		console.log('User agent:', userAgent);
		console.log('Window props with __ or tauri:', windowProps);
		
		// Check specific properties
		console.log('window.__TAURI__:', (window as any).__TAURI__);
		console.log('window.__TAURI_INTERNALS__:', (window as any).__TAURI_INTERNALS__);
		console.log('window.__TAURI_IPC__:', (window as any).__TAURI_IPC__);
		
		// List all properties starting with __
		const underscoreProps = Object.keys(window).filter(k => k.startsWith('__'));
		console.log('All __ properties:', underscoreProps);
		
		// Print each one
		underscoreProps.forEach(prop => {
			console.log(`  ${prop}:`, (window as any)[prop]);
		});
	});
</script>

<div style="padding: 2rem;">
	<h1>Context Test</h1>
	
	<div style="font-family: monospace;">
		<p><strong>Running in Tauri:</strong> {inTauri ? '✅ YES' : '❌ NO'}</p>
		
		<p><strong>User Agent:</strong></p>
		<div style="padding-left: 2rem; font-size: 0.9em;">{userAgent}</div>
		
		<p><strong>Window Properties (with __, tauri):</strong></p>
		<ul style="padding-left: 2rem; font-size: 0.9em;">
			{#each windowProps as prop}
				<li>{prop}</li>
			{/each}
		</ul>
		
		{#if !inTauri}
			<div style="background: #fff3cd; border: 1px solid #ffeeba; padding: 1rem; margin-top: 2rem; border-radius: 4px;">
				<strong>⚠️ Not in Tauri Context</strong>
				<p>You appear to be viewing this in a web browser. The Tauri API is only available when running inside the Tauri application window.</p>
				<p>Make sure you're viewing this in the Tauri window that opens when you run <code>cargo tauri dev</code>, not in a web browser.</p>
			</div>
		{/if}
	</div>
</div>