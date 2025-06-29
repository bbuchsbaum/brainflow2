<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import '../../app.css';
	
	let { children } = $props();
	
	onMount(async () => {
		try {
			console.log('Initializing GPU render loop for orthoview-demo...');
			await coreApi.init_render_loop();
			console.log('GPU render loop initialized successfully');
		} catch (err) {
			console.error('Failed to initialize GPU render loop:', err);
		}
	});
</script>

<div class="demo-layout">
	{@render children()}
</div>

<style>
	.demo-layout {
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background-color: #0a0a0a;
	}
</style>