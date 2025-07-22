<script>
	let { children } = $props();
</script>

<!-- Minimal layout that bypasses the main app layout -->
<div class="standalone-layout">
	{@render children()}
</div>

<style>
	.standalone-layout {
		width: 100%;
		height: 100vh;
		overflow: auto;
	}
</style>