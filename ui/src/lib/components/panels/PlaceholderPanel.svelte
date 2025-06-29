<script lang="ts">
  // Simple placeholder panel component
  export let title: string = 'Placeholder';
  export let componentType: string = 'unknown';
</script>

<div class="placeholder-panel">
  <h2>{title}</h2>
  <p>Content for: {componentType}</p>
  <p>(This is a placeholder Svelte component)</p>
</div>

<style>
  .placeholder-panel {
    padding: 10px;
    height: 100%;
    overflow: auto;
    background-color: #eee;
  }
  h2 {
    margin-top: 0;
    font-size: 1.1em;
    color: #555;
  }
</style> 