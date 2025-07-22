<script lang="ts">
	let { title = 'Test Panel' } = $props();
</script>

<div class="test-panel">
	<h2>{title}</h2>
	<p>This is a test panel to verify Golden Layout is working.</p>
	<p>If you can see this, Golden Layout is functioning correctly.</p>
</div>

<style>
	.test-panel {
		padding: 20px;
		height: 100%;
		background: #2a2a2a;
		color: #fff;
	}

	h2 {
		margin: 0 0 10px 0;
		color: #0ea5e9;
	}

	p {
		margin: 10px 0;
	}
</style>
